import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import {
  findWorkspaceRoot,
  loadWorkspaceConfig,
  updateWorkspaceBackend,
} from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { getBackend, checkConnectivity } from "../lib/backend.js";
import {
  discoverAsanaConfig,
  discoverJiraConfig,
} from "../lib/backend-discovery.js";
import { createAsanaClient } from "../lib/asana-client.js";
import { createJiraClient } from "../lib/jira-client.js";

export function registerBackendCommand(program: Command): void {
  const backend = program
    .command("backend")
    .description("Manage backends");

  backend
    .command("list")
    .description("List configured backends and their capabilities")
    .action(async (_opts: unknown, cmd: Command) => {
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

      try {
        const config = loadWorkspaceConfig(workspaceRoot);
        const backends = config.backends.map((bc) => {
          try {
            const instance = getBackend(bc);
            return {
              name: instance.name,
              type: bc.type,
              capabilities: instance.capabilities,
              implemented: true,
            };
          } catch {
            return {
              name: bc.type,
              type: bc.type,
              capabilities: [],
              implemented: false,
            };
          }
        });

        if (jsonMode) {
          console.log(
            formatOutput(
              { success: true, backends },
              {
                json: true,
                humanReadable: "",
              }
            )
          );
        } else {
          clack.intro(chalk.bold("rubber-ducky backend list"));
          if (backends.length === 0) {
            clack.log.info(
              "No backends configured. Use `rubber-ducky init` to add backends."
            );
          } else {
            for (const b of backends) {
              const status = b.implemented
                ? chalk.green("active")
                : chalk.yellow("not implemented");
              const caps = b.capabilities.length > 0
                ? b.capabilities.join(", ")
                : "none";
              clack.log.info(
                `${chalk.bold(b.name)} [${status}]\n  Capabilities: ${caps}`
              );
            }
          }
          clack.outro(
            `${backends.length} backend${backends.length !== 1 ? "s" : ""} configured.`
          );
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

  backend
    .command("check")
    .argument("[name]", "Backend name to check (checks all if omitted)")
    .description("Verify backend connectivity")
    .action(async (name: string | undefined, _opts: unknown, cmd: Command) => {
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

      try {
        const config = loadWorkspaceConfig(workspaceRoot);
        const targets = name
          ? config.backends.filter((b) => b.type === name)
          : config.backends;

        if (name && targets.length === 0) {
          const msg = `Backend "${name}" is not configured in this workspace.`;
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

        if (targets.length === 0) {
          const msg = "No backends configured. Use `rubber-ducky init` to add backends.";
          if (jsonMode) {
            console.log(
              formatOutput(
                { success: false, error: msg },
                { json: true, humanReadable: msg }
              )
            );
          } else {
            clack.log.info(msg);
          }
          process.exit(1);
        }

        const results = await Promise.all(
          targets.map(async (bc) => {
            const result = await checkConnectivity(bc);
            return { backend: bc.type, ...result };
          })
        );

        const allOk = results.every((r) => r.authenticated);

        if (jsonMode) {
          console.log(
            formatOutput(
              { success: allOk, results },
              { json: true, humanReadable: "" }
            )
          );
        } else {
          clack.intro(chalk.bold("rubber-ducky backend check"));
          for (const r of results) {
            if (r.authenticated) {
              clack.log.success(
                `${chalk.bold(r.backend)}: authenticated${r.user ? ` as ${r.user}` : ""}`
              );
            } else {
              clack.log.error(
                `${chalk.bold(r.backend)}: ${r.error ?? "not authenticated"}`
              );
            }
          }
          clack.outro(
            allOk ? chalk.green("All backends connected.") : chalk.red("Some backends failed.")
          );
        }

        if (!allOk) {
          process.exit(1);
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

  backend
    .command("configure")
    .argument("<type>", "Backend type to configure (jira or asana)")
    .option("--list", "List available projects as JSON without changing config")
    .option("--project-key <key>", "Jira: set the default project_key in workspace.md")
    .option("--project-gid <gid>", "Asana: set the default project_gid in workspace.md")
    .option("--workspace-id <gid>", "Asana: set the workspace_id in workspace.md")
    .description(
      "Configure a backend's default project (interactive), or use --list / flags for non-interactive flows"
    )
    .action(async (
      type: string,
      opts: {
        list?: boolean;
        projectKey?: string;
        projectGid?: string;
        workspaceId?: string;
      },
      cmd: Command
    ) => {
      const globalOpts = cmd.parent?.parent?.opts() ?? {};
      const explicitJson = globalOpts.json === true;
      const nonInteractiveFlags =
        opts.list === true ||
        opts.projectKey !== undefined ||
        opts.projectGid !== undefined ||
        opts.workspaceId !== undefined;
      // Only fall back to TTY detection when no non-interactive flags are present —
      // otherwise the caller has explicitly chosen a non-interactive mode.
      const jsonMode =
        explicitJson || (nonInteractiveFlags ? false : !process.stdout.isTTY);
      const machineOutput = explicitJson || nonInteractiveFlags;

      const fail = (msg: string): never => {
        if (machineOutput) {
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
      };

      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        fail("Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one.");
      }

      if (type !== "jira" && type !== "asana") {
        fail(
          `Backend "${type}" cannot be configured here. Only 'jira' and 'asana' support discovery.`
        );
      }

      const config = loadWorkspaceConfig(workspaceRoot!);
      const backendConfig = config.backends.find((b) => b.type === type);
      if (!backendConfig) {
        fail(`No ${type} backend found in workspace.md. Run \`rubber-ducky init\` to add one.`);
      }

      // === Non-interactive: --list ===
      if (opts.list) {
        if (type === "jira") {
          const serverUrl = backendConfig!.server_url ?? process.env.JIRA_SERVER_URL;
          const email = process.env.JIRA_EMAIL;
          const apiToken = process.env.JIRA_API_TOKEN;
          if (!serverUrl || !email || !apiToken) {
            fail(
              "Jira credentials incomplete. Ensure JIRA_SERVER_URL, JIRA_EMAIL, and JIRA_API_TOKEN are set."
            );
          }
          try {
            const client = createJiraClient({
              serverUrl: serverUrl!,
              email: email!,
              apiToken: apiToken!,
            });
            const projects = await client.getProjects();
            console.log(
              formatOutput(
                {
                  success: true,
                  projects: projects.map((p) => ({ key: p.key, name: p.name })),
                },
                { json: true, humanReadable: "" }
              )
            );
            return;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            fail(`Failed to list Jira projects: ${msg}`);
          }
        }

        // asana --list
        const token = process.env.ASANA_ACCESS_TOKEN;
        if (!token) {
          fail("ASANA_ACCESS_TOKEN is not set. Add it to .env.local.");
        }
        try {
          const client = createAsanaClient({ token: token! });
          const workspaces = await client.getWorkspaces();
          const workspaceId = opts.workspaceId ?? backendConfig!.workspace_id;
          // Without a workspace, return just the workspaces so the caller can pick one.
          if (!workspaceId) {
            console.log(
              formatOutput(
                {
                  success: true,
                  workspaces: workspaces.map((w) => ({ gid: w.gid, name: w.name })),
                  projects: [],
                },
                { json: true, humanReadable: "" }
              )
            );
            return;
          }
          const projects = await client.getProjects(workspaceId);
          console.log(
            formatOutput(
              {
                success: true,
                workspaces: workspaces.map((w) => ({ gid: w.gid, name: w.name })),
                workspace_id: workspaceId,
                projects: projects.map((p) => ({ gid: p.gid, name: p.name })),
              },
              { json: true, humanReadable: "" }
            )
          );
          return;
        } catch (error) {
          const msg = error instanceof Error ? error.message : "Unknown error";
          fail(`Failed to list Asana projects: ${msg}`);
        }
      }

      // === Non-interactive: direct field flags ===
      if (type === "jira" && opts.projectKey !== undefined) {
        updateWorkspaceBackend(workspaceRoot!, "jira", {
          project_key: opts.projectKey,
        });
        const payload = { success: true, backend: "jira", project_key: opts.projectKey };
        if (machineOutput) {
          console.log(
            formatOutput(payload, {
              json: true,
              humanReadable: `Saved project_key=${opts.projectKey} to workspace.md.`,
            })
          );
        } else {
          clack.log.success(`Saved project_key=${opts.projectKey} to workspace.md.`);
        }
        return;
      }

      if (type === "asana" && (opts.projectGid !== undefined || opts.workspaceId !== undefined)) {
        const fields: Record<string, unknown> = {};
        if (opts.workspaceId !== undefined) fields.workspace_id = opts.workspaceId;
        if (opts.projectGid !== undefined) fields.project_gid = opts.projectGid;
        updateWorkspaceBackend(workspaceRoot!, "asana", fields);
        const payload = { success: true, backend: "asana", ...fields };
        if (machineOutput) {
          console.log(
            formatOutput(payload, {
              json: true,
              humanReadable: `Saved ${Object.keys(fields).join(", ")} to workspace.md.`,
            })
          );
        } else {
          clack.log.success(`Saved ${Object.keys(fields).join(", ")} to workspace.md.`);
        }
        return;
      }

      // === Interactive discovery (requires a TTY) ===
      if (jsonMode) {
        fail(
          "Interactive configure requires a TTY. Either run this directly in your terminal, or use non-interactive flags: `--list --json` to fetch projects, then `--project-key <key>` (Jira) or `--project-gid <gid> --workspace-id <gid>` (Asana) to set them."
        );
      }

      if (type === "jira") {
        const serverUrl = backendConfig!.server_url ?? process.env.JIRA_SERVER_URL;
        const email = process.env.JIRA_EMAIL;
        const apiToken = process.env.JIRA_API_TOKEN;
        if (!serverUrl) {
          fail(
            "Jira server_url is not set. Add JIRA_SERVER_URL to .env.local or pass `server_url` in workspace.md, then re-run."
          );
        }
        if (!email || !apiToken) {
          fail(
            "JIRA_EMAIL and JIRA_API_TOKEN must be set in .env.local. See references/backend-setup.md."
          );
        }

        clack.intro(chalk.bold("rubber-ducky backend configure jira"));
        const result = await discoverJiraConfig({
          serverUrl: serverUrl!,
          email: email!,
          apiToken: apiToken!,
        });

        if (!result) {
          fail("Jira discovery did not complete. Verify your credentials and try again.");
        }

        updateWorkspaceBackend(workspaceRoot!, "jira", {
          server_url: serverUrl,
          project_key: result!.project_key,
        });
        clack.outro(chalk.green(`Saved project_key=${result!.project_key} to workspace.md.`));
        return;
      }

      // asana interactive
      const token = process.env.ASANA_ACCESS_TOKEN;
      if (!token) {
        fail(
          "ASANA_ACCESS_TOKEN is not set. Add it to .env.local. See references/backend-setup.md."
        );
      }

      clack.intro(chalk.bold("rubber-ducky backend configure asana"));
      const result = await discoverAsanaConfig({ token: token! });
      if (!result) {
        fail("Asana discovery did not complete. Verify your token and try again.");
      }

      updateWorkspaceBackend(workspaceRoot!, "asana", {
        workspace_id: result!.workspace_id,
        project_gid: result!.project_gid,
        naming_source: result!.naming_source,
        naming_case: result!.naming_case,
        ...(result!.identifier_field
          ? { identifier_field: result!.identifier_field }
          : {}),
      });
      clack.outro(chalk.green(`Saved project_gid=${result!.project_gid} to workspace.md.`));
    });
}
