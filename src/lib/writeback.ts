/**
 * Write-back safety system for Rubber-Ducky.
 *
 * ALL external writes (push, comment, transition) MUST go through this module.
 * Non-negotiable, not configurable.
 *
 * Provides:
 * 1. Structured preview formatting — shown to user before confirmation
 * 2. Audit logging — every executed write is appended to wiki/log.md
 * 3. Execution adapter — routes WriteActions to Backend methods and
 *    aggregates per-action outcomes so callers can surface partial failure
 */

import type { Backend, TaskPage } from "./backend.js";
import { appendLog } from "./wiki.js";

export interface WriteAction {
  /** The operation type */
  action: "push" | "comment" | "transition";
  /** Target backend system */
  backend: string;
  /** External reference (issue number, task ID, etc.) */
  target: string;
  /** Operation-specific payload */
  payload: Record<string, unknown>;
}

export interface WriteLogResult {
  entry: string;
}

/**
 * Outcome of a single WriteAction execution. Never thrown — always returned.
 *
 * The `status` field describes ONLY the remote write. A post-success audit
 * hook (e.g. writing to wiki/log.md) that throws does NOT downgrade the
 * status — that would tell the user the comment wasn't posted when it was,
 * and their natural retry would create a duplicate on the remote side.
 * Hook failures surface via `onSuccessError` instead, so callers can report
 * "post succeeded but local audit log did not persist" honestly.
 */
export interface WriteActionOutcome {
  action: WriteAction;
  status: "success" | "failure";
  /** Populated on success. URL of the created comment/transition/etc. */
  commentUrl?: string;
  /** Populated on failure. Human-readable error message. */
  error?: string;
  /**
   * Populated only when `status === "success"` AND the caller's `onSuccess`
   * hook threw. The remote write still succeeded — this records the
   * follow-on bookkeeping failure so the caller can alert the user without
   * misrepresenting remote state.
   */
  onSuccessError?: string;
}

export type BackendResolver = (backendName: string) => Backend;

export interface RunWriteActionsOptions {
  actions: WriteAction[];
  /** Task page whose ref fields identify the target item in each backend. */
  taskPage: TaskPage;
  resolveBackend: BackendResolver;
  /** Invoked after each successful action — typically used for audit logging. */
  onSuccess?: (action: WriteAction, outcome: WriteActionOutcome) => void;
}

/**
 * Format a structured preview of a write-back action.
 * Displayed to the user before confirmation.
 *
 * Returns a multi-line string with action, target system, and payload details.
 */
export function formatWritePreview(write: WriteAction): string {
  const lines: string[] = [];

  lines.push(`Action:  ${write.action}`);
  lines.push(`Backend: ${write.backend}`);
  lines.push(`Target:  ${write.target}`);
  lines.push(`Payload:`);

  for (const [key, value] of Object.entries(write.payload)) {
    const display = typeof value === "string" ? value : JSON.stringify(value);
    lines.push(`  ${key}: ${display}`);
  }

  return lines.join("\n");
}

/**
 * Log an executed write-back action to wiki/log.md as an audit trail entry.
 * Call this AFTER the write has been confirmed and executed. Pass the
 * resource URL returned by the backend when available so the audit trail
 * links back to the exact remote artifact — future drift investigations
 * can jump from the log entry to the comment/issue without guessing.
 */
export function logWriteAction(
  workspaceRoot: string,
  write: WriteAction,
  resultUrl?: string
): WriteLogResult {
  const base = `[write-back] ${write.action} → ${write.backend} (${write.target})`;
  const message = resultUrl ? `${base} ${resultUrl}` : base;
  const result = appendLog(workspaceRoot, message);
  return { entry: result.entry };
}

/**
 * Execute a batch of WriteActions against their backends, returning one
 * outcome per action. A failure on any action does NOT short-circuit the
 * batch — every action is attempted and every outcome is returned so the
 * caller can report partial-failure honestly.
 *
 * The `onSuccess` hook runs after each successful remote write — callers
 * use it for bookkeeping like appending audit-log entries. If the hook
 * throws, the outcome remains `status: "success"` (the remote write really
 * did happen) and the hook's error is attached as `onSuccessError` so the
 * caller can surface the bookkeeping failure without misreporting remote
 * state and inviting a duplicate-comment retry.
 */
export async function runWriteActions(
  options: RunWriteActionsOptions
): Promise<WriteActionOutcome[]> {
  const outcomes: WriteActionOutcome[] = [];

  for (const action of options.actions) {
    const outcome = await attemptWriteAction(action, options);
    outcomes.push(outcome);

    if (outcome.status === "success" && options.onSuccess) {
      try {
        options.onSuccess(action, outcome);
      } catch (hookError) {
        outcome.onSuccessError =
          hookError instanceof Error ? hookError.message : String(hookError);
      }
    }
  }

  return outcomes;
}

/**
 * Validate and execute a single WriteAction against its backend, returning
 * a structured outcome. Kept private so the try/catch boundary around the
 * remote call can't accidentally swallow errors from unrelated bookkeeping.
 */
async function attemptWriteAction(
  action: WriteAction,
  options: RunWriteActionsOptions
): Promise<WriteActionOutcome> {
  try {
    const backend = options.resolveBackend(action.backend);

    if (action.action !== "comment") {
      // Only `comment` has an adapter today. Push/transition get one when
      // their commands are wired. Failing loudly here means an unmapped
      // action type can't silently no-op.
      throw new Error(
        `Write action "${action.action}" is not supported by the executor`
      );
    }

    const text = action.payload.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new Error(
        `Write action for ${action.backend}/${action.target} is missing a non-empty payload.text`
      );
    }

    const result = await backend.comment(options.taskPage, text);
    return {
      action,
      status: "success",
      commentUrl: result.commentUrl,
    };
  } catch (error) {
    return {
      action,
      status: "failure",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
