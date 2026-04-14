import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { createAsanaClient } from "../lib/asana-client.js";
import { ingestAsanaTask } from "../lib/asana-ingest.js";

export function registerIngestCommand(program: Command): void {
  const ingest = program
    .command("ingest")
    .description("Ingest tasks from external backends");

  ingest
    .command("asana")
    .description("Ingest a single Asana task by GID or URL")
    .argument("<ref>", "Asana task GID or full Asana URL")
    .action(async (ref: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        const msg =
          "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.";
        if (jsonMode) {
          console.log(
            formatOutput(
              { success: false, error: msg },
              { json: true, humanReadable: msg }
            )
          );
        } else {
          clack.log.error(msg);
        }
        process.exit(1);
      }

      const token = process.env.ASANA_ACCESS_TOKEN;
      if (!token) {
        const msg =
          "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for setup instructions.";
        if (jsonMode) {
          console.log(
            formatOutput(
              { success: false, error: msg },
              { json: true, humanReadable: msg }
            )
          );
        } else {
          clack.log.error(msg);
        }
        process.exit(1);
      }

      try {
        // Load workspace config to get identifier_field
        const wsConfig = loadWorkspaceConfig(workspaceRoot);
        const asanaBackend = wsConfig.backends.find(
          (b) => b.type === "asana"
        );

        const client = createAsanaClient({ token });
        const result = await ingestAsanaTask({
          client,
          ref,
          workspaceRoot,
          identifierField: asanaBackend?.identifier_field,
        });

        if (jsonMode) {
          console.log(
            formatOutput(
              { ...result } as Record<string, unknown>,
              { json: true, humanReadable: "" }
            )
          );
        } else {
          if (result.skipped) {
            clack.log.warn(
              `Skipped: ${result.reason} (${chalk.cyan(result.existingFile)})`
            );
          } else {
            clack.log.success(
              `Ingested: ${chalk.bold(result.taskPage?.title)} → ${chalk.cyan(result.filePath)}`
            );
          }
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        if (jsonMode) {
          console.log(
            formatOutput(
              { success: false, error: msg },
              { json: true, humanReadable: msg }
            )
          );
        } else {
          clack.log.error(msg);
        }
        process.exit(1);
      }
    });
}
