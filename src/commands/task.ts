import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { startTask, closeTask } from "../lib/task.js";
import { formatOutput } from "../lib/output.js";

export function registerTaskCommand(program: Command): void {
  const task = program
    .command("task")
    .description("Start or close tasks");

  task
    .command("start")
    .description("Set a task to in-progress and update the daily page")
    .argument("<file>", "Relative path to the task file (e.g. wiki/tasks/fix-bug.md)")
    .option("--date <date>", "Date for daily page (defaults to today, YYYY-MM-DD)")
    .action(async (file: string, opts: { date?: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = startTask(workspaceRoot, file, opts.date);

        if (jsonMode) {
          const output = formatOutput(
            {
              success: true,
              taskFile: result.taskFile,
              taskTitle: result.taskTitle,
              previousStatus: result.previousStatus,
              newStatus: result.newStatus,
              dailyFile: result.dailyFile,
              activityEntry: result.activityEntry,
            },
            { json: jsonMode }
          );
          console.log(output);
        } else {
          clack.log.success(
            `Started task ${chalk.bold(result.taskTitle)}\n` +
            `  Status: ${chalk.yellow(result.previousStatus)} → ${chalk.green(result.newStatus)}\n` +
            `  Daily: ${chalk.cyan(result.dailyFile)}`
          );
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  task
    .command("close")
    .description("Set a task to done and update the daily page")
    .argument("<file>", "Relative path to the task file (e.g. wiki/tasks/fix-bug.md)")
    .option("--date <date>", "Date for daily page (defaults to today, YYYY-MM-DD)")
    .action(async (file: string, opts: { date?: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = closeTask(workspaceRoot, file, opts.date);

        if (jsonMode) {
          const output = formatOutput(
            {
              success: true,
              taskFile: result.taskFile,
              taskTitle: result.taskTitle,
              previousStatus: result.previousStatus,
              newStatus: result.newStatus,
              closedDate: result.closedDate,
              dailyFile: result.dailyFile,
              activityEntry: result.activityEntry,
              logEntry: result.logEntry,
              clearedActiveTask: result.clearedActiveTask,
            },
            { json: jsonMode }
          );
          console.log(output);
        } else {
          clack.log.success(
            `Closed task ${chalk.bold(result.taskTitle)}\n` +
            `  Status: ${chalk.yellow(result.previousStatus)} → ${chalk.green(result.newStatus)}\n` +
            `  Closed: ${chalk.cyan(result.closedDate)}\n` +
            `  Daily: ${chalk.cyan(result.dailyFile)}` +
            (result.clearedActiveTask ? `\n  ${chalk.dim("Cleared active task")}` : "")
          );
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
