import { Command } from "commander";
import * as clack from "@clack/prompts";
import chalk from "chalk";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { formatOutput } from "../lib/output.js";
import { runMerge, resumeMerge } from "../lib/merge.js";
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
import {
  findOrphanSentinels,
  readSentinel,
  deleteSentinel,
  deleteSentinelAbort,
  advanceSentinel,
  describeRemainingWork,
  mergeCommentMarker,
  EXIT_CODE_ORPHAN_TRANSACTION,
  type MergeSentinel,
} from "../lib/merge-sentinel.js";

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
    .option("--resume", "Resume an interrupted merge from the last completed step")
    .option("--abort", "Abort an interrupted merge and delete the sentinel")
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
          resume?: boolean;
          abort?: boolean;
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

        // ---- Abort path ----
        if (opts.abort) {
          await handleAbort(workspaceRoot, asanaRef, jiraRef, jsonMode, opts.yes);
          return;
        }

        // ---- Resume path ----
        if (opts.resume) {
          await handleResume(workspaceRoot, asanaRef, jiraRef, jsonMode, opts.yes);
          return;
        }

        // ---- Preflight: refuse if an orphan sentinel exists ----
        const orphans = findOrphanSentinels(workspaceRoot);
        if (orphans.length > 0) {
          const orphan = orphans[0];
          const { sentinel } = orphan;
          if (jsonMode) {
            console.log(
              formatOutput(
                {
                  success: false,
                  error: "interrupted-transaction",
                  operation: sentinel.operation,
                  step: sentinel.step,
                  asanaRef: sentinel.args.asanaRef,
                  jiraRef: sentinel.args.jiraRef,
                  resumeCommand: orphan.resumeCommand,
                  abortCommand: orphan.abortCommand,
                },
                { json: true, humanReadable: "" }
              )
            );
          } else {
            clack.log.error(
              `An interrupted ${sentinel.operation} was detected.\n\n` +
              `  Operation:  merge ${sentinel.args.asanaRef} + ${sentinel.args.jiraRef}\n` +
              `  Last step:  ${sentinel.step}\n\n` +
              `Resolve before running another merge:\n\n` +
              `  Resume:  ${orphan.resumeCommand}\n` +
              `  Abort:   ${orphan.abortCommand}`
            );
          }
          process.exit(EXIT_CODE_ORPHAN_TRANSACTION);
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

          await completeBackLinksAndFinalize({
            workspaceRoot,
            result,
            jsonMode,
            yes: opts.yes,
          });
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

// ---------------------------------------------------------------------------
// Resume handler
// ---------------------------------------------------------------------------

async function handleResume(
  workspaceRoot: string,
  asanaRef: string,
  jiraRef: string,
  jsonMode: boolean,
  yes?: boolean,
): Promise<void> {
  const orphans = findOrphanSentinels(workspaceRoot);
  const match = orphans.find(
    (o) =>
      o.sentinel.args.asanaRef === asanaRef &&
      o.sentinel.args.jiraRef === jiraRef,
  );

  if (!match) {
    const msg = `No interrupted merge found for ${asanaRef} + ${jiraRef}.`;
    if (jsonMode) {
      console.log(formatOutput({ success: false, error: msg }, { json: true, humanReadable: msg }));
    } else {
      clack.log.error(msg);
    }
    process.exit(1);
  }

  const sentinel = readSentinel(match.filePath);

  try {
    const result = resumeMerge(workspaceRoot, sentinel);
    if (!result.success) {
      if (jsonMode) {
        console.log(
          formatOutput(
            { success: false, error: result.error, conflicts: result.conflicts },
            { json: true, humanReadable: result.error },
          ),
        );
      } else {
        clack.log.error(result.error);
      }
      process.exit(1);
    }

    await completeBackLinksAndFinalize({
      workspaceRoot,
      result,
      jsonMode,
      yes,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (jsonMode) {
      console.log(formatOutput({ success: false, error: msg }, { json: true, humanReadable: msg }));
    } else {
      clack.log.error(msg);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Abort handler
// ---------------------------------------------------------------------------

async function handleAbort(
  workspaceRoot: string,
  asanaRef: string,
  jiraRef: string,
  jsonMode: boolean,
  yes?: boolean,
): Promise<void> {
  const orphans = findOrphanSentinels(workspaceRoot);
  const match = orphans.find(
    (o) =>
      o.sentinel.args.asanaRef === asanaRef &&
      o.sentinel.args.jiraRef === jiraRef,
  );

  if (!match) {
    const msg = `No interrupted merge found for ${asanaRef} + ${jiraRef}.`;
    if (jsonMode) {
      console.log(formatOutput({ success: false, error: msg }, { json: true, humanReadable: msg }));
    } else {
      clack.log.error(msg);
    }
    process.exit(1);
  }

  const sentinel = readSentinel(match.filePath);
  const remaining = describeRemainingWork(sentinel);

  if (!jsonMode) {
    clack.intro(chalk.bold("rubber-ducky merge --abort"));
    clack.log.warning(
      `Aborting interrupted merge: ${asanaRef} + ${jiraRef}\n` +
      `Last completed step: ${sentinel.step}\n\n` +
      `Remaining work that will NOT be completed:\n` +
      remaining.map((r) => `  • ${r}`).join("\n"),
    );

    if (!yes) {
      const confirmed = await clack.confirm({
        message: "Delete the sentinel and abort this merge?",
      });
      if (clack.isCancel(confirmed) || !confirmed) {
        clack.cancel("Abort cancelled.");
        process.exit(0);
      }
    }
  }

  deleteSentinelAbort(workspaceRoot, sentinel);

  if (jsonMode) {
    console.log(
      formatOutput(
        {
          success: true,
          aborted: true,
          step: sentinel.step,
          remainingWork: remaining,
        },
        { json: true, humanReadable: "" },
      ),
    );
  } else {
    clack.log.success("Sentinel deleted.");
    clack.outro(
      chalk.yellow(
        "Merge aborted. The vault may be in a partial state — review the remaining work listed above.",
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared: complete back-links + finalize sentinel
// ---------------------------------------------------------------------------

interface CompleteParams {
  workspaceRoot: string;
  result: Extract<ReturnType<typeof runMerge>, { success: true }>;
  jsonMode: boolean;
  yes?: boolean;
}

async function completeBackLinksAndFinalize(params: CompleteParams): Promise<void> {
  const { workspaceRoot, result, jsonMode, yes } = params;
  let { sentinel } = result;

  if (jsonMode) {
    const outcomes =
      yes && result.writeActions.length > 0
        ? await postBackLinkComments({
            workspaceRoot,
            writeActions: result.writeActions,
            mergedTaskPage: result.mergedTaskPage,
            sentinel,
          })
        : null;

    if (outcomes) {
      sentinel = updateSentinelFromOutcomes(workspaceRoot, sentinel, outcomes);
    }

    // If back-links were skipped (no --yes), treat as complete
    if (!outcomes || !result.writeActions.length) {
      sentinel = advanceSentinel(workspaceRoot, sentinel, "back-links-posted");
    }

    deleteSentinel(workspaceRoot, sentinel);

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
      `Merged ${sentinel.args.asanaRef} + ${sentinel.args.jiraRef} → ${result.mergedFilename}`
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
      if (yes) {
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
        sentinel = advanceSentinel(workspaceRoot, sentinel, "back-links-posted");
      } else {
        const outcomes = await postBackLinkComments({
          workspaceRoot,
          writeActions: result.writeActions,
          mergedTaskPage: result.mergedTaskPage,
          sentinel,
        });
        sentinel = updateSentinelFromOutcomes(workspaceRoot, sentinel, outcomes);
        reportWriteOutcomes(outcomes);
        if (outcomesHaveDrift(outcomes)) {
          const hasPostFailure = outcomes.some(
            (o) => o.status === "failure"
          );
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
    } else {
      sentinel = advanceSentinel(workspaceRoot, sentinel, "back-links-posted");
    }

    deleteSentinel(workspaceRoot, sentinel);
    clack.outro(chalk.green("Merge complete."));
  }
}

// ---------------------------------------------------------------------------
// Back-link posting with sentinel tracking
// ---------------------------------------------------------------------------

async function postBackLinkComments(params: {
  workspaceRoot: string;
  writeActions: WriteAction[];
  mergedTaskPage: TaskPage;
  sentinel: MergeSentinel;
}): Promise<WriteActionOutcome[]> {
  const config = loadWorkspaceConfig(params.workspaceRoot);
  const marker = mergeCommentMarker(
    params.sentinel.args.asanaRef,
    params.sentinel.args.jiraRef,
  );

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
      requireCredentials(backendConfig);
      return getBackend(backendConfig);
    },
    onPreAction: async (action, backend) => {
      const existing = await backend.findCommentByMarker(
        params.mergedTaskPage,
        marker,
      );
      if (existing.found) {
        return { skip: true, commentUrl: existing.commentUrl };
      }
      return { skip: false };
    },
    onSuccess: (action, outcome) => {
      logWriteAction(params.workspaceRoot, action, outcome.commentUrl);
    },
  });
}

/**
 * Update the sentinel's backLinks entries based on post outcomes,
 * and advance to back-links-posted if all are done.
 */
function updateSentinelFromOutcomes(
  workspaceRoot: string,
  sentinel: MergeSentinel,
  outcomes: WriteActionOutcome[],
): MergeSentinel {
  const backLinks = (sentinel.backLinks ?? []).map((bl) => {
    const outcome = outcomes.find(
      (o) => o.action.backend === bl.backend && o.action.target === bl.target,
    );
    if (outcome && outcome.status === "success") {
      return { ...bl, posted: true, commentUrl: outcome.commentUrl };
    }
    return bl;
  });

  const allPosted = backLinks.every((bl) => bl.posted);
  const step = allPosted ? "back-links-posted" as const : sentinel.step;
  return advanceSentinel(workspaceRoot, sentinel, step, { backLinks });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        clack.log.warn(
          `Audit log write failed for ${label}: ${outcome.onSuccessError}`
        );
      }
    } else {
      clack.log.error(`Failed to post back-link to ${label}: ${outcome.error}`);
    }
  }
}
