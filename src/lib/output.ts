/**
 * Press-style CLI conventions for rubber-ducky's output.
 *
 * Goals (mirroring CLI Printing Press's agent-native conventions):
 *
 * 1. Auto-JSON on pipe — when stdout is not a TTY, emit JSON by default so
 *    downstream agents don't need a `--json` flag for every call. `--no-json`
 *    overrides this for the rare "I'm piping but want human text" case.
 * 2. Typed exit codes — see `ExitCode` below. Agents key on numeric codes
 *    instead of parsing error text.
 *
 * Note on "compact" output: a previous draft of this file shipped a generic
 * `--compact` post-hoc transformation that collapsed large arrays and
 * strings. It was removed because it papered over the real problem —
 * commands whose default JSON responses are unnecessarily verbose. The
 * agent-native answer is "design each command's default response so it's
 * already small; expose `--verbose` on the few commands where a consumer
 * legitimately needs the full payload." See the per-command response-shape
 * audit issue for the follow-up work.
 */

/**
 * A *resolved* rendering decision. The TTY check, `--json`/`--no-json`
 * reconciliation, and other inputs are settled by `resolveOutputOptions`
 * before this struct is constructed; `formatOutput` only renders. Keeping
 * the decision in one place stops "render-time second-guessing" bugs
 * (e.g. a renderer overriding an explicit `--no-json` because it noticed
 * a non-TTY stdout).
 */
export interface OutputOptions {
  /** True if the resolved decision is to emit JSON. */
  json: boolean;
  /**
   * True when `--verbose` is set. Commands consult this flag to decide
   * between summarized (`{count, sample}`) and full-array response shapes.
   * See `summarizeArray` for the canonical envelope. Optional because most
   * callers (especially error paths) don't care; treat `undefined` as false.
   */
  verbose?: boolean;
  /** Pre-formatted human text, used when `json` is false. */
  humanReadable?: string;
}

/**
 * Standard envelope for a summarized list. A field that may grow unbounded
 * is exposed as `{count, sample}` by default and as a full array under
 * `--verbose`. `count` and `sample` are always present together — consumers
 * can rely on the pair existing in default mode without polymorphic shape
 * checks within that mode.
 */
export interface ArrayEnvelope<T> {
  count: number;
  sample: T[];
}

/** Default cap on `sample` length. Small enough to stay terse, large enough
 *  to show what kinds of entries the array holds (file names, refs, etc.). */
export const DEFAULT_SAMPLE_SIZE = 5;

/**
 * Reduce an unbounded array to its agent-native shape. In default mode,
 * returns `{count, sample}`; under `--verbose`, returns the full array.
 *
 * The two return shapes are intentionally distinct types — within a single
 * resolved mode the consumer always sees the same shape, and the mode itself
 * (set by the caller's `--verbose` flag) is what discriminates. Callers that
 * need to type the field can union `T[] | ArrayEnvelope<T>`.
 */
export function summarizeArray<T>(
  items: T[],
  options: { verbose?: boolean; sampleSize?: number },
): T[] | ArrayEnvelope<T> {
  // `verbose` is optional so callers can pass an `OutputOptions` directly.
  // Undefined is treated as false — the agent-native default.
  if (options.verbose) return items;
  return {
    count: items.length,
    sample: items.slice(0, options.sampleSize ?? DEFAULT_SAMPLE_SIZE),
  };
}

/**
 * Standard exit codes — keep in sync with docs/cli-reference.md "Conventions".
 *
 * 0 — success
 * 2 — invalid input (bad flags, missing args, malformed values)
 * 3 — not found (workspace, page, integration, file)
 * 4 — auth / credential error (reserved; no producer in the core verb
 *     surface today — kept so future integration slices don't renumber)
 * 5 — external service error (reserved, same as 4)
 * 7 — state conflict (target exists, page already exists, double-init)
 *
 * Code 1 is reserved for unclassified errors (legacy behavior). Prefer one of
 * the typed codes above when the failure mode is recognizable.
 */
export const ExitCode = {
  Success: 0,
  Unclassified: 1,
  InvalidInput: 2,
  NotFound: 3,
  AuthError: 4,
  ExternalError: 5,
  StateConflict: 7,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Render a result for stdout. The choice between JSON and human text is
 * already settled in `options.json`; this function does not re-derive it
 * from environment state. In human mode, the pre-formatted `humanReadable`
 * string is returned; absent that, pretty JSON is the fallback so callers
 * never get an empty string by accident.
 */
export function formatOutput(data: unknown, options: OutputOptions): string {
  if (options.json) {
    return JSON.stringify(data, null, 2);
  }

  return options.humanReadable ?? JSON.stringify(data, null, 2);
}

/**
 * Resolve global CLI flags into a rendering decision. Inputs:
 * - `globalOpts.json` — explicit `--json` (true) or `--no-json` (false);
 *   commander leaves it `undefined` when neither flag is passed.
 * - `isTTY` — defaults to `process.stdout.isTTY`. Injectable for tests so
 *   resolution is deterministic without monkey-patching the global.
 *
 * Decision: explicit `--json` and `--no-json` always win. Otherwise,
 * non-TTY stdout (a pipe) auto-enables JSON.
 *
 * This is the single place that decides JSON-vs-human; downstream code
 * (especially `formatOutput`) trusts the answer rather than re-deriving it.
 */
export function resolveOutputOptions(
  globalOpts: Record<string, unknown>,
  humanReadable?: string,
  isTTY: boolean = process.stdout.isTTY ?? true,
): OutputOptions {
  const explicitJson = globalOpts.json === true;
  const explicitNoJson = globalOpts.json === false;

  const json = explicitJson || (!explicitNoJson && !isTTY);
  const verbose = globalOpts.verbose === true;

  return {
    json,
    verbose,
    humanReadable,
  };
}

/**
 * Walk a commander Command up to the root and resolve global options from
 * there. Subcommand modules that nest two or three levels deep would
 * otherwise duplicate `cmd.parent?.parent?.parent?.opts()` chains —
 * brittle to commander structure changes and silently broken when a
 * level is added. Use this anywhere a leaf action needs the root-level
 * `--json` / `--verbose` flags.
 */
interface CommanderLike {
  parent?: CommanderLike | null;
  opts?: () => Record<string, unknown>;
}

export function resolveOutputFromAnyDepth(
  cmd: CommanderLike | null | undefined,
): OutputOptions {
  // Walk to the root by following `.parent` until null. The root is where
  // the program-level flags (`--json`, `--verbose`) live, regardless of
  // how deeply nested the leaf action is.
  let cursor: CommanderLike | null | undefined = cmd;
  while (cursor?.parent) {
    cursor = cursor.parent;
  }
  const opts =
    cursor && typeof cursor.opts === "function" ? cursor.opts() : {};
  return resolveOutputOptions(opts);
}
