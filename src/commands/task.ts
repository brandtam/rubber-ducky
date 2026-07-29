import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { startTask, closeTask, stampWrite } from "../lib/task.js";
import { formatOutput, ExitCode } from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";
import { isValidIsoDate, invalidDateMessage } from "../lib/dates.js";
import { PathOutsideWorkspaceError } from "../lib/paths.js";

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

      if (opts.date !== undefined && !isValidIsoDate(opts.date)) {
        exitWithError(invalidDateMessage("--date", opts.date), { json: jsonMode }, ExitCode.InvalidInput);
      }

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

      if (opts.date !== undefined && !isValidIsoDate(opts.date)) {
        exitWithError(invalidDateMessage("--date", opts.date), { json: jsonMode }, ExitCode.InvalidInput);
      }

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

  task
    .command("stamp-write")
    .description(
      "Composite post-write stamp: set frontmatter fields, bump comment count, " +
      "stamp pushed/updated, append an activity-log line and a wiki log entry — one call"
    )
    .argument("<file>", "Relative path to the task file (e.g. wiki/tasks/fix-bug.md)")
    .option("--set <field=value...>", "Scalar frontmatter field to set (repeatable; value may be JSON)")
    .option("--tag <tag...>", "Value to append to the tags array (repeatable, deduplicated)")
    .option("--status <status>", 'New status; "done" runs the full task close flow')
    .option("--bump-comments [n]", "Increment comment_count (default 1)")
    .option("--pushed", "Stamp `pushed` with the current timestamp", false)
    .option("--activity <line>", "Line appended to ## Activity log")
    .option("--log <message>", "Message appended to wiki/log.md")
    .option("--validate", "Validate frontmatter (type: task) after stamping", false)
    .option("--date <date>", "Date for the daily page when closing (defaults to today, YYYY-MM-DD)")
    .action(async (
      file: string,
      opts: {
        set?: string[];
        tag?: string[];
        status?: string;
        bumpComments?: string | boolean;
        pushed: boolean;
        activity?: string;
        log?: string;
        validate: boolean;
        date?: string;
      },
      cmd: Command
    ) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      if (opts.date !== undefined && !isValidIsoDate(opts.date)) {
        exitWithError(invalidDateMessage("--date", opts.date), { json: jsonMode }, ExitCode.InvalidInput);
      }

      // Parse --set field=value pairs; value goes through JSON parsing so
      // numbers/booleans/null land typed, everything else stays a string.
      const set: Record<string, unknown> = {};
      for (const pair of opts.set ?? []) {
        const eq = pair.indexOf("=");
        if (eq <= 0) {
          exitWithError(
            `Invalid --set "${pair}" — expected field=value`,
            { json: jsonMode },
            ExitCode.InvalidInput,
          );
        }
        const field = pair.slice(0, eq);
        const raw = pair.slice(eq + 1);
        let value: unknown = raw;
        try {
          value = JSON.parse(raw);
        } catch {
          /* plain string */
        }
        set[field] = value;
      }

      let bumpComments = 0;
      if (opts.bumpComments !== undefined) {
        bumpComments = opts.bumpComments === true ? 1 : Number(opts.bumpComments);
        if (!Number.isInteger(bumpComments) || bumpComments < 1) {
          exitWithError(
            `Invalid --bump-comments "${opts.bumpComments}" — expected a positive integer`,
            { json: jsonMode },
            ExitCode.InvalidInput,
          );
        }
      }

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = stampWrite(workspaceRoot, file, {
          set,
          tags: opts.tag,
          status: opts.status,
          bumpComments,
          pushed: opts.pushed,
          activity: opts.activity,
          log: opts.log,
          validate: opts.validate,
          date: opts.date,
        });

        const valid = result.validationErrors === null || result.validationErrors.length === 0;

        if (jsonMode) {
          console.log(formatOutput(
            {
              success: valid,
              taskFile: result.taskFile,
              taskTitle: result.taskTitle,
              fieldsSet: result.fieldsSet,
              tagsAdded: result.tagsAdded,
              newStatus: result.newStatus,
              closed: result.closed,
              activityEntry: result.activityEntry,
              logEntry: result.logEntry,
              validationErrors: result.validationErrors,
            },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(
            `Stamped ${chalk.bold(result.taskTitle)}\n` +
            `  Fields: ${result.fieldsSet.length > 0 ? result.fieldsSet.join(", ") : "(none)"}` +
            (result.tagsAdded.length > 0 ? `\n  Tags: ${result.tagsAdded.join(", ")}` : "") +
            (result.newStatus ? `\n  Status: ${chalk.green(result.newStatus)}` : "") +
            (result.activityEntry ? `\n  Activity: ${result.activityEntry}` : "") +
            (result.validationErrors && result.validationErrors.length > 0
              ? `\n  ${chalk.red("Validation errors:")} ${result.validationErrors.map((e) => `${e.field}: ${e.message}`).join("; ")}`
              : "")
          );
        }

        if (!valid) {
          // Stamped, but the resulting frontmatter fails the task schema —
          // surface it as InvalidInput so callers notice.
          process.exit(ExitCode.InvalidInput);
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

function handleNoWorkspace(jsonMode: boolean): never {
  exitWithError(
    "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
    {
      json: jsonMode,
      humanReadable:
        `Not inside a Rubber-Ducky workspace.\n` +
        `Run ${chalk.bold("rubber-ducky init")} to create one.`,
    },
    ExitCode.NotFound,
  );
}

function handleError(error: unknown, jsonMode: boolean): never {
  // Path escapes are invalid input, recognized by identity (not message
  // parsing) so refactors can't silently demote the exit code.
  const code = error instanceof PathOutsideWorkspaceError
    ? ExitCode.InvalidInput
    : ExitCode.Unclassified;
  exitWithError(error, { json: jsonMode }, code);
}
