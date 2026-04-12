import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { createPage } from "../lib/page.js";
import { formatOutput } from "../lib/output.js";

export function registerPageCommand(program: Command): void {
  const page = program
    .command("page")
    .description("Manage wiki pages");

  const create = page
    .command("create")
    .description("Create a new page");

  // page create daily [date]
  create
    .command("daily")
    .description("Create a daily page")
    .argument("[date]", "Date in YYYY-MM-DD format (defaults to today)")
    .action(async (date: string | undefined, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = createPage(workspaceRoot, "daily", { date });
        outputResult(result, jsonMode);
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  // page create task <title> [--source] [--ref]
  create
    .command("task")
    .description("Create a task page")
    .argument("<title>", "Task title")
    .option("--source <source>", "Source backend (e.g. jira, github, asana)")
    .option("--ref <ref>", "External reference ID")
    .action(async (title: string, opts: { source?: string; ref?: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = createPage(workspaceRoot, "task", {
          title,
          source: opts.source,
          ref: opts.ref,
        });
        outputResult(result, jsonMode);
      } catch (error) {
        handleError(error, jsonMode);
      }
    });

  // page create project <title>
  create
    .command("project")
    .description("Create a project page")
    .argument("<title>", "Project title")
    .action(async (title: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = createPage(workspaceRoot, "project", { title });
        outputResult(result, jsonMode);
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

function outputResult(
  result: { filePath: string; relativePath: string; pageType: string; created: boolean },
  jsonMode: boolean
): void {
  if (jsonMode) {
    const output = formatOutput(
      {
        success: true,
        filePath: result.filePath,
        relativePath: result.relativePath,
        pageType: result.pageType,
        created: result.created,
      },
      {
        json: jsonMode,
        humanReadable: `Created ${result.pageType} page: ${result.relativePath}`,
      }
    );
    console.log(output);
  } else {
    clack.log.success(
      `Created ${chalk.bold(result.pageType)} page: ${chalk.cyan(result.relativePath)}`
    );
  }
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
