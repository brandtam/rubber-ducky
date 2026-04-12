import { Command } from "commander";
import * as clack from "@clack/prompts";
import * as path from "node:path";
import chalk from "chalk";
import { createWorkspace } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create a new Rubber-Ducky workspace")
    .argument("[directory]", "Target directory (defaults to workspace name)")
    .action(async (_directory: string | undefined, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      if (jsonMode) {
        await runNonInteractive(_directory, jsonMode);
        return;
      }

      await runInteractive(_directory);
    });
}

async function runInteractive(directory: string | undefined): Promise<void> {
  clack.intro(chalk.bold("rubber-ducky init"));

  const name = await clack.text({
    message: "What is your workspace name?",
    placeholder: "my-work-log",
    validate: (value) => {
      if (!value.trim()) return "Workspace name is required";
      return undefined;
    },
  });

  if (clack.isCancel(name)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const purpose = await clack.text({
    message: "What is the purpose of this workspace?",
    placeholder: "Track daily work and tasks",
    validate: (value) => {
      if (!value.trim()) return "Purpose is required";
      return undefined;
    },
  });

  if (clack.isCancel(purpose)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const targetDir = directory ?? slugify(name as string);
  const fullPath = path.resolve(process.cwd(), targetDir);

  const spinner = clack.spinner();
  spinner.start("Creating workspace...");

  try {
    const result = await createWorkspace({
      name: name as string,
      purpose: purpose as string,
      targetDir: fullPath,
    });

    spinner.stop("Workspace created!");

    clack.note(
      [
        `${chalk.bold("Directories:")} ${result.dirsCreated.join(", ")}`,
        `${chalk.bold("Files:")} ${result.filesCreated.join(", ")}`,
        "",
        `Open in Obsidian or any markdown editor.`,
      ].join("\n"),
      result.workspacePath
    );

    clack.outro(chalk.green("Done! Your workspace is ready."));
  } catch (error) {
    spinner.stop("Failed!");
    clack.log.error(
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

async function runNonInteractive(
  directory: string | undefined,
  jsonMode: boolean
): Promise<void> {
  // In non-interactive mode, use sensible defaults or error
  if (!directory) {
    const output = formatOutput(
      {
        success: false,
        error: "Directory argument is required in non-interactive mode",
      },
      { json: jsonMode, humanReadable: "Error: directory argument required in non-interactive mode" }
    );
    console.log(output);
    process.exit(1);
  }

  const name = path.basename(directory);
  const fullPath = path.resolve(process.cwd(), directory);

  try {
    const result = await createWorkspace({
      name,
      purpose: "Rubber-Ducky workspace",
      targetDir: fullPath,
    });

    const output = formatOutput(
      {
        success: true,
        workspacePath: result.workspacePath,
        filesCreated: result.filesCreated,
        dirsCreated: result.dirsCreated,
      },
      {
        json: jsonMode,
        humanReadable: `Workspace created at ${result.workspacePath}`,
      }
    );
    console.log(output);
  } catch (error) {
    const output = formatOutput(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      {
        json: jsonMode,
        humanReadable: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      }
    );
    console.log(output);
    process.exit(1);
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
