import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { createAsanaClient } from "../lib/asana-client.js";
import {
  ingestAsanaTask,
  ingestAsanaBulk,
  parseAsanaRef,
  resolveScope,
} from "../lib/asana-ingest.js";

export function registerIngestCommand(program: Command): void {
  const ingest = program
    .command("ingest")
    .description("Ingest tasks from external backends");

  ingest
    .command("asana")
    .description(
      "Ingest Asana tasks by GID, URL, project:<gid>, or section:<gid>"
    )
    .argument("[ref]", "Asana task GID, URL, project:<gid>, or section:<gid>")
    .option("--mine", "Filter to tasks assigned to the authenticated user")
    .option("--all", "Ingest all tasks (overrides workspace config)")
    .action(
      async (
        ref: string | undefined,
        opts: { mine?: boolean; all?: boolean },
        cmd: Command
      ) => {
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
          const client = createAsanaClient({ token });
          const config = loadWorkspaceConfig(workspaceRoot);

          // Find Asana backend config for default project_gid
          const asanaBackend = config.backends.find(
            (b) => b.type === "asana"
          );
          const defaultProjectGid = asanaBackend?.project_gid;

          // Resolve scope: CLI flags > workspace config > default "all"
          const scope = resolveScope({
            mine: opts.mine,
            all: opts.all,
            configScope: config.ingest_scope,
          });

          // Determine if this is a single-task or bulk operation
          const parsed = ref ? parseAsanaRef(ref) : null;
          const isSingleTask = parsed?.type === "task";

          if (isSingleTask) {
            // Single task ingest
            const result = await ingestAsanaTask({
              client,
              ref: parsed!.gid,
              workspaceRoot,
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
          } else {
            // Bulk ingest
            const result = await ingestAsanaBulk({
              client,
              ref: ref ?? undefined,
              workspaceRoot,
              defaultProjectGid,
              scope,
            });

            if (jsonMode) {
              console.log(
                formatOutput(
                  { ...result } as Record<string, unknown>,
                  { json: true, humanReadable: "" }
                )
              );
            } else {
              clack.log.success(
                `Bulk ingest complete: ${chalk.bold(String(result.ingested))} ingested, ${chalk.bold(String(result.skipped))} skipped`
              );
              for (const r of result.results) {
                if (r.skipped) {
                  clack.log.warn(
                    `  Skipped: ${r.reason} (${chalk.cyan(r.existingFile)})`
                  );
                } else if (r.filePath) {
                  clack.log.info(
                    `  Ingested: ${chalk.bold(r.taskPage?.title)} → ${chalk.cyan(r.filePath)}`
                  );
                }
              }
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
      }
    );
}
