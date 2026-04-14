import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { createAsanaClient } from "../lib/asana-client.js";
import {
  runNamingPrompt,
  backendConfigToPickerSource,
  persistNamingResult,
} from "../lib/naming-prompt.js";

/**
 * Core logic for configure-naming — exported for testing.
 * Runs the naming prompt and writes the result to workspace.md.
 */
export async function configureNaming(
  workspaceRoot: string,
  token: string,
): Promise<void> {
  const config = loadWorkspaceConfig(workspaceRoot);
  const asanaBackend = config.backends.find((b) => b.type === "asana");

  if (!asanaBackend?.project_gid) {
    clack.log.error(
      "No Asana project configured. Run `rubber-ducky init` with ASANA_ACCESS_TOKEN set to discover your project."
    );
    return;
  }

  const client = createAsanaClient({ token });

  const result = await runNamingPrompt({
    client,
    projectGid: asanaBackend.project_gid,
    preselectedSource: backendConfigToPickerSource(asanaBackend),
    preselectedCase: asanaBackend.naming_case,
  });

  persistNamingResult(workspaceRoot, result);

  clack.log.success(
    `Naming scheme saved: ${chalk.bold(result.naming_source)}` +
    (result.naming_case === "preserve" ? ` (preserve case)` : ``) +
    (result.identifier_field ? ` — field: ${chalk.cyan(result.identifier_field)}` : ``)
  );
}

export function registerAsanaCommand(program: Command): void {
  const asana = program
    .command("asana")
    .description("Asana workspace management commands");

  asana
    .command("configure-naming")
    .description("Configure how Asana task filenames are generated")
    .action(async (_opts: Record<string, unknown>, cmd: Command) => {
      const workspaceRoot = findWorkspaceRoot();
      if (!workspaceRoot) {
        clack.log.error(
          "Not inside a Rubber-Ducky workspace. Run `rubber-ducky init` to create one."
        );
        process.exit(1);
      }

      const token = process.env.ASANA_ACCESS_TOKEN;
      if (!token) {
        clack.log.error(
          "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token. See references/backend-setup.md for setup instructions."
        );
        process.exit(1);
      }

      await configureNaming(workspaceRoot, token);
    });
}
