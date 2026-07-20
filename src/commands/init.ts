import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs";
import chalk from "chalk";
import { createWorkspace, workspaceResultToJson } from "../lib/workspace.js";
import { ExitCode, formatOutput, resolveOutputOptions } from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a new Rubber-Ducky workspace")
    .argument("<directory>", "Target directory (workspace name is derived from its basename)")
    .action(async (directory: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const out = resolveOutputOptions(globalOpts);

      const fullPath = path.resolve(process.cwd(), directory);
      const name = path.basename(fullPath);

      // Validate the directory's basename at this boundary. Reject input
      // with leading/trailing whitespace outright instead of silently
      // trimming it: a trim would create a directory on disk whose name
      // doesn't match the workspace's `name:` field, which is exactly the
      // kind of subtle inconsistency that bites tooling later. After this
      // gate, `name` is the canonical identifier used everywhere downstream.
      if (name !== name.trim() || name.length === 0) {
        exitWithError(
          `Invalid workspace name "${name}": leading/trailing whitespace is not allowed.`,
          out,
          ExitCode.InvalidInput,
        );
      }

      if (fs.existsSync(fullPath)) {
        const entries = fs.readdirSync(fullPath);
        if (entries.length > 0) {
          exitWithError(
            `Directory "${fullPath}" already exists and is not empty. ` +
            `init creates a fresh workspace — please choose an empty directory or remove existing content first.`,
            out,
            ExitCode.StateConflict,
          );
        }
      }

      try {
        const result = await createWorkspace({
          name,
          targetDir: fullPath,
        });

        if (out.json) {
          console.log(formatOutput(workspaceResultToJson(result, out), out));
          return;
        }

        const lines = [
          chalk.green(`✓ Created workspace at ${chalk.bold(result.workspacePath)}`),
          "",
          chalk.bold("Next steps:"),
          `  1. ${chalk.cyan(`cd ${path.relative(process.cwd(), fullPath) || fullPath}`)}`,
          `  2. ${chalk.cyan("claude")}  (from the terminal, or pointed here from Claude Code Desktop)`,
          `  3. Say ${chalk.cyan("hi")} once you're in — I'll get you set up.`,
          "",
          `To wire up an integration, run ${chalk.cyan("/connect <name>")} from inside Claude.`,
        ];
        console.log(lines.join("\n"));
      } catch (error) {
        exitWithError(error, out, ExitCode.Unclassified);
      }
    });
}
