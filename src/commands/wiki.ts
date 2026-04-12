import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { rebuildIndex, appendLog, searchWiki } from "../lib/wiki.js";
import { formatOutput } from "../lib/output.js";

export function registerIndexCommand(program: Command): void {
  const index = program
    .command("index")
    .description("Manage the wiki index");

  index
    .command("rebuild")
    .description("Regenerate wiki/index.md with grouped tables")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = rebuildIndex(workspaceRoot);

        if (jsonMode) {
          const output = formatOutput(
            {
              success: true,
              filePath: result.filePath,
              relativePath: result.relativePath,
              totalPages: result.totalPages,
              pages: result.pages,
            },
            { json: jsonMode }
          );
          console.log(output);
        } else {
          clack.log.success(
            `Rebuilt index at ${chalk.cyan(result.relativePath)}\n` +
            `  ${chalk.bold(String(result.totalPages))} pages indexed ` +
            `(${result.pages.daily} daily, ${result.pages.task} tasks, ${result.pages.project} projects)`
          );
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

export function registerLogCommand(program: Command): void {
  const log = program
    .command("log")
    .description("Manage the wiki log");

  log
    .command("append")
    .description("Add a timestamped entry to wiki/log.md")
    .argument("<message>", "Log message to append")
    .action(async (message: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = appendLog(workspaceRoot, message);

        if (jsonMode) {
          const output = formatOutput(
            {
              success: true,
              filePath: result.filePath,
              relativePath: result.relativePath,
              entry: result.entry,
            },
            { json: jsonMode }
          );
          console.log(output);
        } else {
          clack.log.success(
            `Appended to ${chalk.cyan(result.relativePath)}\n` +
            `  ${result.entry}`
          );
        }
      } catch (error) {
        handleError(error, jsonMode);
      }
    });
}

export function registerWikiCommand(program: Command): void {
  const wiki = program
    .command("wiki")
    .description("Wiki search and operations");

  wiki
    .command("search")
    .description("Search across wiki pages for keywords")
    .argument("<query>", "Search query (keywords to find)")
    .option("--type <type>", "Filter by page type (daily, task, project)")
    .option("--from <date>", "Filter daily pages from this date (YYYY-MM-DD)")
    .option("--to <date>", "Filter daily pages to this date (YYYY-MM-DD)")
    .action(async (query: string, opts: { type?: string; from?: string; to?: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(jsonMode);
      }

      try {
        const result = searchWiki(workspaceRoot, query, {
          type: opts.type,
          from: opts.from,
          to: opts.to,
        });

        if (jsonMode) {
          const output = formatOutput(
            {
              success: true,
              query: result.query,
              totalMatches: result.totalMatches,
              matches: result.matches,
            },
            { json: jsonMode }
          );
          console.log(output);
        } else {
          if (result.totalMatches === 0) {
            clack.log.info(`No matches found for "${query}"`);
          } else {
            clack.log.success(
              `Found ${chalk.bold(String(result.totalMatches))} match(es) for "${query}"`
            );
            for (const match of result.matches) {
              const title = match.frontmatter.title
                ? String(match.frontmatter.title)
                : match.relativePath;
              clack.log.info(
                `${chalk.cyan(match.relativePath)} (${match.type})\n` +
                `  Title: ${title}\n` +
                match.matchingLines
                  .slice(0, 3)
                  .map((l) => `  L${l.lineNumber}: ${l.text.trim()}`)
                  .join("\n")
              );
            }
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
