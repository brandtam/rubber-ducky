/**
 * Write-back safety system for Rubber-Ducky.
 *
 * ALL external writes (push, comment, transition) MUST go through this module.
 * Non-negotiable, not configurable.
 *
 * Provides:
 * 1. Structured preview formatting — shown to user before confirmation
 * 2. Audit logging — every executed write is appended to wiki/log.md
 */

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
 * Call this AFTER the write has been confirmed and executed.
 */
export function logWriteAction(
  workspaceRoot: string,
  write: WriteAction
): WriteLogResult {
  const message = `[write-back] ${write.action} → ${write.backend} (${write.target})`;
  const result = appendLog(workspaceRoot, message);
  return { entry: result.entry };
}
