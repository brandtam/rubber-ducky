#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { findWorkspaceRoot } from "./lib/workspace.js";
import { registerInitCommand } from "./commands/init.js";
import { registerFrontmatterCommand } from "./commands/frontmatter.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerPageCommand } from "./commands/page.js";
import { registerIndexCommand, registerLogCommand, registerWikiCommand } from "./commands/wiki.js";
import { registerBackendCommand } from "./commands/backend.js";
import {
  registerAsapCommand,
  registerRemindCommand,
  registerIdeaCommand,
  registerScreenshotCommand,
} from "./commands/capture.js";
import { registerTaskCommand } from "./commands/task.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerAsanaCommand } from "./commands/asana.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rubber-ducky")
    .description("AI-assisted work log & second brain CLI")
    .version(VERSION, "-v, --version")
    .option("--json", "Output structured JSON");

  registerInitCommand(program);
  registerFrontmatterCommand(program);
  registerUpdateCommand(program);
  registerStatusCommand(program);
  registerPageCommand(program);
  registerIndexCommand(program);
  registerLogCommand(program);
  registerWikiCommand(program);
  registerBackendCommand(program);
  registerAsapCommand(program);
  registerRemindCommand(program);
  registerIdeaCommand(program);
  registerScreenshotCommand(program);
  registerTaskCommand(program);
  registerDoctorCommand(program);
  registerIngestCommand(program);
  registerAsanaCommand(program);
  registerMigrateCommand(program);

  return program;
}

// Only run if this is the entry point
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].includes("rubber-ducky"));

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
