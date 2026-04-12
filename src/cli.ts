#!/usr/bin/env node

import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerFrontmatterCommand } from "./commands/frontmatter.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerPageCommand } from "./commands/page.js";
import { registerBackendCommand } from "./commands/backend.js";

const VERSION = "0.1.0";

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
  registerBackendCommand(program);

  return program;
}

// Only run if this is the entry point
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].includes("rubber-ducky"));

if (isMainModule) {
  const program = createProgram();
  program.parse(process.argv);
}
