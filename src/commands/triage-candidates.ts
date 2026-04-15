import { Command } from "commander";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { findJiraCandidates } from "../lib/triage-candidates.js";

export function registerTriageCandidatesCommand(program: Command): void {
  program
    .command("triage-candidates")
    .description(
      "Scan an Asana page for Jira key mentions present in the vault"
    )
    .argument("<page-path>", "Path to the Asana page file (relative to workspace root or absolute)")
    .action(
      (pagePath: string, _opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.parent?.opts() ?? {};
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

        // Resolve page path — if relative, resolve from workspace root
        const resolvedPath = path.isAbsolute(pagePath)
          ? pagePath
          : path.join(workspaceRoot, pagePath);

        try {
          const candidates = findJiraCandidates(resolvedPath, workspaceRoot);

          if (jsonMode) {
            console.log(
              formatOutput(
                { success: true, candidates },
                { json: true, humanReadable: "" }
              )
            );
          } else {
            if (candidates.length === 0) {
              clack.log.info("No Jira candidates found in page body.");
            } else {
              clack.log.info(`Found ${candidates.length} candidate(s):`);
              for (const c of candidates) {
                clack.log.info(`  ${c.jiraKey} (found in ${c.location})`);
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
