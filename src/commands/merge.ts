import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { runMerge } from "../lib/merge.js";
import { formatWritePreview, logWriteAction } from "../lib/writeback.js";
import type { Status } from "../lib/backend.js";
import type { MergeResolutions } from "../lib/frontmatter-merge.js";

export function registerMergeCommand(program: Command): void {
  program
    .command("merge")
    .description(
      "Merge an Asana page and a Jira page into one canonical task page"
    )
    .argument("<asana-ref>", "Asana page filename stem (e.g. ECOMM-3585)")
    .argument("<jira-ref>", "Jira page filename stem (e.g. WEB-297)")
    .option("--resolve-status <status>", "Resolve status conflict with this value")
    .option("--resolve-priority <priority>", "Resolve priority conflict with this value")
    .option("--resolve-assignee <assignee>", "Resolve assignee conflict with this value")
    .option("--resolve-due <due>", "Resolve due date conflict with this value")
    .action(
      async (
        asanaRef: string,
        jiraRef: string,
        opts: {
          resolveStatus?: string;
          resolvePriority?: string;
          resolveAssignee?: string;
          resolveDue?: string;
        },
        cmd: Command
      ) => {
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

        // Build resolutions from CLI flags
        const resolutions: MergeResolutions = {};
        if (opts.resolveStatus) resolutions.status = opts.resolveStatus as Status;
        if (opts.resolvePriority) resolutions.priority = opts.resolvePriority;
        if (opts.resolveAssignee) resolutions.assignee = opts.resolveAssignee;
        if (opts.resolveDue) resolutions.due = opts.resolveDue;

        const hasResolutions = Object.keys(resolutions).length > 0;

        try {
          const result = runMerge({
            asanaRef,
            jiraRef,
            workspaceRoot,
            resolutions: hasResolutions ? resolutions : undefined,
          });

          if (!result.success) {
            if (jsonMode) {
              console.log(
                formatOutput(
                  {
                    success: false,
                    error: result.error,
                    conflicts: result.conflicts,
                  },
                  { json: true, humanReadable: result.error ?? "" }
                )
              );
            } else {
              if (result.conflicts && result.conflicts.length > 0) {
                clack.log.error("Merge has unresolved conflicts:");
                for (const c of result.conflicts) {
                  clack.log.info(
                    `  ${c.field}: Asana=${JSON.stringify(c.asanaValue)} vs Jira=${JSON.stringify(c.jiraValue)}`
                  );
                }
                clack.log.info(
                  "\nResolve with flags: " +
                    result.conflicts
                      .map((c) => `--resolve-${c.field} <value>`)
                      .join(" ")
                );
              } else {
                clack.log.error(result.error ?? "Merge failed");
              }
            }
            process.exit(1);
          }

          // Success path
          if (jsonMode) {
            console.log(
              formatOutput(
                {
                  success: true,
                  mergedFilename: result.mergedFilename,
                  writeActions: result.writeActions?.map((w) => ({
                    action: w.action,
                    backend: w.backend,
                    target: w.target,
                    text: w.payload.text,
                  })),
                },
                { json: true, humanReadable: "" }
              )
            );
          } else {
            clack.intro(chalk.bold("rubber-ducky merge"));
            clack.log.success(
              `Merged ${asanaRef} + ${jiraRef} → ${result.mergedFilename}`
            );

            // Show write-back previews
            if (result.writeActions && result.writeActions.length > 0) {
              clack.log.info("\nPending back-link comments:");
              for (const wa of result.writeActions) {
                clack.log.info(
                  chalk.dim("─".repeat(40)) +
                    "\n" +
                    formatWritePreview(wa)
                );
              }

              const confirmed = await clack.confirm({
                message: "Post back-link comments to Asana and Jira?",
              });

              if (clack.isCancel(confirmed) || !confirmed) {
                clack.log.warn(
                  "Back-link comments skipped. You can post them manually later."
                );
              } else {
                // Log the write actions (actual API calls would go through
                // the backend.comment() method — deferred to caller integration)
                for (const wa of result.writeActions) {
                  logWriteAction(workspaceRoot, wa);
                }
                clack.log.success("Back-link comments logged for execution.");
              }
            }

            clack.outro(chalk.green("Merge complete."));
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
