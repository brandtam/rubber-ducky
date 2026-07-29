import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { createPage, EmptySlugError, PageExistsError } from "../lib/page.js";
import { isValidIsoDate, invalidDateMessage } from "../lib/dates.js";
import { formatOutput, ExitCode } from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

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

      assertDateFlags(jsonMode, [["[date]", date]]);

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

  // page create task <title> [--source] [--ref] [--project]
  create
    .command("task")
    .description("Create a task page")
    .argument("<title>", "Task title")
    .option("--source <source>", "Source backend (e.g. jira, github, asana)")
    .option("--ref <ref>", "External reference ID")
    .option("--project <slug>", "Project slug to associate this task with (matches wiki/projects/<slug>/)")
    .action(async (title: string, opts: { source?: string; ref?: string; project?: string }, cmd: Command) => {
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
          project: opts.project,
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

  // page create meeting <title> [--date] [--start] [--end] [--attendees] [--project]
  create
    .command("meeting")
    .description("Create a meeting page")
    .argument("<title>", "Meeting title")
    .option("--date <date>", "Meeting date in YYYY-MM-DD (defaults to today)")
    .option("--start <time>", "Start time HH:MM")
    .option("--end <time>", "End time HH:MM")
    .option("--attendees <names>", "Comma-separated attendee names")
    .option("--project <slug>", "Project slug to associate this meeting with")
    .action(
      async (
        title: string,
        opts: {
          date?: string;
          start?: string;
          end?: string;
          attendees?: string;
          project?: string;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
        const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

        assertDateFlags(jsonMode, [["--date", opts.date]]);

        const workspaceRoot = findWorkspaceRoot();
        if (!workspaceRoot) {
          return handleNoWorkspace(jsonMode);
        }

        try {
          const attendees = opts.attendees
            ? opts.attendees.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined;
          const result = createPage(workspaceRoot, "meeting", {
            title,
            date: opts.date,
            start: opts.start,
            end: opts.end,
            attendees,
            project: opts.project,
          });
          outputResult(result, jsonMode);
        } catch (error) {
          handleError(error, jsonMode);
        }
      }
    );

  // page create weekly [--date] [--period-start] [--period-end]
  create
    .command("weekly")
    .description("Create a weekly summary page")
    .option("--date <date>", "Date for the summary in YYYY-MM-DD (defaults to today; also used as period-end if --period-end is omitted)")
    .option("--period-start <date>", "Start of the period covered (YYYY-MM-DD); defaults to 7 days before period-end")
    .option("--period-end <date>", "End of the period covered (YYYY-MM-DD); defaults to --date or today")
    .action(
      async (
        opts: { date?: string; periodStart?: string; periodEnd?: string },
        cmd: Command
      ) => {
        const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
        const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

        assertDateFlags(jsonMode, [
          ["--date", opts.date],
          ["--period-start", opts.periodStart],
          ["--period-end", opts.periodEnd],
        ]);

        const workspaceRoot = findWorkspaceRoot();
        if (!workspaceRoot) {
          return handleNoWorkspace(jsonMode);
        }

        try {
          const result = createPage(workspaceRoot, "weekly", {
            date: opts.date,
            periodStart: opts.periodStart,
            periodEnd: opts.periodEnd,
          });
          outputResult(result, jsonMode);
        } catch (error) {
          handleError(error, jsonMode);
        }
      }
    );

  // page create repo <title> [--repo] [--changelog-path] [--reference-pattern] [--default-branch]
  create
    .command("repo")
    .description("Create a repo page (tracks releases for a code repository)")
    .argument("<title>", "Repo page title (typically the repo name)")
    .option("--repo <owner/repo>", "Upstream repository in owner/repo form (e.g. acme/storefront)")
    .option("--changelog-path <path>", "Path to the changelog file inside the repo (default: CHANGELOG.md)")
    .option("--reference-pattern <regex>", "Regex for extracting ticket refs from changelog entries (e.g. 'WEB-\\d+')")
    .option("--default-branch <name>", "Default branch to fetch the changelog from (default: main)")
    .action(
      async (
        title: string,
        opts: {
          repo?: string;
          changelogPath?: string;
          referencePattern?: string;
          defaultBranch?: string;
        },
        cmd: Command
      ) => {
        const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
        const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

        const workspaceRoot = findWorkspaceRoot();
        if (!workspaceRoot) {
          return handleNoWorkspace(jsonMode);
        }

        try {
          const result = createPage(workspaceRoot, "repo", {
            title,
            repo: opts.repo,
            changelogPath: opts.changelogPath,
            releaseReferencePattern: opts.referencePattern,
            defaultBranch: opts.defaultBranch,
          });
          outputResult(result, jsonMode);
        } catch (error) {
          handleError(error, jsonMode);
        }
      }
    );

  // page create spike <title> [--project] [--vendor]
  create
    .command("spike")
    .description("Create a spike (investigation) page")
    .argument("<title>", "Spike title")
    .option("--project <slug>", "Project slug to associate this spike with")
    .option("--vendor <name>", "Vendor or system being investigated")
    .action(
      async (
        title: string,
        opts: { project?: string; vendor?: string },
        cmd: Command
      ) => {
        const globalOpts = cmd.parent?.parent?.parent?.opts() ?? {};
        const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

        const workspaceRoot = findWorkspaceRoot();
        if (!workspaceRoot) {
          return handleNoWorkspace(jsonMode);
        }

        try {
          const result = createPage(workspaceRoot, "spike", {
            title,
            project: opts.project,
            vendor: opts.vendor,
          });
          outputResult(result, jsonMode);
        } catch (error) {
          handleError(error, jsonMode);
        }
      }
    );
}

/**
 * Validate optional date flags before any of them reaches a file path or
 * page content. Rejects with the typed InvalidInput exit code. This is also
 * what turns `weekly`'s former opaque "Invalid Date" throw into a clear
 * rejection.
 */
function assertDateFlags(
  jsonMode: boolean,
  flags: Array<[name: string, value: string | undefined]>
): void {
  for (const [name, value] of flags) {
    if (value !== undefined && !isValidIsoDate(value)) {
      exitWithError(invalidDateMessage(name, value), { json: jsonMode }, ExitCode.InvalidInput);
    }
  }
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

function handleError(error: unknown, jsonMode: boolean): never {
  // Recognize "page already exists" by error identity, not by parsing the
  // message string, so a future refactor of the error text doesn't silently
  // demote the exit code from StateConflict back to Unclassified.
  const code = error instanceof PageExistsError
    ? ExitCode.StateConflict
    : error instanceof EmptySlugError
    ? ExitCode.InvalidInput
    : ExitCode.Unclassified;

  exitWithError(error, { json: jsonMode }, code);
}
