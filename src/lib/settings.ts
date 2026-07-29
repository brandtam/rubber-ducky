import * as fs from "node:fs";
import { writeFileAtomic } from "./fs-atomic.js";
import * as path from "node:path";
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  parseTree,
  type Node,
} from "jsonc-parser";

/**
 * Vault-level settings live in `settings.json` (JSONC) at the vault root,
 * alongside `workspace.md`. The file is mutated through CLI verbs, not
 * free-form edits — this module is the single point of read/write so the
 * schema, validation rules, and audit-log shape stay coherent.
 *
 * JSONC (JSON with comments) is the on-disk format because:
 *   - the user's mental model from `.vscode/settings.json` already carries
 *     "config file with explanatory comments";
 *   - it's stricter than YAML (no indentation foot-guns, no surprising
 *     coercions);
 *   - `jsonc-parser` lets us preserve user-authored comments through
 *     programmatic edits, which `JSON.parse`/`stringify` cannot.
 */

export const SETTINGS_FILENAME = "settings.json";

/**
 * Confirmation policy for an external write action. Enforced by the plugin's
 * PreToolUse confirm gate (see docs/adr/confirm-gate-single-hook.md):
 *
 *   - `auto`    — the registered write runs without prompting.
 *   - `manual`  — the write is blocked pending explicit user confirmation.
 *   - `preview` — the user is shown the exact command and asked to approve.
 *
 * Anything registered but not explicitly listed defaults to `preview` —
 * fail-closed for hard writes.
 */
export type ConfirmPolicy = "auto" | "manual" | "preview";

export const CONFIRM_POLICIES: readonly ConfirmPolicy[] = [
  "auto",
  "manual",
  "preview",
] as const;

/**
 * Default policy for any action not explicitly listed under `confirm.*`.
 * Hard-action commands rely on this: an unknown descriptor must require a
 * preview, never auto-execute.
 */
export const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = "preview";

/**
 * Categories of raw material the ongoing-capture pipeline knows how to
 * extract. Exposed as a closed enum so a typo in `settings set
 * ingest.kinds […]` fails at the CLI boundary, not later when a skill tries
 * to route an extraction to a non-existent page.
 */
export type IngestKind = "voice" | "vocabulary" | "facts" | "preferences";

export const INGEST_KINDS: readonly IngestKind[] = [
  "voice",
  "vocabulary",
  "facts",
  "preferences",
] as const;

/**
 * The full settings shape. Every field has a concrete default in
 * {@link DEFAULT_SETTINGS} so partial files merge cleanly — readers can
 * always assume the resolved settings object is fully populated.
 */
export interface Settings {
  /**
   * Per-action confirm policy. The descriptor is a dotted `<transport>.<verb>`
   * pair (e.g. `"jira.comment"`, `"slack.send"`). Nested objects make this
   * editable from the CLI with stable paths (`settings set
   * confirm.jira.comment auto`).
   */
  confirm: Record<string, Record<string, ConfirmPolicy>>;
  /**
   * Ongoing-capture hooks. Both `auto_on_*` flags gate token-burning
   * behavior — they're off by default outside the explicit onboard flow so
   * users opt into background extraction.
   */
  ingest: {
    auto_on_wrap_up: boolean;
    auto_on_onboard: boolean;
    kinds: IngestKind[];
  };
  /**
   * One-shot flags the vault sets after first-run flows complete. Lets
   * skills detect "have we already onboarded?" without parsing the
   * append-only `wiki/log.md` — the log is for history, not for current
   * state.
   */
  onboard: {
    completed: boolean;
  };
}

/**
 * Defaults applied when a key is absent from the on-disk file. Used both to
 * seed a new vault and to fill in missing keys at read time so callers see a
 * complete object.
 */
export const DEFAULT_SETTINGS: Settings = {
  confirm: {},
  ingest: {
    auto_on_wrap_up: false,
    auto_on_onboard: true,
    kinds: ["voice", "vocabulary"],
  },
  onboard: {
    completed: false,
  },
};

/**
 * JSONC template written at `rubber-ducky init`. Inline comments explain
 * each key so users browsing the file in Obsidian or VS Code can self-serve
 * without consulting docs.
 */
export const SETTINGS_TEMPLATE = `// settings.json — vault-level config for rubber-ducky.
//
// Don't edit by hand; use \`rubber-ducky settings ...\` so values are
// validated, comments stay intact, and changes land in wiki/log.md.
//
// Example overrides (run from a terminal inside the vault):
//   rubber-ducky settings set confirm.jira.comment auto
//   rubber-ducky settings set confirm.slack.send preview
//   rubber-ducky settings enable ingest.auto_on_wrap_up
//   rubber-ducky settings set ingest.kinds voice vocabulary
{
  // Per-action confirmation policy for external writes.
  //   "auto"    — run the registered write without prompting.
  //   "manual"  — block the write until you explicitly confirm it.
  //   "preview" — show the exact command and wait for explicit yes.
  // Anything not listed here defaults to "preview" — fail-closed.
  "confirm": {},

  // Ongoing-context capture controls. Hooks that scan your writing for
  // voice / vocabulary / preferences run only when enabled here.
  "ingest": {
    // Scan today's drafts at /wrap-up and offer to ingest them as voice
    // samples. Off by default — opt in once you trust the extraction.
    "auto_on_wrap_up": false,
    // Invite the user to paste raw material at the end of /onboard.
    "auto_on_onboard": true,
    // Which kinds of extraction to perform: "voice", "vocabulary",
    // "facts", "preferences". Trim this list to narrow what gets pulled.
    "kinds": ["voice", "vocabulary"]
  }
}
`;

/**
 * Error type thrown when the on-disk JSONC file is malformed (parse errors)
 * or violates the schema (wrong value types, unknown enum members, etc.).
 * Tagged so command-layer code can distinguish parse/validation failures
 * from filesystem or auth errors and map them to the right exit code.
 */
export class SettingsValidationError extends Error {
  override readonly name = "SettingsValidationError";
}

/**
 * Locate a vault's settings file. The file may or may not exist on disk;
 * the path itself is deterministic from the workspace root.
 */
export function settingsPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, SETTINGS_FILENAME);
}

/**
 * Load and validate the vault's settings. Missing file or missing keys are
 * filled in from {@link DEFAULT_SETTINGS} so callers always receive a fully
 * populated object — but invalid values (wrong type, bad enum) throw a
 * {@link SettingsValidationError}. This matches the rest of the codebase's
 * "validate at the boundary" pattern: command code can trust the returned
 * shape without re-checking every field.
 */
export function loadSettings(workspaceRoot: string): Settings {
  const filePath = settingsPath(workspaceRoot);
  if (!fs.existsSync(filePath)) {
    return cloneDefaults();
  }
  return parseSettings(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Read a value at a dotted path (e.g. `"ingest.auto_on_wrap_up"` or
 * `"confirm.jira.comment"`). Returns `undefined` for paths that don't
 * resolve — callers decide whether absence is meaningful or whether to fall
 * back to a default.
 *
 * Path-based access is the single read primitive exposed to the CLI so all
 * `settings get` queries share one resolution algorithm. Type narrowing is
 * the caller's job; the `Settings` interface is the source of truth for
 * what each well-known path produces.
 */
export function readSettingPath(
  settings: Settings,
  dottedPath: string,
): unknown {
  const segments = splitPath(dottedPath);
  let cursor: unknown = settings;
  for (const segment of segments) {
    if (
      cursor === null ||
      cursor === undefined ||
      typeof cursor !== "object" ||
      Array.isArray(cursor)
    ) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Result of {@link writeSettingPath}. `previous` is the value the path held
 * before the edit (or `undefined` if the key was absent) — callers use this
 * to render concise audit messages without re-reading the file.
 */
export interface WriteResult {
  path: string;
  previous: unknown;
  next: unknown;
}

/**
 * Mutate a single dotted path in `settings.json` and re-serialize it
 * atomically, preserving comments and formatting via `jsonc-parser`. Uses
 * a write-to-temp-then-rename so a crash mid-write can't leave the file
 * truncated — the OS rename is atomic on the same filesystem.
 *
 * Validates `value` against the schema for the target path. Type errors
 * throw a {@link SettingsValidationError}; the file on disk is unchanged
 * when validation fails. Unknown paths under `confirm.*` are accepted
 * (services are user-defined and can't be enumerated up-front) but the
 * value must still be a known {@link ConfirmPolicy}.
 */
export function writeSettingPath(
  workspaceRoot: string,
  dottedPath: string,
  value: unknown,
): WriteResult {
  const segments = splitPath(dottedPath);
  if (segments.length === 0) {
    throw new SettingsValidationError(
      "Setting path must not be empty (e.g. `ingest.auto_on_wrap_up`).",
    );
  }
  const validated = validatePathAssignment(segments, value);

  const filePath = settingsPath(workspaceRoot);
  // Bootstrap the file if it's missing so callers don't need to special-case
  // "vault initialized before settings were a concept" paths.
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : SETTINGS_TEMPLATE;

  // Capture the prior value from a strictly-parsed view: fail closed if the
  // on-disk file is corrupted so we don't write through bad input and log
  // a misleading "(unset) → next" transition. The user gets a clear error
  // and the file is left intact.
  const before = parseSettings(existing);
  const previous = readSettingPath(before, dottedPath);

  const edits = modify(existing, segments, validated, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  const nextContent = applyEdits(existing, edits);

  writeFileAtomic(filePath, nextContent);

  return {
    path: dottedPath,
    previous,
    next: validated,
  };
}

/**
 * Convenience wrapper: set a boolean leaf to `true`. Used by
 * `settings enable <feature>` so the CLI surface matches the natural-language
 * phrasing skills use ("turn on auto-ingest"). Rejects non-boolean targets
 * up-front so the error message points at the user's choice of verb, not
 * at a deeper type-coercion failure.
 */
export function enableFlag(
  workspaceRoot: string,
  dottedPath: string,
): WriteResult {
  assertBooleanLeaf(dottedPath, "enable");
  return writeSettingPath(workspaceRoot, dottedPath, true);
}

/**
 * Convenience wrapper: set a boolean leaf to `false`. Mirror of
 * {@link enableFlag}.
 */
export function disableFlag(
  workspaceRoot: string,
  dottedPath: string,
): WriteResult {
  assertBooleanLeaf(dottedPath, "disable");
  return writeSettingPath(workspaceRoot, dottedPath, false);
}

/**
 * Static check that a setting path resolves to a known boolean leaf in the
 * {@link Settings} schema. Used by `enable`/`disable` to surface the right
 * error message when the user aims a boolean verb at a non-boolean
 * setting (e.g. `enable ingest.kinds`).
 */
function assertBooleanLeaf(dottedPath: string, verb: "enable" | "disable"): void {
  if (!BOOLEAN_LEAVES.has(dottedPath)) {
    throw new SettingsValidationError(
      `${dottedPath} is not a boolean setting — \`settings ${verb}\` only works on ` +
        `flags. Known boolean settings: ${Array.from(BOOLEAN_LEAVES).sort().join(", ")}. ` +
        `For other settings use \`settings set <path> <value>\`.`,
    );
  }
}

/**
 * Compile-time-derived union of every dotted path in {@link Settings}
 * whose leaf is a boolean. The recursive conditional walks the interface
 * and emits exactly the paths `enable` / `disable` can operate on; the
 * `confirm` sub-tree is intentionally excluded because its leaves are
 * {@link ConfirmPolicy} strings, not booleans.
 *
 * The benefit over a hand-maintained list: adding a new boolean leaf to
 * {@link Settings} immediately widens the type, and the `satisfies`
 * check below forces the runtime list to be updated in the same patch
 * — drift becomes a TypeScript error instead of a runtime surprise.
 */
type BooleanLeafPath<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends boolean
    ? Prefix extends "" ? K : `${Prefix}.${K}`
    : T[K] extends Record<string, unknown>
      ? // Skip the open-keyed `confirm` sub-tree — its leaves are
        // strings, not booleans, and recursing through `Record<string,
        // …>` would explode the union into `string`.
        T[K] extends Record<string, Record<string, ConfirmPolicy>>
        ? never
        : BooleanLeafPath<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>
      : never;
}[keyof T & string];

type SettingsBooleanLeaf = BooleanLeafPath<Settings>;

const BOOLEAN_LEAVES_LIST = [
  "ingest.auto_on_wrap_up",
  "ingest.auto_on_onboard",
  "onboard.completed",
] as const satisfies readonly SettingsBooleanLeaf[];

/**
 * Bidirectional exhaustiveness check. `satisfies` only verifies that
 * every listed entry is a valid `SettingsBooleanLeaf` — it doesn't catch
 * a *missing* entry. This type asserts the two unions are equal, so
 * adding a new boolean leaf to {@link Settings} (which widens
 * `SettingsBooleanLeaf`) without adding it to `BOOLEAN_LEAVES_LIST`
 * breaks the assignment below at compile time.
 */
type ExactlyEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _exhaustiveBooleanLeaves: ExactlyEqual<
  (typeof BOOLEAN_LEAVES_LIST)[number],
  SettingsBooleanLeaf
> = true;

const BOOLEAN_LEAVES: ReadonlySet<string> = new Set(BOOLEAN_LEAVES_LIST);

/**
 * Resolve the confirm policy for a `<transport>.<verb>` action descriptor.
 * Always returns a {@link ConfirmPolicy} — never undefined — so the confirm
 * helper can switch on it directly. Unknown actions resolve to
 * {@link DEFAULT_CONFIRM_POLICY} (`"preview"`), which is the fail-closed
 * default the plan calls for.
 */
export function resolveConfirmPolicy(
  settings: Settings,
  actionDescriptor: string,
): ConfirmPolicy {
  const segments = splitPath(actionDescriptor);
  if (segments.length === 0) return DEFAULT_CONFIRM_POLICY;

  let cursor: unknown = settings.confirm;
  for (const segment of segments) {
    if (
      cursor === null ||
      cursor === undefined ||
      typeof cursor !== "object" ||
      Array.isArray(cursor)
    ) {
      return DEFAULT_CONFIRM_POLICY;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return isConfirmPolicy(cursor) ? cursor : DEFAULT_CONFIRM_POLICY;
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

function cloneDefaults(): Settings {
  return {
    confirm: {},
    ingest: {
      auto_on_wrap_up: DEFAULT_SETTINGS.ingest.auto_on_wrap_up,
      auto_on_onboard: DEFAULT_SETTINGS.ingest.auto_on_onboard,
      kinds: [...DEFAULT_SETTINGS.ingest.kinds],
    },
    onboard: {
      completed: DEFAULT_SETTINGS.onboard.completed,
    },
  };
}

/**
 * Strict variant of {@link loadSettings} that takes the raw file text
 * instead of a workspace root. Used internally by {@link writeSettingPath}
 * before applying edits so a corrupted file fails the write closed
 * (with the original file untouched) rather than silently rebooting from
 * defaults. Same {@link SettingsValidationError} contract as the public
 * loader.
 */
function parseSettings(raw: string): Settings {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new SettingsValidationError(
      `Malformed ${SETTINGS_FILENAME}: parse error at offset ${first.offset} ` +
        `(length ${first.length}). Fix the file manually or delete it and re-run init.`,
    );
  }
  if (parsed === undefined || parsed === null) {
    return cloneDefaults();
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SettingsValidationError(
      `${SETTINGS_FILENAME} must contain a JSON object at the top level.`,
    );
  }
  return mergeWithDefaults(parsed as Record<string, unknown>);
}

function mergeWithDefaults(raw: Record<string, unknown>): Settings {
  const defaults = cloneDefaults();

  const confirmRaw = raw.confirm;
  if (confirmRaw !== undefined) {
    defaults.confirm = validateConfirmBlock(confirmRaw);
  }

  const ingestRaw = raw.ingest;
  if (ingestRaw !== undefined) {
    defaults.ingest = validateIngestBlock(ingestRaw, defaults.ingest);
  }

  const onboardRaw = raw.onboard;
  if (onboardRaw !== undefined) {
    defaults.onboard = validateOnboardBlock(onboardRaw, defaults.onboard);
  }

  return defaults;
}

function validateOnboardBlock(
  block: unknown,
  defaults: Settings["onboard"],
): Settings["onboard"] {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new SettingsValidationError(
      "`onboard` must be an object with key: completed.",
    );
  }
  const src = block as Record<string, unknown>;
  const out: Settings["onboard"] = { ...defaults };

  if (src.completed !== undefined) {
    if (typeof src.completed !== "boolean") {
      throw new SettingsValidationError(
        `onboard.completed must be a boolean (got ${typeof src.completed}).`,
      );
    }
    out.completed = src.completed;
  }
  return out;
}

function validateConfirmBlock(
  block: unknown,
): Record<string, Record<string, ConfirmPolicy>> {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new SettingsValidationError(
      "`confirm` must be an object keyed by transport name.",
    );
  }
  const out: Record<string, Record<string, ConfirmPolicy>> = {};
  for (const [transport, verbs] of Object.entries(block)) {
    if (typeof verbs !== "object" || verbs === null || Array.isArray(verbs)) {
      throw new SettingsValidationError(
        `confirm.${transport} must be an object keyed by verb (e.g. \`comment\`, \`transition\`).`,
      );
    }
    const verbsOut: Record<string, ConfirmPolicy> = {};
    for (const [verb, policy] of Object.entries(verbs)) {
      if (!isConfirmPolicy(policy)) {
        throw new SettingsValidationError(
          `confirm.${transport}.${verb} must be one of: ${CONFIRM_POLICIES.join(", ")} ` +
            `(got ${JSON.stringify(policy)}).`,
        );
      }
      verbsOut[verb] = policy;
    }
    out[transport] = verbsOut;
  }
  return out;
}

function validateIngestBlock(
  block: unknown,
  defaults: Settings["ingest"],
): Settings["ingest"] {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new SettingsValidationError(
      "`ingest` must be an object with keys auto_on_wrap_up, auto_on_onboard, kinds.",
    );
  }
  const src = block as Record<string, unknown>;
  const out: Settings["ingest"] = { ...defaults };

  if (src.auto_on_wrap_up !== undefined) {
    if (typeof src.auto_on_wrap_up !== "boolean") {
      throw new SettingsValidationError(
        `ingest.auto_on_wrap_up must be a boolean (got ${typeof src.auto_on_wrap_up}).`,
      );
    }
    out.auto_on_wrap_up = src.auto_on_wrap_up;
  }
  if (src.auto_on_onboard !== undefined) {
    if (typeof src.auto_on_onboard !== "boolean") {
      throw new SettingsValidationError(
        `ingest.auto_on_onboard must be a boolean (got ${typeof src.auto_on_onboard}).`,
      );
    }
    out.auto_on_onboard = src.auto_on_onboard;
  }
  if (src.kinds !== undefined) {
    if (!Array.isArray(src.kinds)) {
      throw new SettingsValidationError(
        "ingest.kinds must be an array of strings (e.g. [\"voice\", \"vocabulary\"]).",
      );
    }
    const kinds: IngestKind[] = [];
    for (const k of src.kinds) {
      if (typeof k !== "string" || !isIngestKind(k)) {
        throw new SettingsValidationError(
          `ingest.kinds entries must be one of: ${INGEST_KINDS.join(", ")} (got ${JSON.stringify(k)}).`,
        );
      }
      kinds.push(k);
    }
    out.kinds = kinds;
  }
  return out;
}

/**
 * Validate a value being assigned to a specific dotted path. Returns the
 * (possibly coerced) value to write — strings come from CLI argv, so
 * `"true"` becomes `true` for boolean leaves, etc. Coercion is intentional
 * at the CLI boundary and intentional only here; in-process callers passing
 * typed values get a no-op.
 */
function validatePathAssignment(segments: string[], value: unknown): unknown {
  // confirm.<transport>.<verb> — known structure, leaf must be ConfirmPolicy.
  if (segments[0] === "confirm") {
    if (segments.length !== 3) {
      throw new SettingsValidationError(
        "Confirm settings live at `confirm.<transport>.<verb>` (e.g. confirm.jira.comment).",
      );
    }
    if (!isConfirmPolicy(value)) {
      throw new SettingsValidationError(
        `${segments.join(".")} must be one of: ${CONFIRM_POLICIES.join(", ")} ` +
          `(got ${JSON.stringify(value)}).`,
      );
    }
    return value;
  }

  // ingest.* — bounded leaves.
  if (segments[0] === "ingest") {
    if (segments.length === 2) {
      const leaf = segments[1];
      if (leaf === "auto_on_wrap_up" || leaf === "auto_on_onboard") {
        return coerceBoolean(segments.join("."), value);
      }
      if (leaf === "kinds") {
        // `value` may be a JSON-parsed array (when the user passed
        // `'["voice"]'`) or a bare string from a variadic positional
        // (when the user passed `voice vocabulary` and the CLI joined
        // the rest into a string array). Normalize and validate.
        const candidates: unknown[] = Array.isArray(value) ? value : [value];
        const kinds: IngestKind[] = [];
        for (const k of candidates) {
          if (typeof k !== "string" || !isIngestKind(k)) {
            throw new SettingsValidationError(
              `ingest.kinds entries must be one of: ${INGEST_KINDS.join(", ")} ` +
                `(got ${JSON.stringify(k)}).`,
            );
          }
          kinds.push(k);
        }
        return kinds;
      }
      throw new SettingsValidationError(
        `Unknown ingest setting \`${segments.join(".")}\`. Known: auto_on_wrap_up, auto_on_onboard, kinds.`,
      );
    }
    throw new SettingsValidationError(
      "Ingest settings live at `ingest.<key>` (e.g. ingest.auto_on_wrap_up).",
    );
  }

  // onboard.* — bounded leaves.
  if (segments[0] === "onboard") {
    if (segments.length === 2 && segments[1] === "completed") {
      return coerceBoolean(segments.join("."), value);
    }
    throw new SettingsValidationError(
      `Unknown onboard setting \`${segments.join(".")}\`. Known: completed.`,
    );
  }

  throw new SettingsValidationError(
    `Unknown setting path \`${segments.join(".")}\`. ` +
      `Top-level keys: confirm, ingest, onboard.`,
  );
}

function coerceBoolean(pathLabel: string, value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SettingsValidationError(
    `${pathLabel} must be a boolean (got ${JSON.stringify(value)}).`,
  );
}

function isConfirmPolicy(value: unknown): value is ConfirmPolicy {
  return value === "auto" || value === "manual" || value === "preview";
}

function isIngestKind(value: string): value is IngestKind {
  return (INGEST_KINDS as readonly string[]).includes(value);
}

function splitPath(dottedPath: string): string[] {
  return dottedPath
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Re-exported for tests that want to inspect the parsed AST directly.
 * Not part of the public API; subject to change.
 * @internal
 */
export function _parseTreeForTests(content: string): Node | undefined {
  return parseTree(content);
}

/**
 * Strict parser exposed for tests that need the throw-on-malformed
 * behavior without going through the filesystem. Not part of the
 * public API.
 * @internal
 */
export function _parseSettingsForTests(raw: string): Settings {
  return parseSettings(raw);
}
