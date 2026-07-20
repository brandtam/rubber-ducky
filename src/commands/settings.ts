import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import {
  loadSettings,
  readSettingPath,
  writeSettingPath,
  enableFlag,
  disableFlag,
  SettingsValidationError,
  type WriteResult,
} from "../lib/settings.js";
import { appendLog } from "../lib/wiki.js";
import {
  ExitCode,
  formatOutput,
  resolveOutputFromAnyDepth,
  type OutputOptions,
} from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

/**
 * `rubber-ducky settings ...` — CLI verbs that mediate vault-level
 * configuration. Every mutation is audit-logged to `wiki/log.md` so the
 * vault has a single source of truth for "what changed about this vault
 * and when" without users hand-editing settings.json behind rubber-ducky's
 * back.
 */
export function registerSettingsCommand(program: Command): void {
  const settings = program
    .command("settings")
    .description("Manage workspace-level configuration (settings.json)");

  settings
    .command("get")
    .description("Print the value at a dotted setting path, or the whole tree if no path is given")
    .argument("[path]", "Dotted setting path (e.g. ingest.auto_on_wrap_up)")
    .action(async (dottedPath: string | undefined, _opts: unknown, cmd: Command) => {
      const out = resolveOutputFromAnyDepth(cmd);
      const workspaceRoot = requireWorkspace(out);

      try {
        const all = loadSettings(workspaceRoot);
        const value = dottedPath ? readSettingPath(all, dottedPath) : all;

        if (out.json) {
          console.log(
            formatOutput(
              { success: true, path: dottedPath ?? null, value: value ?? null },
              out,
            ),
          );
        } else {
          if (value === undefined) {
            clack.log.info(
              `${chalk.cyan(dottedPath ?? "")}: ${chalk.dim("(unset — falls through to default)")}`,
            );
          } else {
            clack.log.info(
              `${chalk.cyan(dottedPath ?? "(all)")}: ${JSON.stringify(value, null, 2)}`,
            );
          }
        }
      } catch (error) {
        handleSettingsError(error, out);
      }
    });

  settings
    .command("set")
    .description("Assign a value to a dotted setting path (type-validated). Multi-value arrays accept variadic positionals: `set ingest.kinds voice vocabulary`.")
    .argument("<path>", "Dotted setting path (e.g. confirm.jira.comment)")
    // First value is required; commander's variadic captures any extras
    // into a string[] under `extras`. We surface this as "single value
    // OR multi-value" in the action handler so the CLI matches how
    // users naturally type multi-valued settings (no JSON quoting).
    .argument("<value>", "Value — a string, boolean, number, or JSON literal")
    .argument("[extras...]", "Additional values when the target setting is an array (e.g. ingest.kinds)")
    .action(async (
      dottedPath: string,
      rawValue: string,
      extras: string[],
      _opts: unknown,
      cmd: Command,
    ) => {
      const out = resolveOutputFromAnyDepth(cmd);
      const workspaceRoot = requireWorkspace(out);

      try {
        const parsed = parseSettingValue(rawValue, extras);
        const result = writeSettingPath(workspaceRoot, dottedPath, parsed);
        logAndReport(workspaceRoot, "set", result, out);
      } catch (error) {
        handleSettingsError(error, out);
      }
    });

  settings
    .command("enable")
    .description("Turn a boolean setting on (shorthand for `set <path> true`)")
    .argument("<path>", "Dotted setting path to set to true")
    .action(async (dottedPath: string, _opts: unknown, cmd: Command) => {
      const out = resolveOutputFromAnyDepth(cmd);
      const workspaceRoot = requireWorkspace(out);

      try {
        const result = enableFlag(workspaceRoot, dottedPath);
        logAndReport(workspaceRoot, "enable", result, out);
      } catch (error) {
        handleSettingsError(error, out);
      }
    });

  settings
    .command("disable")
    .description("Turn a boolean setting off (shorthand for `set <path> false`)")
    .argument("<path>", "Dotted setting path to set to false")
    .action(async (dottedPath: string, _opts: unknown, cmd: Command) => {
      const out = resolveOutputFromAnyDepth(cmd);
      const workspaceRoot = requireWorkspace(out);

      try {
        const result = disableFlag(workspaceRoot, dottedPath);
        logAndReport(workspaceRoot, "disable", result, out);
      } catch (error) {
        handleSettingsError(error, out);
      }
    });
}

function requireWorkspace(out: OutputOptions): string {
  const root = findWorkspaceRoot();
  if (!root) {
    exitWithError(
      "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
      out,
      ExitCode.NotFound,
    );
  }
  return root;
}

/**
 * Decide how to interpret the value argv. Three intentional shapes:
 *
 *   1. Multi-value variadic — if `extras` has entries, the user typed
 *      `settings set ingest.kinds voice vocabulary`. Pass the full
 *      string array through; the schema layer accepts arrays for
 *      array-valued leaves and rejects them for scalar leaves.
 *   2. JSON literal — parses cleanly as JSON, used when the user wants
 *      a number, boolean, null, or quoted-string syntax.
 *   3. Bare string — anything that fails JSON.parse falls through as a
 *      raw string. `confirm.jira.comment auto` works without quoting.
 *
 * The schema layer in `settings.ts` is the authority on whether the
 * resulting type is appropriate for the target path; this function just
 * matches argv to a sane datatype.
 */
function parseSettingValue(raw: string, extras: string[]): unknown {
  if (extras.length > 0) {
    return [raw, ...extras];
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function logAndReport(
  workspaceRoot: string,
  verb: "set" | "enable" | "disable",
  result: WriteResult,
  out: OutputOptions,
): void {
  // The settings write has already succeeded by the time we get here.
  // Audit-log failures must NOT roll back the write (the state on disk is
  // real), but they must be surfaced — a silent audit gap is worse than a
  // loud one because future debugging can't tell when state diverged.
  let auditWarning: string | undefined;
  try {
    appendLog(workspaceRoot, formatAuditEntry(verb, result));
  } catch (error) {
    auditWarning =
      `Setting was written but audit log update failed: ` +
      (error instanceof Error ? error.message : "unknown error") +
      `. The on-disk value is correct; wiki/log.md is out of sync.`;
  }

  if (out.json) {
    console.log(
      formatOutput(
        {
          success: true,
          action: verb,
          ...result,
          ...(auditWarning ? { auditWarning } : {}),
        },
        out,
      ),
    );
    return;
  }
  clack.log.success(
    `${chalk.cyan(result.path)}: ` +
      `${chalk.dim(formatValue(result.previous))} → ${chalk.bold(formatValue(result.next))}`,
  );
  if (auditWarning) {
    clack.log.warn(auditWarning);
  }
}

function formatAuditEntry(
  verb: "set" | "enable" | "disable",
  result: WriteResult,
): string {
  return (
    `[settings] ${verb} ${result.path}: ` +
    `${formatValue(result.previous)} → ${formatValue(result.next)}`
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value);
}

function handleSettingsError(error: unknown, out: OutputOptions): never {
  const code =
    error instanceof SettingsValidationError
      ? ExitCode.InvalidInput
      : ExitCode.Unclassified;
  exitWithError(error, out, code);
}
