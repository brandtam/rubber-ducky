import { Command } from "commander";
import * as fs from "node:fs";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { parseFrontmatter } from "../lib/frontmatter.js";
import {
  computeDrift,
  parseIncomingPayload,
  DriftPayloadError,
  type FieldDrift,
} from "../lib/drift.js";
import {
  ExitCode,
  formatOutput,
  resolveOutputFromAnyDepth,
} from "../lib/output.js";
import { exitWithError } from "../lib/cli-errors.js";

/**
 * `rubber-ducky drift <page>` — deterministic wiki-vs-incoming frontmatter
 * diff.
 *
 * The Agent fetches from the external service, normalizes field names and
 * values per the bridge doc, and hands the result here as a JSON object
 * (stdin by default, or `--incoming <file>`). This verb only compares — it
 * performs no network access and reads no files beyond the target page and
 * the payload file the caller explicitly names. See
 * docs/adr/drift-pure-structural-diff.md for the boundary.
 *
 * Exit codes (typed, per src/lib/output.ts conventions):
 * - 0 (Success)       — no drift; empty disagreements report.
 * - 7 (StateConflict) — drift found; the wiki state conflicts with the
 *                       incoming state. Mirrors `frontmatter validate`'s
 *                       pattern of a structured `success: false` payload on
 *                       stdout with a typed non-zero code.
 * - 2 (InvalidInput)  — malformed payload (bad JSON, or not an object).
 * - 3 (NotFound)      — page missing, or page has no frontmatter.
 */
export function registerDriftCommand(program: Command): void {
  program
    .command("drift")
    .description("Diff a wiki page's frontmatter against normalized incoming data (JSON on stdin or --incoming <file>)")
    .argument("<page>", "Path to the wiki page (markdown file)")
    .option("--incoming <file>", "Read the incoming JSON payload from a file instead of stdin")
    .action((page: string, opts: { incoming?: string }, cmd: Command) => {
      const out = resolveOutputFromAnyDepth(cmd);

      // --- Incoming payload (validated first: it defines the comparison
      // surface, and a malformed payload is InvalidInput regardless of
      // whether the page exists).
      let raw: string;
      if (opts.incoming) {
        if (!fs.existsSync(opts.incoming)) {
          exitWithError(
            `Incoming payload file not found: ${opts.incoming}`,
            out,
            ExitCode.NotFound,
          );
        }
        raw = fs.readFileSync(opts.incoming, "utf-8");
      } else {
        if (process.stdin.isTTY) {
          exitWithError(
            "No incoming payload. Pipe a JSON object on stdin or pass --incoming <file>.",
            out,
            ExitCode.InvalidInput,
          );
        }
        // fd 0 — synchronous stdin read; the payload is small by contract
        // (a frontmatter-sized field map).
        raw = fs.readFileSync(0, "utf-8");
      }

      let incoming: Record<string, unknown>;
      try {
        incoming = parseIncomingPayload(raw);
      } catch (error) {
        if (error instanceof DriftPayloadError) {
          exitWithError(error.message, out, ExitCode.InvalidInput);
        }
        exitWithError(error, out, ExitCode.Unclassified);
      }

      // --- Target page.
      if (!fs.existsSync(page)) {
        exitWithError(`File not found: ${page}`, out, ExitCode.NotFound);
      }

      try {
        const content = fs.readFileSync(page, "utf-8");
        const parsed = parseFrontmatter(content);
        if (!parsed) {
          exitWithError("No frontmatter found in file", out, ExitCode.NotFound);
        }

        const report = computeDrift(parsed.data, incoming);

        // `success` mirrors `frontmatter validate`: true when the assertion
        // ("wiki agrees with incoming") holds, false when it doesn't. The
        // disagreements array is bounded by the payload's field count, so it
        // is emitted in full (no {count, sample} envelope needed).
        const payload = {
          success: !report.drift,
          drift: report.drift,
          page,
          compared: report.compared,
          disagreements: report.disagreements,
        };

        if (out.json) {
          console.log(formatOutput(payload, out));
        } else {
          renderHuman(page, report.compared, report.disagreements);
        }

        process.exit(report.drift ? ExitCode.StateConflict : ExitCode.Success);
      } catch (error) {
        exitWithError(error, out, ExitCode.Unclassified);
      }
    });
}

function renderHuman(
  page: string,
  compared: string[],
  disagreements: FieldDrift[],
): void {
  if (disagreements.length === 0) {
    clack.log.success(
      `No drift: ${chalk.cyan(page)} agrees with incoming data on ${compared.length} field(s).`,
    );
    return;
  }

  const lines = disagreements.map((d) =>
    d.kind === "missing"
      ? `  - ${chalk.cyan(d.field)}: missing from wiki (incoming: ${formatValue(d.incoming)})`
      : `  - ${chalk.cyan(d.field)}: wiki ${formatValue(d.wiki)} → incoming ${formatValue(d.incoming)}`,
  );
  clack.log.warn(
    `Drift on ${disagreements.length} of ${compared.length} field(s) in ${chalk.cyan(page)}:\n${lines.join("\n")}`,
  );
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}
