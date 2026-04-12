import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import {
  addAsap,
  listAsap,
  resolveAsap,
  addReminder,
  listReminders,
  resolveReminder,
  addIdea,
  listIdeas,
  ingestScreenshot,
} from "../lib/capture.js";
import { formatOutput } from "../lib/output.js";

// ── ASAP command ────────────────────────────────────────────────────────────

export function registerAsapCommand(program: Command): void {
  const asap = program
    .command("asap")
    .description("Manage ASAP items — urgent obligations that persist until handled");

  asap
    .command("add")
    .description("Add an item to the ASAP list")
    .argument("<message>", "ASAP item description")
    .action(async (message: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = addAsap(workspaceRoot, message);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, message: result.message, index: result.index, relativePath: result.relativePath },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(
            `Added ASAP item #${result.index}: ${chalk.cyan(result.message)}`
          );
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  asap
    .command("list")
    .description("List all ASAP items")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = listAsap(workspaceRoot);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, items: result.items, total: result.total, pending: result.pending },
            { json: jsonMode }
          ));
        } else {
          if (result.items.length === 0) {
            clack.log.info("No ASAP items.");
          } else {
            for (const item of result.items) {
              const check = item.resolved ? chalk.green("✓") : chalk.yellow("○");
              const msg = item.resolved ? chalk.dim(item.message) : item.message;
              clack.log.info(`${check} #${item.index}: ${msg}`);
            }
            clack.log.info(`${result.pending} pending, ${result.total} total`);
          }
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  asap
    .command("resolve")
    .description("Mark an ASAP item as handled")
    .argument("<index>", "Item index to resolve")
    .action(async (indexStr: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const index = parseInt(indexStr, 10);
        if (isNaN(index)) throw new Error("Index must be a number.");

        const result = resolveAsap(workspaceRoot, index);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, index: result.index, message: result.message, resolved: result.resolved },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(`Resolved ASAP item #${result.index}: ${chalk.cyan(result.message)}`);
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

// ── Remind command ──────────────────────────────────────────────────────────

export function registerRemindCommand(program: Command): void {
  const remind = program
    .command("remind")
    .description("Manage date-keyed reminders");

  remind
    .command("add")
    .description("Set a reminder for a specific date")
    .argument("<date>", "Target date (YYYY-MM-DD)")
    .argument("<message>", "Reminder message")
    .action(async (date: string, message: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = addReminder(workspaceRoot, date, message);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, message: result.message, date: result.date, index: result.index, relativePath: result.relativePath },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(
            `Set reminder #${result.index} for ${chalk.cyan(result.date)}: ${result.message}`
          );
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  remind
    .command("list")
    .description("List reminders, optionally filtered by date")
    .argument("[date]", "Filter by target date (YYYY-MM-DD)")
    .action(async (date: string | undefined, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = listReminders(workspaceRoot, date);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, items: result.items, total: result.total, pending: result.pending },
            { json: jsonMode }
          ));
        } else {
          if (result.items.length === 0) {
            clack.log.info(date ? `No reminders for ${date}.` : "No reminders.");
          } else {
            for (const item of result.items) {
              const check = item.resolved ? chalk.green("✓") : chalk.yellow("○");
              const msg = item.resolved ? chalk.dim(item.message) : item.message;
              clack.log.info(`${check} #${item.index} [${item.date}]: ${msg}`);
            }
            clack.log.info(`${result.pending} pending, ${result.total} total`);
          }
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  remind
    .command("resolve")
    .description("Mark a reminder as handled")
    .argument("<index>", "Reminder index to resolve")
    .action(async (indexStr: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const index = parseInt(indexStr, 10);
        if (isNaN(index)) throw new Error("Index must be a number.");

        const result = resolveReminder(workspaceRoot, index);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, index: result.index, message: result.message, resolved: result.resolved },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(`Resolved reminder #${result.index}: ${chalk.cyan(result.message)}`);
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

// ── Idea command ────────────────────────────────────────────────────────────

export function registerIdeaCommand(program: Command): void {
  const idea = program
    .command("idea")
    .description("Manage the someday/maybe ideas list");

  idea
    .command("add")
    .description("Add an idea to the list")
    .argument("<message>", "Idea description")
    .action(async (message: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = addIdea(workspaceRoot, message);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, message: result.message, index: result.index, relativePath: result.relativePath },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(`Added idea #${result.index}: ${chalk.cyan(result.message)}`);
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  idea
    .command("list")
    .description("List all ideas")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = listIdeas(workspaceRoot);

        if (jsonMode) {
          console.log(formatOutput(
            { success: true, items: result.items, total: result.total },
            { json: jsonMode }
          ));
        } else {
          if (result.items.length === 0) {
            clack.log.info("No ideas yet.");
          } else {
            for (const item of result.items) {
              clack.log.info(`#${item.index}: ${item.message}`);
            }
            clack.log.info(`${result.total} ideas total`);
          }
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

// ── Screenshot command ──────────────────────────────────────────────────────

export function registerScreenshotCommand(program: Command): void {
  const screenshot = program
    .command("screenshot")
    .description("Screenshot ingest operations");

  screenshot
    .command("ingest")
    .description("Copy a screenshot to raw/ and create a task page")
    .argument("<path>", "Path to the screenshot file")
    .argument("<title>", "Title for the task page")
    .action(async (imagePath: string, title: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) return handleNoWorkspace(jsonMode);

      try {
        const result = ingestScreenshot(workspaceRoot, imagePath, title);

        if (jsonMode) {
          console.log(formatOutput(
            {
              success: true,
              title: result.title,
              rawRelativePath: result.rawRelativePath,
              taskRelativePath: result.taskRelativePath,
            },
            { json: jsonMode }
          ));
        } else {
          clack.log.success(
            `Ingested screenshot as task: ${chalk.cyan(result.title)}\n` +
            `  Raw: ${result.rawRelativePath}\n` +
            `  Task: ${result.taskRelativePath}`
          );
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function handleNoWorkspace(jsonMode: boolean): void {
  if (jsonMode) {
    console.log(formatOutput(
      { success: false, error: "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one." },
      { json: jsonMode, humanReadable: "Error: Not inside a Rubber-Ducky workspace." }
    ));
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
    console.log(formatOutput(
      { success: false, error: message },
      { json: jsonMode, humanReadable: `Error: ${message}` }
    ));
    process.exit(1);
  }

  clack.log.error(message);
  process.exit(1);
}
