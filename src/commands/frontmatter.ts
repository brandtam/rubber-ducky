import { Command } from "commander";
import * as fs from "node:fs";
import {
  parseFrontmatter,
  setFrontmatterField,
  validateFrontmatter,
} from "../lib/frontmatter.js";
import { formatOutput } from "../lib/output.js";

export function registerFrontmatterCommand(program: Command): void {
  const fm = program
    .command("frontmatter")
    .description("Read, write, and validate YAML frontmatter");

  fm.command("get")
    .description("Read frontmatter from a markdown file")
    .argument("<file>", "Path to the markdown file")
    .argument("[field]", "Specific field to read")
    .action((file: string, field: string | undefined, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      try {
        if (!fs.existsSync(file)) {
          const output = formatOutput(
            { success: false, error: `File not found: ${file}` },
            { json: jsonMode, humanReadable: `Error: File not found: ${file}` }
          );
          console.log(output);
          process.exit(1);
        }

        const content = fs.readFileSync(file, "utf-8");
        const parsed = parseFrontmatter(content);

        if (!parsed) {
          const output = formatOutput(
            { success: false, error: "No frontmatter found in file" },
            { json: jsonMode, humanReadable: "Error: No frontmatter found in file" }
          );
          console.log(output);
          process.exit(1);
        }

        if (field) {
          if (!(field in parsed.data)) {
            const output = formatOutput(
              { success: false, error: `Field "${field}" not found in frontmatter` },
              { json: jsonMode, humanReadable: `Error: Field "${field}" not found in frontmatter` }
            );
            console.log(output);
            process.exit(1);
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
        const msg = error instanceof Error ? error.message : "Unknown error";
        const output = formatOutput(
          { success: false, error: msg },
          { json: jsonMode, humanReadable: `Error: ${msg}` }
        );
        console.log(output);
        process.exit(1);
      }
    });

  fm.command("set")
    .description("Set a frontmatter field in a markdown file")
    .argument("<file>", "Path to the markdown file")
    .argument("<field>", "Field name to set")
    .argument("<value>", "Value to set")
    .action((file: string, field: string, value: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      try {
        if (!fs.existsSync(file)) {
          const output = formatOutput(
            { success: false, error: `File not found: ${file}` },
            { json: jsonMode, humanReadable: `Error: File not found: ${file}` }
          );
          console.log(output);
          process.exit(1);
        }

        const content = fs.readFileSync(file, "utf-8");
        const parsedValue = parseCliValue(value);
        const updated = setFrontmatterField(content, field, parsedValue);
        fs.writeFileSync(file, updated, "utf-8");

        const output = formatOutput(
          { success: true, field, value: parsedValue },
          { json: jsonMode, humanReadable: `Set ${field} = ${formatValue(parsedValue)}` }
        );
        console.log(output);
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        const output = formatOutput(
          { success: false, error: msg },
          { json: jsonMode, humanReadable: `Error: ${msg}` }
        );
        console.log(output);
        process.exit(1);
      }
    });

  fm.command("validate")
    .description("Validate frontmatter against the page type schema")
    .argument("<file>", "Path to the markdown file")
    .option("--type <type>", "Page type to validate against (daily, task, project)")
    .action((file: string, opts: { type?: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      try {
        if (!fs.existsSync(file)) {
          const output = formatOutput(
            { success: false, error: `File not found: ${file}` },
            { json: jsonMode, humanReadable: `Error: File not found: ${file}` }
          );
          console.log(output);
          process.exit(1);
        }

        const content = fs.readFileSync(file, "utf-8");
        const parsed = parseFrontmatter(content);

        if (!parsed) {
          const output = formatOutput(
            { success: false, error: "No frontmatter found in file", valid: false, errors: [] },
            { json: jsonMode, humanReadable: "Error: No frontmatter found in file" }
          );
          console.log(output);
          process.exit(1);
        }

        const errors = validateFrontmatter(parsed.data, opts.type);

        if (errors.length === 0) {
          const output = formatOutput(
            { success: true, valid: true, errors: [] },
            { json: jsonMode, humanReadable: "Validation passed: no errors found" }
          );
          console.log(output);
        } else {
          const errorLines = errors.map((e) => `  - ${e.field}: ${e.message}`).join("\n");
          const output = formatOutput(
            { success: false, valid: false, errors },
            { json: jsonMode, humanReadable: `Validation failed:\n${errorLines}` }
          );
          console.log(output);
          process.exit(1);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        const output = formatOutput(
          { success: false, error: msg },
          { json: jsonMode, humanReadable: `Error: ${msg}` }
        );
        console.log(output);
        process.exit(1);
      }
    });
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
