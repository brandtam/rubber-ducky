import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current workspace info")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();

      if (!workspaceRoot) {
        if (jsonMode) {
          const output = formatOutput(
            {
              success: false,
              error:
                "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
            },
            {
              json: jsonMode,
              humanReadable:
                "Error: Not inside a Rubber-Ducky workspace.",
            }
          );
          console.log(output);
          process.exit(1);
        }

        clack.log.error(
          `Not inside a Rubber-Ducky workspace.\n` +
            `Run ${chalk.bold("rubber-ducky init")} to create one.`
        );
        process.exit(1);
      }

      try {
        const config = loadWorkspaceConfig(workspaceRoot);

        if (jsonMode) {
          const output = formatOutput(
            { success: true, workspace: config },
            {
              json: jsonMode,
              humanReadable: `Workspace: ${config.name} (${config.workspaceRoot})`,
            }
          );
          console.log(output);
        } else {
          clack.intro(chalk.bold("rubber-ducky status"));
          clack.note(
            [
              `${chalk.bold("Name:")} ${config.name}`,
              `${chalk.bold("Purpose:")} ${config.purpose}`,
              `${chalk.bold("Version:")} ${config.version}`,
              `${chalk.bold("Created:")} ${config.created}`,
              `${chalk.bold("Backends:")} ${config.backends.length === 0 ? "none" : config.backends.join(", ")}`,
            ].join("\n"),
            config.workspaceRoot
          );
          clack.outro(chalk.green("Workspace detected."));
        }
      } catch (error) {
        if (jsonMode) {
          const output = formatOutput(
            {
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            },
            {
              json: jsonMode,
              humanReadable: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            }
          );
          console.log(output);
          process.exit(1);
        }
        clack.log.error(
          error instanceof Error ? error.message : "Unknown error"
        );
        process.exit(1);
      }
    });
}
