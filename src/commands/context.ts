import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import {
  ExitCode,
  formatOutput,
  resolveOutputFromAnyDepth,
  type OutputOptions,
} from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

/**
 * `rubber-ducky context query <kind>` — read structured slices of the
 * ongoing-context-capture pages (`wiki/voice.md`, `about.md`,
 * `vocabulary.md`, `preferences.md`) so drafting skills can pull tone /
 * facts / vocabulary / preferences into their prompts without re-parsing
 * the full pages themselves.
 *
 * The pages are append-only markdown maintained by `/ingest-writing`. The
 * CLI's job is to return their contents in a stable shape — a JSON
 * envelope when piped, a readable card when run in a TTY — so skills
 * never have to read the files freehand and never have to handle the
 * "page doesn't exist yet" case.
 */
export const CONTEXT_KINDS = [
  "voice",
  "about",
  "vocabulary",
  "preferences",
] as const;
export type ContextKind = (typeof CONTEXT_KINDS)[number];

export function isContextKind(value: string): value is ContextKind {
  return (CONTEXT_KINDS as readonly string[]).includes(value);
}

/**
 * Map a kind to its on-disk page. Centralized so the path scheme is the
 * single source of truth — skills that read context pages call this CLI
 * verb rather than hand-rolling paths that would drift.
 */
export function contextPagePath(workspaceRoot: string, kind: ContextKind): string {
  return path.join(workspaceRoot, "wiki", `${kind}.md`);
}

export function registerContextCommand(program: Command): void {
  const context = program
    .command("context")
    .description("Read ongoing-context-capture pages (voice, about, vocabulary, preferences)");

  context
    .command("query")
    .description("Return the structured contents of a context page so drafting skills can pull them into prompts")
    .argument("<kind>", `One of: ${CONTEXT_KINDS.join(", ")}`)
    .action(async (kind: string, _opts: unknown, cmd: Command) => {
      const out = resolveOutputFromAnyDepth(cmd);

      if (!isContextKind(kind)) {
        exitWithError(
          `Unknown context kind "${kind}". Valid kinds: ${CONTEXT_KINDS.join(", ")}.`,
          out,
          ExitCode.InvalidInput,
        );
      }

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        exitWithError(
          "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
          out,
          ExitCode.NotFound,
        );
      }

      try {
        const pagePath = contextPagePath(workspaceRoot, kind);
        const present = fs.existsSync(pagePath);
        const raw = present ? fs.readFileSync(pagePath, "utf-8") : "";
        const sections = parseSections(raw);

        if (out.json) {
          // Default response stays small — sections is the structured view
          // skills consume. The full file body lands under `--verbose` for
          // operators who need it; agents in normal use can re-read the
          // file by path if they need raw bytes.
          const payload: Record<string, unknown> = {
            success: true,
            kind,
            path: path.relative(workspaceRoot, pagePath),
            present,
            sections,
          };
          if (out.verbose) {
            payload.raw = raw;
          }
          console.log(formatOutput(payload, out));
          return;
        }

        renderHuman(kind, sections, present, out);
      } catch (error) {
        exitWithError(error, out, ExitCode.Unclassified);
      }
    });
}

/**
 * Parse a context page into its `##`-delimited sections. Returns a record
 * mapping each heading to its body text (trimmed). Frontmatter and the H1
 * title are skipped. Empty sections come back as empty strings so
 * consumers can distinguish "section exists but no content yet" from
 * "section absent."
 *
 * Fenced code blocks (``` and ~~~) are respected so a vocabulary entry
 * that *quotes* a markdown example containing `## something` doesn't
 * fracture the section. We track the fence character so opening `~~~`
 * is closed by `~~~` rather than `` ``` ``.
 */
export function parseSections(raw: string): Record<string, string> {
  // Strip YAML frontmatter so its `---` boundaries don't get treated as
  // body content. The fence regex is anchored to the very first line.
  const withoutFrontmatter = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const lines = withoutFrontmatter.split("\n");

  const sections: Record<string, string> = {};
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  let fence: "`" | "~" | null = null;

  const flush = (): void => {
    if (currentHeading !== null) {
      sections[currentHeading] = buffer.join("\n").trim();
    }
  };

  for (const line of lines) {
    // CommonMark code fences: 3+ backticks or 3+ tildes at column 0,
    // optionally followed by an info string. Toggle the in-fence flag so
    // a `## ` inside a code block isn't read as a section heading.
    const fenceMatch = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const opener = fenceMatch[1][0] as "`" | "~";
      if (fence === null) {
        fence = opener;
      } else if (fence === opener) {
        fence = null;
      }
      // The fence line itself belongs to the current section's body.
      if (currentHeading !== null) buffer.push(line);
      continue;
    }

    if (fence === null) {
      const match = /^##\s+(.+?)\s*$/.exec(line);
      if (match) {
        flush();
        currentHeading = match[1];
        buffer = [];
        continue;
      }
    }

    if (currentHeading !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function renderHuman(
  kind: ContextKind,
  sections: Record<string, string>,
  present: boolean,
  _out: OutputOptions,
): void {
  if (!present) {
    clack.log.info(
      `No ${chalk.cyan(`wiki/${kind}.md`)} yet — run /ingest-writing to populate it.`,
    );
    return;
  }
  const entries = Object.entries(sections);
  if (entries.length === 0) {
    clack.log.info(
      `${chalk.cyan(`wiki/${kind}.md`)} exists but has no \`##\` sections to surface.`,
    );
    return;
  }
  clack.log.info(`${chalk.bold(kind)} — ${entries.length} section(s)`);
  for (const [heading, body] of entries) {
    const preview = body.length === 0
      ? chalk.dim("(empty)")
      : body.length > 200
        ? `${body.slice(0, 200).trim()}…`
        : body.trim();
    clack.log.info(`${chalk.cyan(heading)}\n${preview}`);
  }
}
