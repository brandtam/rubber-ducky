import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { rebuildIndex, appendLog, searchWiki, searchResultToJson } from "../lib/wiki.js";
import { ExitCode, formatOutput, resolveOutputOptions, type OutputOptions } from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

export function registerIndexCommand(program: Command): void {
  const index = program
    .command("index")
    .description("Manage the wiki index");

  index
    .command("rebuild")
    .description("Regenerate wiki/index.md with grouped tables")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const out = resolveOutputOptions(globalOpts);

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(out);
      }

      try {
        const result = rebuildIndex(workspaceRoot);

        if (out.json) {
          const output = formatOutput(
            {
              success: true,
              filePath: result.filePath,
              relativePath: result.relativePath,
              totalPages: result.totalPages,
              pages: result.pages,
            },
            out,
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
        handleError(error, out);
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
      const out = resolveOutputOptions(globalOpts);

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(out);
      }

      try {
        const result = appendLog(workspaceRoot, message);

        if (out.json) {
          const output = formatOutput(
            {
              success: true,
              filePath: result.filePath,
              relativePath: result.relativePath,
              entry: result.entry,
            },
            out,
          );
          console.log(output);
        } else {
          clack.log.success(
            `Appended to ${chalk.cyan(result.relativePath)}\n` +
            `  ${result.entry}`
          );
        }
      } catch (error) {
        handleError(error, out);
      }
    });
}

const DEFAULT_SEARCH_LIMIT = 10;

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
    // Default limit caps the response so an agent doesn't see hundreds of
    // matches when a few are enough. Override with `--limit <n>` for an
    // explicit cap, or pass `--verbose` (global) to return every match.
    .option(
      "--limit <n>",
      `Maximum matches to return (default ${DEFAULT_SEARCH_LIMIT}; ignored under --verbose)`,
      String(DEFAULT_SEARCH_LIMIT),
    )
    .action(async (query: string, opts: { type?: string; from?: string; to?: string; limit: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const out = resolveOutputOptions(globalOpts);

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        return handleNoWorkspace(out);
      }

      const parsedLimit = Number.parseInt(opts.limit, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 0) {
        exitWithError(
          `Invalid --limit value: ${opts.limit}. Must be a non-negative integer.`,
          out,
          ExitCode.InvalidInput,
        );
      }

      try {
        const result = searchWiki(workspaceRoot, query, {
          type: opts.type,
          from: opts.from,
          to: opts.to,
        });

        const json = searchResultToJson(result, { verbose: out.verbose, limit: parsedLimit });

        if (out.json) {
          console.log(formatOutput(json, out));
        } else {
          if (json.totalMatches === 0) {
            clack.log.info(`No matches found for "${query}"`);
          } else {
            const headline = json.truncated
              ? `Found ${chalk.bold(String(json.totalMatches))} match(es) for "${query}" (showing first ${json.returnedMatches} — pass --verbose or --limit for more)`
              : `Found ${chalk.bold(String(json.totalMatches))} match(es) for "${query}"`;
            clack.log.success(headline);
            for (const match of json.matches) {
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
        handleError(error, out);
      }
    });
}

function handleNoWorkspace(out: OutputOptions): never {
  exitWithError(
    "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
    {
      ...out,
      humanReadable:
        `Not inside a Rubber-Ducky workspace.\n` +
        `Run ${chalk.bold("rubber-ducky init")} to create one.`,
    },
    ExitCode.NotFound,
  );
}

function handleError(error: unknown, out: OutputOptions): never {
  exitWithError(error, out, ExitCode.Unclassified);
}
