import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseFrontmatter,
  setFrontmatterField,
  validateFrontmatter,
  addToFrontmatterArray,
  removeFromFrontmatterArray,
  setFrontmatterArray,
  FrontmatterArrayTypeError,
} from "../lib/frontmatter.js";
import { writeFileAtomic } from "../lib/fs-atomic.js";
import { formatOutput, ExitCode } from "../lib/output.js";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { isInsideWorkspace } from "../lib/paths.js";
import { exitWithError } from "../lib/cli-errors.js";

export function registerFrontmatterCommand(program: Command): void {
  const fm = program
    .command("frontmatter")
    .description("Read, write, and validate YAML frontmatter");

  fm.command("get")
    .description("Read frontmatter from a markdown file")
    .argument("<file>", "Path to the markdown file")
    .argument("[field]", "Specific field to read")
    .option("--outside-vault", "Allow a file path outside the current workspace", false)
    .action((file: string, field: string | undefined, opts: { outsideVault: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      file = confineFileArg(file, opts.outsideVault, jsonMode);

      try {
        if (!fs.existsSync(file)) {
          exitWithError(`File not found: ${file}`, { json: jsonMode }, ExitCode.NotFound);
        }

        const content = fs.readFileSync(file, "utf-8");
        const parsed = parseFrontmatter(content);

        if (!parsed) {
          exitWithError("No frontmatter found in file", { json: jsonMode }, ExitCode.NotFound);
        }

        if (field) {
          if (!(field in parsed.data)) {
            exitWithError(
              `Field "${field}" not found in frontmatter`,
              { json: jsonMode },
              ExitCode.NotFound,
            );
          }

          const value = parsed.data[field];
          const output = formatOutput(
            { success: true, field, value },
            { json: jsonMode, humanReadable: `${field}: ${formatValue(value)}` }
          );
          console.log(output);
        } else {
          const output = formatOutput(
            { success: true, data: parsed.data },
            { json: jsonMode, humanReadable: formatAllFields(parsed.data) }
          );
          console.log(output);
        }
      } catch (error) {
        exitWithError(error, { json: jsonMode }, ExitCode.Unclassified);
      }
    });

  fm.command("set")
    .description("Set a frontmatter field in a markdown file")
    .argument("<file>", "Path to the markdown file")
    .argument("<field>", "Field name to set")
    .argument("<value>", "Value to set")
    .option("--outside-vault", "Allow a file path outside the current workspace", false)
    .action((file: string, field: string, value: string, opts: { outsideVault: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      file = confineFileArg(file, opts.outsideVault, jsonMode);

      try {
        if (!fs.existsSync(file)) {
          exitWithError(`File not found: ${file}`, { json: jsonMode }, ExitCode.NotFound);
        }

        const content = fs.readFileSync(file, "utf-8");
        const parsedValue = parseCliValue(value);
        const updated = setFrontmatterField(content, field, parsedValue);
        writeFileAtomic(file, updated);

        const output = formatOutput(
          { success: true, field, value: parsedValue },
          { json: jsonMode, humanReadable: `Set ${field} = ${formatValue(parsedValue)}` }
        );
        console.log(output);
      } catch (error) {
        exitWithError(error, { json: jsonMode }, ExitCode.Unclassified);
      }
    });

  const array = fm
    .command("array")
    .description("Manage list-valued frontmatter fields (append, remove, replace)");

  array
    .command("add")
    .description("Append a value to an array-valued frontmatter field")
    .argument("<file>", "Path to the markdown file")
    .argument("<field>", "Field name")
    .argument("<value>", "Value to append")
    .option("--allow-duplicates", "Append even when the value is already present", false)
    .option("--outside-vault", "Allow a file path outside the current workspace", false)
    .action((file: string, field: string, value: string, opts: { allowDuplicates: boolean; outsideVault: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      file = confineFileArg(file, opts.outsideVault, jsonMode);

      try {
        if (!fs.existsSync(file)) {
          exitWithError(`File not found: ${file}`, { json: jsonMode }, ExitCode.NotFound);
        }

        const content = fs.readFileSync(file, "utf-8");
        const updated = addToFrontmatterArray(content, field, value, {
          allowDuplicates: opts.allowDuplicates,
        });

        if (updated !== content) {
          writeFileAtomic(file, updated);
        }

        const parsed = parseFrontmatter(updated);
        const finalValues = (parsed?.data[field] ?? []) as unknown[];
        const noop = updated === content;
        const output = formatOutput(
          { success: true, field, value, values: finalValues, noop },
          {
            json: jsonMode,
            humanReadable: noop
              ? `${field} unchanged (value already present)`
              : `Appended to ${field}: ${formatValue(finalValues)}`,
          }
        );
        console.log(output);
      } catch (error) {
        if (error instanceof FrontmatterArrayTypeError) {
          exitWithError(error.message, { json: jsonMode }, ExitCode.InvalidInput);
        }
        exitWithError(error, { json: jsonMode }, ExitCode.Unclassified);
      }
    });

  array
    .command("remove")
    .description("Remove a value from an array-valued frontmatter field")
    .argument("<file>", "Path to the markdown file")
    .argument("<field>", "Field name")
    .argument("<value>", "Value to remove")
    .option("--outside-vault", "Allow a file path outside the current workspace", false)
    .action((file: string, field: string, value: string, opts: { outsideVault: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      file = confineFileArg(file, opts.outsideVault, jsonMode);

      try {
        if (!fs.existsSync(file)) {
          exitWithError(`File not found: ${file}`, { json: jsonMode }, ExitCode.NotFound);
        }

        const content = fs.readFileSync(file, "utf-8");
        const updated = removeFromFrontmatterArray(content, field, value);

        if (updated !== content) {
          writeFileAtomic(file, updated);
        }

        const parsed = parseFrontmatter(updated);
        const finalValues = (parsed?.data[field] ?? []) as unknown[];
        const noop = updated === content;
        const output = formatOutput(
          { success: true, field, value, values: finalValues, noop },
          {
            json: jsonMode,
            humanReadable: noop
              ? `${field} unchanged (value not present)`
              : `Removed from ${field}: ${formatValue(finalValues)}`,
          }
        );
        console.log(output);
      } catch (error) {
        if (error instanceof FrontmatterArrayTypeError) {
          exitWithError(error.message, { json: jsonMode }, ExitCode.InvalidInput);
        }
        exitWithError(error, { json: jsonMode }, ExitCode.Unclassified);
      }
    });

  array
    .command("set")
    .description("Replace an array-valued frontmatter field with the given values (zero or more)")
    .argument("<file>", "Path to the markdown file")
    .argument("<field>", "Field name")
    .argument("[values...]", "Values to set (omit for empty array)")
    .option("--outside-vault", "Allow a file path outside the current workspace", false)
    .action((file: string, field: string, values: string[], opts: { outsideVault: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      file = confineFileArg(file, opts.outsideVault, jsonMode);

      try {
        if (!fs.existsSync(file)) {
          exitWithError(`File not found: ${file}`, { json: jsonMode }, ExitCode.NotFound);
        }

        const content = fs.readFileSync(file, "utf-8");
        const updated = setFrontmatterArray(content, field, values ?? []);
        writeFileAtomic(file, updated);

        const output = formatOutput(
          { success: true, field, values: values ?? [] },
          {
            json: jsonMode,
            humanReadable: `Set ${field} = [${(values ?? []).join(", ")}]`,
          }
        );
        console.log(output);
      } catch (error) {
        exitWithError(error, { json: jsonMode }, ExitCode.Unclassified);
      }
    });

  fm.command("validate")
    .description("Validate frontmatter against the page type schema")
    .argument("<file>", "Path to the markdown file")
    .option("--type <type>", "Page type to validate against (daily, task, project)")
    .option("--outside-vault", "Allow a file path outside the current workspace", false)
    .action((file: string, opts: { type?: string; outsideVault: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      file = confineFileArg(file, opts.outsideVault, jsonMode);

      try {
        if (!fs.existsSync(file)) {
          exitWithError(`File not found: ${file}`, { json: jsonMode }, ExitCode.NotFound);
        }

        const content = fs.readFileSync(file, "utf-8");
        const parsed = parseFrontmatter(content);

        if (!parsed) {
          exitWithError("No frontmatter found in file", { json: jsonMode }, ExitCode.NotFound);
        }

        const errors = validateFrontmatter(parsed.data, opts.type);

        if (errors.length === 0) {
          const output = formatOutput(
            { success: true, valid: true, errors: [] },
            { json: jsonMode, humanReadable: "Validation passed: no errors found" }
          );
          console.log(output);
          return;
        }

        // Validation failed: emit the structured `errors` array (consumers
        // care about *which* fields failed, not just that something did).
        // Routed through formatOutput (not exitWithError) because the
        // failure carries structured data beyond a single message string.
        // Exit code is InvalidInput — the file's data didn't satisfy the
        // schema, which is a typed semantic, not an unknown failure.
        const errorLines = errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n");
        const output = formatOutput(
          { success: false, valid: false, errors },
          { json: jsonMode, humanReadable: `Validation failed:\n${errorLines}` }
        );
        console.log(output);
        process.exit(ExitCode.InvalidInput);
      } catch (error) {
        exitWithError(error, { json: jsonMode }, ExitCode.Unclassified);
      }
    });
}

/**
 * Vault confinement for frontmatter file args. When the command runs inside
 * a workspace, the file must resolve inside that workspace — an agent
 * passing `../../outside.md` (or an absolute path elsewhere) gets a typed
 * InvalidInput rejection. Operating on out-of-vault files is intentionally
 * supported, but only behind the explicit `--outside-vault` flag. Outside
 * any workspace there is nothing to confine to, and any path is allowed.
 */
function confineFileArg(file: string, allowOutside: boolean, jsonMode: boolean): string {
  const resolved = path.resolve(file);
  if (!allowOutside) {
    const root = findWorkspaceRoot();
    if (root && !isInsideWorkspace(root, resolved)) {
      exitWithError(
        `File is outside the workspace: ${file}. ` +
        `Pass --outside-vault to operate on files outside the vault.`,
        { json: jsonMode },
        ExitCode.InvalidInput,
      );
    }
  }
  return resolved;
}

function parseCliValue(value: string): unknown {
  // Try to parse as JSON (handles arrays, numbers, booleans)
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch {
    // Return as plain string
    return value;
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

function formatAllFields(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join("\n");
}
