import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { createAsanaClient } from "../lib/asana-client.js";
import { ingestAsanaTask } from "../lib/asana-ingest.js";
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
    .description("Ingest a single Asana task by GID or URL")
    .argument("<ref>", "Asana task GID or full Asana URL")
    .action(async (ref: string, _opts: unknown, cmd: Command) => {
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
        const result = await ingestAsanaTask({
          client,
          ref,
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
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        exitWithError(msg, jsonMode);
      }
    });

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

      // Load workspace config to find Jira backend settings
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

      // Determine scope: CLI flags override config
      let scope: "mine" | "all" = "all";
      if (opts.mine) {
        scope = "mine";
      } else if (!opts.all) {
        // Could read ingest_scope from config in future
        scope = "all";
      }

      try {
        const client = createJiraClient({ serverUrl, email, apiToken });

        // Determine what to ingest
        const isBulk = !ref || ref.startsWith("project:");
        const issueKey = ref && !ref.startsWith("project:") ? ref : null;

        if (issueKey) {
          // Single issue ingest
          const result = await ingestJiraIssue({
            client,
            ref: issueKey,
            workspaceRoot,
            serverUrl,
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
          // Bulk project ingest
          const bulkProjectKey = ref?.startsWith("project:")
            ? ref.replace("project:", "")
            : projectKey;

          if (!bulkProjectKey) {
            exitWithError(
              "No project specified and no project_key in Jira backend config. Use `rubber-ducky ingest jira project:KEY` or set project_key.",
              jsonMode
            );
          }

          const results = await ingestJiraProject({
            client,
            projectKey: bulkProjectKey,
            workspaceRoot,
            serverUrl,
            scope,
          });

          const ingested = results.filter((r) => !r.skipped);
          const skipped = results.filter((r) => r.skipped);

          if (jsonMode) {
            console.log(
              formatOutput(
                { results, ingested: ingested.length, skipped: skipped.length, total: results.length } as Record<string, unknown>,
                { json: true, humanReadable: "" }
              )
            );
          } else {
            clack.log.success(
              `Ingested ${chalk.bold(String(ingested.length))} issues, skipped ${skipped.length}`
            );
            for (const r of ingested) {
              clack.log.info(`  ${chalk.bold(r.taskPage?.title)} → ${chalk.cyan(r.filePath)}`);
            }
            for (const r of skipped) {
              clack.log.warn(`  Skipped: ${r.reason} (${chalk.cyan(r.existingFile)})`);
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
