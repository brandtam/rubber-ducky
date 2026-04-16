import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { requireCredentials } from "../lib/backend.js";
import { createAsanaClient } from "../lib/asana-client.js";
import type { AsanaClient } from "../lib/asana-client.js";
import {
  ingestAsanaTask,
  ingestAsanaBulk,
  parseAsanaRef,
} from "../lib/asana-ingest.js";
import { resolveScope } from "../lib/ingest-shared.js";
import { createJiraClient } from "../lib/jira-client.js";
import { ingestJiraIssue, ingestJiraProject } from "../lib/jira-ingest.js";
import { createThrottleNotifier } from "../lib/http/throttle-notifier.js";
import { runNamingPrompt, persistNamingResult } from "../lib/naming-prompt.js";
import { inferLegacyScheme } from "../lib/naming.js";
import type { BackendConfig } from "../lib/templates.js";
import {
  assertNoOrphanSentinel,
  OrphanSentinelError,
  EXIT_CODE_ORPHAN_TRANSACTION,
} from "../lib/merge-sentinel.js";

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

function guardOrphanSentinel(workspaceRoot: string, jsonMode: boolean): void {
  try {
    assertNoOrphanSentinel(workspaceRoot);
  } catch (error) {
    if (error instanceof OrphanSentinelError) {
      const { orphan } = error;
      if (jsonMode) {
        console.log(
          formatOutput(
            {
              success: false,
              error: "interrupted-transaction",
              resumeCommand: orphan.resumeCommand,
              abortCommand: orphan.abortCommand,
            },
            { json: true, humanReadable: error.message },
          ),
        );
      } else {
        clack.log.error(error.message);
        clack.log.info(`  Resume: ${orphan.resumeCommand}`);
        clack.log.info(`  Abort:  ${orphan.abortCommand}`);
      }
      process.exit(EXIT_CODE_ORPHAN_TRANSACTION);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Auto-trigger naming prompt when naming_source is missing
// ---------------------------------------------------------------------------

export interface EnsureNamingConfigOptions {
  workspaceRoot: string;
  client: AsanaClient;
  projectGid: string;
  backendConfig: BackendConfig;
}

export interface NamingConfig {
  namingSource: "identifier" | "title" | "gid";
  namingCase: "preserve" | "lower" | "upper";
  identifierField: string | undefined;
}

/**
 * Ensure naming config is set before ingest proceeds.
 * If naming_source is already configured, returns the existing values.
 * If missing, runs the interactive naming prompt, persists to workspace.md,
 * and returns the new values.
 */
export async function ensureNamingConfig(
  opts: EnsureNamingConfigOptions,
): Promise<NamingConfig> {
  const { workspaceRoot, client, projectGid, backendConfig } = opts;

  // Already configured — return existing values
  if (backendConfig.naming_source) {
    return {
      namingSource: backendConfig.naming_source,
      namingCase: backendConfig.naming_case ?? "lower",
      identifierField: backendConfig.identifier_field,
    };
  }

  // Legacy workspaces (identifier_field set in a prior init, no naming_source)
  // get their existing field pre-selected so the user's prior implicit choice
  // is the default.
  const legacy = inferLegacyScheme(backendConfig);
  const result = await runNamingPrompt({
    client,
    projectGid,
    preselectedSource:
      legacy?.source === "identifier" ? backendConfig.identifier_field : undefined,
    preselectedCase: legacy?.case,
  });

  persistNamingResult(workspaceRoot, result);

  return {
    namingSource: result.naming_source,
    namingCase: result.naming_case,
    identifierField: result.identifier_field,
  };
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

        guardOrphanSentinel(workspaceRoot, jsonMode);

        let token: string;
        try {
          const creds = requireCredentials({ type: "asana" });
          token = creds.accessToken;
        } catch (error) {
          exitWithError(
            error instanceof Error ? error.message : String(error),
            jsonMode
          );
        }

        try {
          const client = createAsanaClient({
            token,
            onThrottle: createThrottleNotifier("Asana"),
          });
          const config = loadWorkspaceConfig(workspaceRoot);

          const asanaBackend = config.backends.find(
            (b) => b.type === "asana"
          );
          const defaultProjectGid = asanaBackend?.project_gid;
          const workspaceGid = asanaBackend?.workspace_id;

          const scope = resolveScope({
            mine: opts.mine,
            all: opts.all,
            configScope: config.ingest_scope,
          });

          // Ensure naming config is set before any file creation
          const projectGid = defaultProjectGid ?? (ref ? parseAsanaRef(ref)?.gid : undefined);
          let namingSource: "identifier" | "title" | "gid" | undefined = asanaBackend?.naming_source;
          let namingCase: "preserve" | "lower" | "upper" | undefined = asanaBackend?.naming_case;
          let identifierField: string | undefined = asanaBackend?.identifier_field;

          if (!namingSource && asanaBackend && projectGid) {
            if (jsonMode) {
              // We can't run the interactive clack prompt in non-TTY mode —
              // Node's TTY init would fail with EINVAL. Emit a machine-
              // readable error the caller (skill, script, CI) can act on.
              exitWithError(
                "Asana naming config is not set. Run `rubber-ducky backend configure asana --naming-source <identifier|title|gid> --naming-case <preserve|lower> [--identifier-field <name>]` (for example `--naming-source title --naming-case lower`) to set it non-interactively, or `rubber-ducky asana configure-naming` in your terminal to pick interactively with a live preview.",
                true
              );
            }
            const naming = await ensureNamingConfig({
              workspaceRoot,
              client,
              projectGid,
              backendConfig: asanaBackend,
            });
            namingSource = naming.namingSource;
            namingCase = naming.namingCase;
            identifierField = naming.identifierField;
          }

          const parsed = ref ? parseAsanaRef(ref) : null;

          if (parsed?.type === "task") {
            const result = await ingestAsanaTask({
              client,
              ref: parsed.gid,
              workspaceRoot,
              identifierField,
              namingSource,
              namingCase,
              workspaceGid,
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
              namingSource,
              namingCase,
              workspaceGid,
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

      guardOrphanSentinel(workspaceRoot, jsonMode);

      let email: string;
      let apiToken: string;
      try {
        const creds = requireCredentials({ type: "jira" });
        email = creds.email;
        apiToken = creds.apiToken;
      } catch (error) {
        exitWithError(
          error instanceof Error ? error.message : String(error),
          jsonMode
        );
      }

      const config = loadWorkspaceConfig(workspaceRoot);
      const jiraConfig = config.backends.find((b) => b.type === "jira");
      const serverUrl = jiraConfig?.server_url ?? process.env.JIRA_SERVER_URL;
      if (!serverUrl) {
        exitWithError(
          "No Jira server URL configured. Set JIRA_SERVER_URL in .env.local.",
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
        const client = createJiraClient({
          serverUrl,
          email,
          apiToken,
          onThrottle: createThrottleNotifier("Jira"),
        });
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
