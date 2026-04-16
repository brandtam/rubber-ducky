/**
 * Sentinel-file pattern for resumable merge operations.
 *
 * Every merge writes a sentinel to `.rubber-ducky/transactions/` at the
 * start and deletes it on success. An orphaned sentinel means an
 * interrupted merge — the next invocation detects it and directs the
 * user to `--resume` or `--abort`.
 *
 * Sentinel writes use fsync + atomic rename so a crash or power loss
 * never leaves a truncated JSON file on disk.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SENTINEL_SCHEMA_VERSION = 1;
export const TRANSACTIONS_DIR = ".rubber-ducky/transactions";
const HISTORY_FILE = "history.jsonl";
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MERGE_STEPS = [
  "started",
  "merged-file-written",
  "orphans-deleted",
  "wikilinks-rewritten",
  "logged",
  "back-links-posted",
] as const;

export type MergeStep = (typeof MERGE_STEPS)[number];

export interface BackLinkEntry {
  backend: "asana" | "jira";
  target: string;
  posted: boolean;
  commentUrl?: string;
}

export interface MergedFileInfo {
  filename: string;
  path: string;
  stem: string;
  oldAsanaStem: string;
  oldJiraStem: string;
}

export interface MergeSentinel {
  schemaVersion: number;
  operation: "merge";
  timestamp: string;
  lastUpdated: string;
  args: {
    asanaRef: string;
    jiraRef: string;
    resolutions?: Record<string, string>;
  };
  step: MergeStep;
  merged: MergedFileInfo;
  backLinks?: BackLinkEntry[];
}

export interface OrphanTransaction {
  sentinel: MergeSentinel;
  filePath: string;
  filename: string;
  ageMs: number;
  resumeCommand: string;
  abortCommand: string;
}

export interface HistoryEntry {
  timestamp: string;
  operation: "merge";
  asanaRef: string;
  jiraRef: string;
  step: MergeStep;
  event: "advance" | "complete" | "abort";
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function transactionsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, TRANSACTIONS_DIR);
}

export function sentinelFilename(asanaRef: string, jiraRef: string): string {
  return `merge-${asanaRef}-${jiraRef}.json`;
}

export function sentinelPath(
  workspaceRoot: string,
  asanaRef: string,
  jiraRef: string,
): string {
  return path.join(
    transactionsDir(workspaceRoot),
    sentinelFilename(asanaRef, jiraRef),
  );
}

function historyPath(workspaceRoot: string): string {
  return path.join(transactionsDir(workspaceRoot), HISTORY_FILE);
}

// ---------------------------------------------------------------------------
// Atomic fsync'd write
// ---------------------------------------------------------------------------

/**
 * Write data to `targetPath` via a temp file in the same directory,
 * fsync'd before rename. Survives process crash and power loss — the
 * rename either lands fully or not at all, and the data backing the
 * new name is flushed to disk before the rename executes.
 */
function atomicWriteSync(targetPath: string, data: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpName = `.sentinel-${crypto.randomBytes(6).toString("hex")}.tmp`;
  const tmpPath = path.join(dir, tmpName);

  const fd = fs.openSync(tmpPath, "w");
  try {
    fs.writeSync(fd, data, 0, "utf-8");
    fs.fsyncSync(fd);
  } catch (err) {
    fs.closeSync(fd);
    try { fs.unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    throw err;
  }
  fs.closeSync(fd);

  fs.renameSync(tmpPath, targetPath);

  // fsync the directory so the rename is durable
  const dirFd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

// ---------------------------------------------------------------------------
// History log
// ---------------------------------------------------------------------------

function appendHistory(
  workspaceRoot: string,
  entry: HistoryEntry,
): void {
  const fp = historyPath(workspaceRoot);
  const dir = path.dirname(fp);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(fp, JSON.stringify(entry) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// Sentinel lifecycle
// ---------------------------------------------------------------------------

export function writeSentinel(
  workspaceRoot: string,
  sentinel: MergeSentinel,
): string {
  const fp = sentinelPath(
    workspaceRoot,
    sentinel.args.asanaRef,
    sentinel.args.jiraRef,
  );
  atomicWriteSync(fp, JSON.stringify(sentinel, null, 2) + "\n");

  appendHistory(workspaceRoot, {
    timestamp: sentinel.lastUpdated,
    operation: "merge",
    asanaRef: sentinel.args.asanaRef,
    jiraRef: sentinel.args.jiraRef,
    step: sentinel.step,
    event: "advance",
  });

  return fp;
}

export function advanceSentinel(
  workspaceRoot: string,
  sentinel: MergeSentinel,
  step: MergeStep,
  patch?: Partial<Pick<MergeSentinel, "backLinks">>,
): MergeSentinel {
  const now = new Date().toISOString();
  const updated: MergeSentinel = {
    ...sentinel,
    ...patch,
    step,
    lastUpdated: now,
  };
  writeSentinel(workspaceRoot, updated);
  return updated;
}

export function readSentinel(filePath: string): MergeSentinel {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as MergeSentinel;

  if (parsed.schemaVersion !== SENTINEL_SCHEMA_VERSION) {
    throw new Error(
      `Sentinel schema version ${parsed.schemaVersion} is not supported ` +
      `(expected ${SENTINEL_SCHEMA_VERSION}). Upgrade rubber-ducky or ` +
      `manually delete ${filePath} if the sentinel is stale.`,
    );
  }

  return parsed;
}

export function deleteSentinel(
  workspaceRoot: string,
  sentinel: MergeSentinel,
): void {
  const fp = sentinelPath(
    workspaceRoot,
    sentinel.args.asanaRef,
    sentinel.args.jiraRef,
  );
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }

  appendHistory(workspaceRoot, {
    timestamp: new Date().toISOString(),
    operation: "merge",
    asanaRef: sentinel.args.asanaRef,
    jiraRef: sentinel.args.jiraRef,
    step: sentinel.step,
    event: "complete",
  });
}

export function deleteSentinelAbort(
  workspaceRoot: string,
  sentinel: MergeSentinel,
): void {
  const fp = sentinelPath(
    workspaceRoot,
    sentinel.args.asanaRef,
    sentinel.args.jiraRef,
  );
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }

  appendHistory(workspaceRoot, {
    timestamp: new Date().toISOString(),
    operation: "merge",
    asanaRef: sentinel.args.asanaRef,
    jiraRef: sentinel.args.jiraRef,
    step: sentinel.step,
    event: "abort",
  });
}

// ---------------------------------------------------------------------------
// Listing and staleness
// ---------------------------------------------------------------------------

export function listSentinels(workspaceRoot: string): string[] {
  const dir = transactionsDir(workspaceRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("merge-") && f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

export function isStale(sentinel: MergeSentinel, nowMs?: number): boolean {
  const lastUpdated = new Date(sentinel.lastUpdated).getTime();
  const now = nowMs ?? Date.now();
  return now - lastUpdated > STALE_THRESHOLD_MS;
}

export function sentinelAgeMs(sentinel: MergeSentinel, nowMs?: number): number {
  const lastUpdated = new Date(sentinel.lastUpdated).getTime();
  return (nowMs ?? Date.now()) - lastUpdated;
}

// ---------------------------------------------------------------------------
// Orphan detection
// ---------------------------------------------------------------------------

export function findOrphanSentinels(
  workspaceRoot: string,
): OrphanTransaction[] {
  const files = listSentinels(workspaceRoot);
  const orphans: OrphanTransaction[] = [];

  for (const fp of files) {
    try {
      const sentinel = readSentinel(fp);
      const ageMs = sentinelAgeMs(sentinel);
      orphans.push({
        sentinel,
        filePath: fp,
        filename: path.basename(fp),
        ageMs,
        resumeCommand: `rubber-ducky merge --resume ${sentinel.args.asanaRef} ${sentinel.args.jiraRef}`,
        abortCommand: `rubber-ducky merge --abort ${sentinel.args.asanaRef} ${sentinel.args.jiraRef}`,
      });
    } catch {
      // Corrupted sentinel — surface it as an orphan with a fallback message.
      // Refs are PREFIX-DIGITS; parse with a regex that handles both halves.
      const basename = path.basename(fp, ".json");
      const refMatch = basename.match(/^merge-(.+?)-([A-Z]+-\d+)$/i);
      const asanaRef = refMatch?.[1] ?? "unknown";
      const jiraRef = refMatch?.[2] ?? "unknown";
      orphans.push({
        sentinel: {
          schemaVersion: SENTINEL_SCHEMA_VERSION,
          operation: "merge",
          timestamp: "",
          lastUpdated: "",
          args: { asanaRef, jiraRef },
          step: "started",
          merged: { filename: "", path: "", stem: "", oldAsanaStem: "", oldJiraStem: "" },
        },
        filePath: fp,
        filename: path.basename(fp),
        ageMs: Infinity,
        resumeCommand: `rubber-ducky merge --abort (sentinel may be corrupted — inspect ${fp})`,
        abortCommand: `rubber-ducky merge --abort (sentinel may be corrupted — delete ${fp} manually)`,
      });
    }
  }

  return orphans;
}

export const EXIT_CODE_ORPHAN_TRANSACTION = 2;

export class OrphanSentinelError extends Error {
  constructor(
    public readonly orphan: OrphanTransaction,
  ) {
    const { sentinel } = orphan;
    super(
      `An interrupted ${sentinel.operation} operation was detected: ` +
      `merge ${sentinel.args.asanaRef} + ${sentinel.args.jiraRef} ` +
      `(step: ${sentinel.step}, age: ${formatAge(orphan.ageMs)}).`,
    );
    this.name = "OrphanSentinelError";
  }
}

/**
 * Assert that no orphan sentinel exists. Throws `OrphanSentinelError`
 * when one is found — command handlers catch it and format the diagnostic
 * for their output mode (TTY or JSON).
 *
 * Returns normally when no sentinels exist. Callers should invoke this
 * at the top of any vault-mutating command (merge, migrate, ingest).
 */
export function assertNoOrphanSentinel(workspaceRoot: string): void {
  const orphans = findOrphanSentinels(workspaceRoot);
  if (orphans.length === 0) return;
  throw new OrphanSentinelError(orphans[0]);
}

// ---------------------------------------------------------------------------
// Sentinel factory
// ---------------------------------------------------------------------------

export function createMergeSentinel(args: {
  asanaRef: string;
  jiraRef: string;
  resolutions?: Record<string, string>;
  merged: MergedFileInfo;
}): MergeSentinel {
  const now = new Date().toISOString();
  return {
    schemaVersion: SENTINEL_SCHEMA_VERSION,
    operation: "merge",
    timestamp: now,
    lastUpdated: now,
    args: {
      asanaRef: args.asanaRef,
      jiraRef: args.jiraRef,
      resolutions: args.resolutions,
    },
    step: "started",
    merged: args.merged,
  };
}

// ---------------------------------------------------------------------------
// Comment idempotency marker
// ---------------------------------------------------------------------------

/**
 * Generate the HTML comment marker stamped into every merge back-link
 * comment. Presence of this marker in a remote comment means the
 * back-link was already posted — `findCommentByMarker` checks for it
 * so `--resume` never double-posts.
 */
export function mergeCommentMarker(
  asanaRef: string,
  jiraRef: string,
): string {
  return `<!-- rubber-ducky:merge:${asanaRef}+${jiraRef} -->`;
}

function formatAge(ms: number): string {
  if (!isFinite(ms)) return "unknown";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Describe what remains unfinished for a given step. Used by `--abort`
 * to tell the user exactly what's left partial.
 */
export function describeRemainingWork(sentinel: MergeSentinel): string[] {
  const { step, merged, args } = sentinel;
  const remaining: string[] = [];

  const stepIndex = MERGE_STEPS.indexOf(step);

  if (stepIndex < MERGE_STEPS.indexOf("merged-file-written")) {
    remaining.push(`Merged file not yet written: ${merged.filename}`);
  }
  if (stepIndex < MERGE_STEPS.indexOf("orphans-deleted")) {
    remaining.push(`Original files not yet deleted: ${merged.oldAsanaStem}.md, ${merged.oldJiraStem}.md`);
  }
  if (stepIndex < MERGE_STEPS.indexOf("wikilinks-rewritten")) {
    remaining.push("Vault-wide wikilink rewrite not completed");
  }
  if (stepIndex < MERGE_STEPS.indexOf("logged")) {
    remaining.push("Merge not logged to wiki/log.md");
  }
  if (stepIndex < MERGE_STEPS.indexOf("back-links-posted")) {
    const pending = (sentinel.backLinks ?? []).filter((b) => !b.posted);
    if (pending.length > 0) {
      remaining.push(
        `Back-link comments not posted: ${pending.map((b) => `${b.backend} (${b.target})`).join(", ")}`,
      );
    } else if (!sentinel.backLinks) {
      remaining.push(
        `Back-link comments not posted to ${args.asanaRef} and ${args.jiraRef}`,
      );
    }
  }

  return remaining;
}
