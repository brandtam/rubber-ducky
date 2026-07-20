#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { findWorkspaceRoot } from "./lib/workspace.js";
import { registerInitCommand } from "./commands/init.js";
import { registerAdoptCommand } from "./commands/adopt.js";
import { registerFrontmatterCommand } from "./commands/frontmatter.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerPageCommand } from "./commands/page.js";
import { registerIndexCommand, registerLogCommand, registerWikiCommand } from "./commands/wiki.js";
import {
  registerAsapCommand,
  registerRemindCommand,
  registerIdeaCommand,
  registerScreenshotCommand,
} from "./commands/capture.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerSettingsCommand } from "./commands/settings.js";
import { registerContextCommand } from "./commands/context.js";
import { registerDriftCommand } from "./commands/drift.js";
// Static import so the version is embedded at build time. The CLI ships as a
// compiled single-file binary — never resolve package.json (or any asset)
// relative to the module URL at runtime.
import packageJson from "../package.json" with { type: "json" };

const VERSION: string = packageJson.version;

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rubber-ducky")
    .description("Your AI helper in Obsidian — scaffolds workspaces Claude maintains across sessions.")
    .version(VERSION, "-v, --version")
    // Output conventions, agent-native by default. Auto-JSON when stdout is
    // not a TTY; --no-json overrides for the rare piped-but-human case.
    .option("--json", "Force JSON output (auto-enabled when stdout is not a TTY)")
    .option("--no-json", "Force human-readable output even when piped")
    // Default JSON responses summarize unbounded arrays as `{count, sample}`.
    // `--verbose` returns the full arrays under the same field names. Set per
    // command — not every command emits summarizable arrays, but the global
    // flag means scripts can pass it without checking which command they hit.
    .option("--verbose", "Return full arrays instead of {count, sample} envelopes in JSON output");

  registerInitCommand(program);
  registerAdoptCommand(program);
  registerFrontmatterCommand(program);
  registerStatusCommand(program);
  registerPageCommand(program);
  registerIndexCommand(program);
  registerLogCommand(program);
  registerWikiCommand(program);
  registerAsapCommand(program);
  registerRemindCommand(program);
  registerIdeaCommand(program);
  registerScreenshotCommand(program);
  registerTaskCommand(program);
  registerDoctorCommand(program);
  registerSettingsCommand(program);
  registerContextCommand(program);
  registerDriftCommand(program);

  return program;
}

// Only run if this is the entry point. `import.meta.main` is true when Bun
// executes this file directly — from source (`bun src/cli.ts`) or as the
// embedded entry of a compiled single-file binary — and false when a test
// imports `createProgram`. Unlike an argv[1]-substring heuristic, it does not
// depend on what the compiled outfile happens to be named.
const isMainModule = import.meta.main;

/**
 * Load .env.local from the workspace root if it exists.
 * Sets env vars that aren't already set so the user doesn't need to
 * manually source the file before every session.
 */
function loadEnvLocal(): void {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) return;

  const envPath = path.join(workspaceRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Strip optional "export " prefix
    const assignment = trimmed.startsWith("export ")
      ? trimmed.slice(7)
      : trimmed;
    const eqIndex = assignment.indexOf("=");
    if (eqIndex === -1) continue;
    const key = assignment.slice(0, eqIndex).trim();
    let value = assignment.slice(eqIndex + 1).trim();
    // Strip surrounding quotes (single or double) — mimics shell behavior
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't overwrite vars already in the environment
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

if (isMainModule) {
  loadEnvLocal();
  const program = createProgram();
  program.parse(process.argv);
}
