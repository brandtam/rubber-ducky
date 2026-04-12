import { Command } from "commander";
import * as clack from "@clack/prompts";
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import {
  scanWorkspace,
  applyFileUpdate,
  type FileComparison,
  type UpdateAction,
} from "../lib/update.js";
import { formatOutput } from "../lib/output.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update workspace skills and agents to latest bundled versions")
    .action(async (_opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;
      const workspacePath = process.cwd();

      // Verify this is a workspace
      if (!fs.existsSync(path.join(workspacePath, "workspace.md"))) {
        const output = formatOutput(
          {
            success: false,
            error: "Not a Rubber-Ducky workspace (workspace.md not found). Run this command from your workspace directory.",
          },
          {
            json: jsonMode,
            humanReadable: "Error: workspace.md not found. Run this command from your workspace directory.",
          }
        );
        console.log(output);
        process.exit(1);
      }

      const scan = scanWorkspace(workspacePath);

      if (jsonMode) {
        await runNonInteractive(scan, jsonMode);
        return;
      }

      await runInteractive(workspacePath, scan);
    });
}

interface ScanJson {
  comparisons: Array<{
    relativePath: string;
    status: string;
    description: string;
    diff: string | null;
  }>;
  unchanged: Array<{ relativePath: string; status: string; description: string }>;
  modified: Array<{
    relativePath: string;
    status: string;
    description: string;
    diff: string | null;
  }>;
  newFiles: Array<{ relativePath: string; status: string; description: string }>;
}

function scanToJson(scan: ReturnType<typeof scanWorkspace>): ScanJson {
  const toSummary = (c: FileComparison) => ({
    relativePath: c.relativePath,
    status: c.status,
    description: c.description,
    diff: c.diff,
  });
  const toShort = (c: FileComparison) => ({
    relativePath: c.relativePath,
    status: c.status,
    description: c.description,
  });
  return {
    comparisons: scan.comparisons.map(toSummary),
    unchanged: scan.unchanged.map(toShort),
    modified: scan.modified.map(toSummary),
    newFiles: scan.newFiles.map(toShort),
  };
}

async function runNonInteractive(
  scan: ReturnType<typeof scanWorkspace>,
  jsonMode: boolean
): Promise<void> {
  const output = formatOutput(
    {
      success: true,
      scan: scanToJson(scan),
    },
    {
      json: jsonMode,
      humanReadable: buildHumanSummary(scan),
    }
  );
  console.log(output);
}

async function runInteractive(
  workspacePath: string,
  scan: ReturnType<typeof scanWorkspace>
): Promise<void> {
  clack.intro(chalk.bold("rubber-ducky update"));

  // Summary
  const total = scan.comparisons.length;
  const unchanged = scan.unchanged.length;
  const modified = scan.modified.length;
  const newCount = scan.newFiles.length;

  clack.log.info(
    `Scanned ${total} bundled template(s): ${unchanged} unchanged, ${modified} modified, ${newCount} new`
  );

  if (modified === 0 && newCount === 0) {
    clack.outro(chalk.green("Everything is up to date!"));
    return;
  }

  const results: Array<{ path: string; action: string }> = [];

  // Handle modified files
  for (const file of scan.modified) {
    clack.log.warn(
      `${chalk.yellow("Modified:")} ${file.relativePath}\n  ${file.description}`
    );

    if (file.diff) {
      const diffLines = file.diff.split("\n").slice(0, 20);
      const preview = diffLines
        .map((line) => {
          if (line.startsWith("+")) return chalk.green(line);
          if (line.startsWith("-")) return chalk.red(line);
          return chalk.dim(line);
        })
        .join("\n");
      const truncated = file.diff.split("\n").length > 20 ? "\n  ... (truncated)" : "";
      clack.log.message(`${preview}${truncated}`);
    }

    const action = await clack.select({
      message: `${file.relativePath} has local modifications. What do you want to do?`,
      options: [
        { value: "keep", label: "Keep local version" },
        { value: "overwrite", label: "Overwrite with bundled version" },
      ],
    });

    if (clack.isCancel(action)) {
      clack.cancel("Update cancelled.");
      process.exit(0);
    }

    const updateAction = action as UpdateAction;
    applyFileUpdate(workspacePath, file.relativePath, file.bundledContent, updateAction);
    results.push({ path: file.relativePath, action: updateAction });
  }

  // Handle new files
  for (const file of scan.newFiles) {
    clack.log.info(
      `${chalk.blue("New:")} ${file.relativePath}\n  ${file.description}`
    );

    const action = await clack.select({
      message: `Install new file ${file.relativePath}?`,
      options: [
        { value: "overwrite", label: "Install" },
        { value: "skip", label: "Skip" },
      ],
    });

    if (clack.isCancel(action)) {
      clack.cancel("Update cancelled.");
      process.exit(0);
    }

    const updateAction = action as UpdateAction;
    applyFileUpdate(workspacePath, file.relativePath, file.bundledContent, updateAction);
    results.push({ path: file.relativePath, action: updateAction });
  }

  // Summary
  const installed = results.filter((r) => r.action === "overwrite").length;
  const kept = results.filter((r) => r.action === "keep").length;
  const skipped = results.filter((r) => r.action === "skip").length;

  const parts: string[] = [];
  if (installed > 0) parts.push(`${installed} installed/updated`);
  if (kept > 0) parts.push(`${kept} kept`);
  if (skipped > 0) parts.push(`${skipped} skipped`);

  clack.outro(chalk.green(`Done! ${parts.join(", ")}.`));
}

function buildHumanSummary(scan: ReturnType<typeof scanWorkspace>): string {
  const lines: string[] = [];
  lines.push(`Scanned ${scan.comparisons.length} bundled template(s):`);
  lines.push(`  ${scan.unchanged.length} unchanged`);
  lines.push(`  ${scan.modified.length} modified`);
  lines.push(`  ${scan.newFiles.length} new`);

  if (scan.modified.length > 0) {
    lines.push("");
    lines.push("Modified files:");
    for (const f of scan.modified) {
      lines.push(`  ${f.relativePath} — ${f.description}`);
    }
  }

  if (scan.newFiles.length > 0) {
    lines.push("");
    lines.push("New files available:");
    for (const f of scan.newFiles) {
      lines.push(`  ${f.relativePath} — ${f.description}`);
    }
  }

  return lines.join("\n");
}
