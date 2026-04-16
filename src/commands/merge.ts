import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { runMerge } from "../lib/merge.js";
import {
  formatWritePreview,
  logWriteAction,
  runWriteActions,
  type WriteAction,
  type WriteActionOutcome,
} from "../lib/writeback.js";
import {
  getBackend,
  requireCredentials,
  type Status,
  type TaskPage,
} from "../lib/backend.js";
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
    .option(
      "--yes",
      "Post back-link comments without prompting. In TTY mode, bypasses the confirmation prompt; in --json mode, enables back-link posting (which is otherwise plan-only)."
    )
    .action(
      async (
        asanaRef: string,
        jiraRef: string,
        opts: {
          resolveStatus?: string;
          resolvePriority?: string;
          resolveAssignee?: string;
          resolveDue?: string;
          yes?: boolean;
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
                  { json: true, humanReadable: result.error }
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
                clack.log.error(result.error);
              }
            }
            process.exit(1);
          }

          // Success path — `result` is narrowed to MergeSuccess here, so
          // mergedFilename / writeActions / mergedTaskPage are all present
          // without optional chaining or `!` assertions.
          if (jsonMode) {
            // --yes opts scripted callers into the same capability TTY
            // users get via the clack prompt. Without --yes, JSON mode
            // stays plan-only so existing tooling that parses the
            // writeActions plan is not broken.
            const outcomes =
              opts.yes && result.writeActions.length > 0
                ? await postBackLinkComments({
                    workspaceRoot,
                    writeActions: result.writeActions,
                    mergedTaskPage: result.mergedTaskPage,
                  })
                : null;

            console.log(
              formatOutput(
                {
                  success: true,
                  mergedFilename: result.mergedFilename,
                  writeActions: result.writeActions.map((w) => ({
                    action: w.action,
                    backend: w.backend,
                    target: w.target,
                    text: w.payload.text,
                  })),
                  backLinkOutcomes: outcomes?.map((o) => ({
                    backend: o.action.backend,
                    target: o.action.target,
                    status: o.status,
                    commentUrl: o.commentUrl,
                    error: o.error,
                    onSuccessError: o.onSuccessError,
                  })),
                },
                { json: true, humanReadable: "" }
              )
            );

            if (outcomes && outcomesHaveDrift(outcomes)) {
              process.exit(1);
            }
          } else {
            clack.intro(chalk.bold("rubber-ducky merge"));
            clack.log.success(
              `Merged ${asanaRef} + ${jiraRef} → ${result.mergedFilename}`
            );

            if (result.writeActions.length > 0) {
              clack.log.info("\nPending back-link comments:");
              for (const wa of result.writeActions) {
                clack.log.info(
                  chalk.dim("─".repeat(40)) +
                    "\n" +
                    formatWritePreview(wa)
                );
              }

              let shouldPost: boolean;
              if (opts.yes) {
                shouldPost = true;
              } else {
                const confirmed = await clack.confirm({
                  message: "Post back-link comments to Asana and Jira?",
                });
                shouldPost = !clack.isCancel(confirmed) && confirmed === true;
              }

              if (!shouldPost) {
                clack.log.warn(
                  "Back-link comments skipped. You can post them manually later."
                );
              } else {
                const outcomes = await postBackLinkComments({
                  workspaceRoot,
                  writeActions: result.writeActions,
                  mergedTaskPage: result.mergedTaskPage,
                });
                reportWriteOutcomes(outcomes);
                if (outcomesHaveDrift(outcomes)) {
                  const hasPostFailure = outcomes.some(
                    (o) => o.status === "failure"
                  );
                  // Red, not yellow: we exit non-zero so CI sees failure —
                  // the on-screen severity must match the shell's verdict.
                  clack.outro(
                    chalk.red(
                      hasPostFailure
                        ? "Merge complete; back-link posting had failures."
                        : "Merge complete; audit log did not persist for every post."
                    )
                  );
                  process.exit(1);
                }
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

/**
 * Post back-link comments to each backend referenced in the merge's
 * writeActions. Logs successful posts to wiki/log.md only after the remote
 * call returns. Failures in one backend do not block the other.
 */
async function postBackLinkComments(params: {
  workspaceRoot: string;
  writeActions: WriteAction[];
  mergedTaskPage: TaskPage;
}): Promise<WriteActionOutcome[]> {
  const config = loadWorkspaceConfig(params.workspaceRoot);

  return runWriteActions({
    actions: params.writeActions,
    taskPage: params.mergedTaskPage,
    resolveBackend: (backendName) => {
      const backendConfig = config.backends.find((b) => b.type === backendName);
      if (!backendConfig) {
        throw new Error(
          `No "${backendName}" backend configured in workspace.md`
        );
      }
      // Fail fast with a setup-pointer when creds are missing; otherwise
      // the underlying API call would surface a less actionable 401. The
      // throw is caught by `runWriteActions` and recorded as a per-action
      // failure so a missing Jira token still lets the Asana post proceed.
      requireCredentials(backendConfig);
      return getBackend(backendConfig);
    },
    onSuccess: (action, outcome) => {
      logWriteAction(params.workspaceRoot, action, outcome.commentUrl);
    },
  });
}

/**
 * True when any outcome represents state drift: a remote post failed, OR a
 * remote post succeeded but the local audit-log write did not. Either case
 * is worth a non-zero exit so CI and shell pipelines notice.
 */
function outcomesHaveDrift(outcomes: WriteActionOutcome[]): boolean {
  return outcomes.some(
    (o) => o.status === "failure" || o.onSuccessError !== undefined
  );
}

function reportWriteOutcomes(outcomes: WriteActionOutcome[]): void {
  for (const outcome of outcomes) {
    const label = `${outcome.action.backend} (${outcome.action.target})`;
    if (outcome.status === "success") {
      const suffix = outcome.commentUrl ? ` → ${outcome.commentUrl}` : "";
      clack.log.success(`Posted back-link to ${label}${suffix}`);
      if (outcome.onSuccessError !== undefined) {
        // The remote post landed; only the local audit log failed. Report
        // it distinctly so the user does not retry the merge and create a
        // duplicate comment.
        clack.log.warn(
          `Audit log write failed for ${label}: ${outcome.onSuccessError}`
        );
      }
    } else {
      clack.log.error(`Failed to post back-link to ${label}: ${outcome.error}`);
    }
  }
}
