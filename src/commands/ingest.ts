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
} from "../lib/asana-ingest.js";
import { resolveScope } from "../lib/ingest-shared.js";
import { createJiraClient } from "../lib/jira-client.js";
import { ingestJiraIssue, ingestJiraProject } from "../lib/jira-ingest.js";

function exitWithError(msg: string, jsonMode: boolean): never {
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
          exitWithError(
            "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
            jsonMode
          );
        }

        const token = process.env.ASANA_ACCESS_TOKEN;
        if (!token) {
          exitWithError(
            "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for setup instructions.",
            jsonMode
          );
        }

        try {
          const client = createAsanaClient({ token });
          const config = loadWorkspaceConfig(workspaceRoot);

          const asanaBackend = config.backends.find(
            (b) => b.type === "asana"
          );
          const defaultProjectGid = asanaBackend?.project_gid;
          const identifierField = asanaBackend?.identifier_field;

          const scope = resolveScope({
            mine: opts.mine,
            all: opts.all,
            configScope: config.ingest_scope,
          });

          const parsed = ref ? parseAsanaRef(ref) : null;

          if (parsed?.type === "task") {
            const result = await ingestAsanaTask({
              client,
              ref: parsed.gid,
              workspaceRoot,
              identifierField,
            });

            if (jsonMode) {
              console.log(formatOutput(result, { json: true }));
            } else {
              if (result.skipped) {
                clack.log.warn(
                  `Skipped: ${result.reason} (${chalk.cyan(result.existingFile)})`
                );
              } else {
                clack.log.success(
                  `Ingested: ${chalk.bold(result.taskPage?.title)} \u2192 ${chalk.cyan(result.filePath)}`
                );
              }
            }
          } else {
            const result = await ingestAsanaBulk({
              client,
              ref,
              workspaceRoot,
              defaultProjectGid,
              identifierField,
              scope,
            });

            if (jsonMode) {
              console.log(formatOutput(result, { json: true }));
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
                    `  Ingested: ${chalk.bold(r.taskPage?.title)} \u2192 ${chalk.cyan(r.filePath)}`
                  );
                }
              }
            }
          }
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Unknown error";
          exitWithError(msg, jsonMode);
        }
      }
    );

  ingest
    .command("jira")
    .description("Ingest Jira issues by key, project, or default config")
    .argument("[ref]", "Issue key (ECOMM-4643), project:KEY, or omit for default project")
    .option("--mine", "Only ingest issues assigned to me")
    .option("--all", "Ingest all issues (overrides ingest_scope config)")
    .action(async (ref: string | undefined, opts: { mine?: boolean; all?: boolean }, cmd: Command) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const jsonMode = globalOpts.json === true || !process.stdout.isTTY;

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        exitWithError(
          "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.",
          jsonMode
        );
      }

      const email = process.env.JIRA_EMAIL;
      if (!email) {
        exitWithError(
          "JIRA_EMAIL is not set. Export your Jira account email as JIRA_EMAIL. See references/backend-setup.md for instructions.",
          jsonMode
        );
      }

      const apiToken = process.env.JIRA_API_TOKEN;
      if (!apiToken) {
        exitWithError(
          "JIRA_API_TOKEN is not set. Export your Jira API token as JIRA_API_TOKEN. See references/backend-setup.md for instructions.",
          jsonMode
        );
      }

      const config = loadWorkspaceConfig(workspaceRoot);
      const jiraConfig = config.backends.find((b) => b.type === "jira");
      const serverUrl = jiraConfig?.server_url;
      if (!serverUrl) {
        exitWithError(
          "No Jira backend configured with a server_url. Add a Jira backend to your workspace.md.",
          jsonMode
        );
      }

      const projectKey = jiraConfig?.project_key;

      // Use shared resolveScope — consistent with Asana path
      const scope = resolveScope({
        mine: opts.mine,
        all: opts.all,
        configScope: config.ingest_scope,
      });

      try {
        const client = createJiraClient({ serverUrl, email, apiToken });
        const issueKey = ref && !ref.startsWith("project:") ? ref : null;

        if (issueKey) {
          const result = await ingestJiraIssue({
            client,
            ref: issueKey,
            workspaceRoot,
            serverUrl,
          });

          if (jsonMode) {
            console.log(formatOutput(result, { json: true }));
          } else {
            if (result.skipped) {
              clack.log.warn(
                `Skipped: ${result.reason} (${chalk.cyan(result.existingFile)})`
              );
            } else {
              clack.log.success(
                `Ingested: ${chalk.bold(result.taskPage?.title)} \u2192 ${chalk.cyan(result.filePath)}`
              );
            }
          }
        } else {
          const bulkProjectKey = ref?.startsWith("project:")
            ? ref.replace("project:", "")
            : projectKey;

          if (!bulkProjectKey) {
            exitWithError(
              "No project specified and no project_key in Jira backend config. Use `rubber-ducky ingest jira project:KEY` or set project_key.",
              jsonMode
            );
          }

          const result = await ingestJiraProject({
            client,
            projectKey: bulkProjectKey,
            workspaceRoot,
            serverUrl,
            scope,
          });

          if (jsonMode) {
            console.log(formatOutput(result, { json: true }));
          } else {
            clack.log.success(
              `Ingested ${chalk.bold(String(result.ingested))} issues, skipped ${result.skipped}`
            );
            for (const r of result.results) {
              if (r.skipped) {
                clack.log.warn(`  Skipped: ${r.reason} (${chalk.cyan(r.existingFile)})`);
              } else if (r.filePath) {
                clack.log.info(`  ${chalk.bold(r.taskPage?.title)} \u2192 ${chalk.cyan(r.filePath)}`);
              }
            }
          }
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        exitWithError(msg, jsonMode);
      }
    });
}
