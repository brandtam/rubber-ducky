import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { checkStatusFlag } from "../lib/wiki.js";
import { formatOutput } from "../lib/output.js";

export function registerStatusCommand(program: Command): void {
  const status = program
    .command("status")
    .description("Show workspace info or check status flags")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();

      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
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
              `${chalk.bold("Backends:")} ${config.backends.length === 0 ? "none" : config.backends.map((b: { type: string }) => b.type).join(", ")}`,
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

  status
    .command("check")
    .description("Check whether a status flag is set for a date")
    .argument("<flag>", "Flag to check (e.g., morning-brief, wrap-up)")
    .argument("[date]", "Date in YYYY-MM-DD format (defaults to today)")
    .action(async (flag: string, date: string | undefined, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = checkStatusFlag(workspaceRoot, flag, date);

        if (jsonMode) {
          const output = formatOutput(
            {
              success: true,
              flag: result.flag,
              date: result.date,
              flagSet: result.flagSet,
              pageExists: result.pageExists,
            },
            { json: jsonMode }
          );
          console.log(output);
        } else {
          if (result.flagSet) {
            clack.log.success(
              `${chalk.bold(result.flag)} is ${chalk.green("set")} for ${result.date}`
            );
          } else {
            clack.log.info(
              `${chalk.bold(result.flag)} is ${chalk.yellow("not set")} for ${result.date}` +
              (!result.pageExists ? ` (no daily page found)` : "")
            );
          }
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

function handleNoWorkspace(jsonMode: boolean): void {
  if (jsonMode) {
    const output = formatOutput(
      {
        success: false,
        error: "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
      },
      {
        json: jsonMode,
        humanReadable: "Error: Not inside a Rubber-Ducky workspace.",
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

function handleError(error: unknown, jsonMode: boolean): void {
  const message = error instanceof Error ? error.message : "Unknown error";

  if (jsonMode) {
    const output = formatOutput(
      { success: false, error: message },
      { json: jsonMode, humanReadable: `Error: ${message}` }
    );
    console.log(output);
    process.exit(1);
  }

  clack.log.error(message);
  process.exit(1);
}
