import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { getBackend, checkConnectivity } from "../lib/backend.js";

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

        const results = targets.map((bc) => {
          const result = checkConnectivity(bc);
          return { backend: bc.type, ...result };
        });

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
}
