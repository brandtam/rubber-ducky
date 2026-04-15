/**
 * Shared utilities for ingest orchestration across all backends.
 *
 * This module provides the types, dedup logic, page generation, and scope
 * resolution that both Asana and Jira ingest modules share. Extracting
 * these prevents duplication and ensures consistent behavior regardless
 * of which backend is used.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { TaskPage } from "./backend.js";
import type { IngestScope } from "./workspace.js";
import { parseFrontmatter } from "./frontmatter.js";
import { rebuildIndex, appendLog } from "./wiki.js";

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

/**
 * Process items with bounded concurrency. Unlike Promise.all (which launches
 * everything at once), this limits the number of in-flight operations to avoid
 * overwhelming external APIs with rate limits.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  existingFile?: string;
  filePath?: string;
  taskPage?: TaskPage;
  attachmentCount?: number;
  error?: string;
}

export interface BulkIngestResult {
  ingested: number;
  skipped: number;
  results: IngestResult[];
}

export interface AttachmentRef {
  name: string;
  isImage: boolean;
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective scope from CLI flags and workspace config.
 * Precedence: CLI flags (highest) > workspace config > default "mine".
 */
export function resolveScope(opts: {
  mine?: boolean;
  all?: boolean;
  configScope?: IngestScope;
}): "mine" | "all" {
  if (opts.mine) return "mine";
  if (opts.all) return "all";
  if (opts.configScope === "mine") return "mine";
  if (opts.configScope === "all") return "all";
  return "mine";
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

/** Map from ref value (URL or key) to relative wiki path. */
export type DedupIndex = Map<string, string>;

/**
 * Build a dedup index by scanning all task files once.
 * Returns a Map from the specified frontmatter field value to relative file path.
 * Call this once before a bulk loop instead of scanning per-task.
 */
export function buildDedupIndex(
  workspaceRoot: string,
  refField: "asana_ref" | "jira_ref" | "gh_ref"
): DedupIndex {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return new Map();

  const index = new Map<string, string>();
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(tasksDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    const value = parsed?.data[refField];
    if (typeof value === "string") {
      index.set(value, path.join("wiki", "tasks", file));
    }
  }
  return index;
}

/**
 * Check whether a task with the given ref value already exists.
 * When a DedupIndex is provided, uses O(1) lookup. Otherwise falls
 * back to a full directory scan (acceptable for single-task ingest).
 */
export function findExistingByRef(
  workspaceRoot: string,
  refField: "asana_ref" | "jira_ref" | "gh_ref",
  refValue: string,
  dedupIndex?: DedupIndex
): string | null {
  if (dedupIndex) {
    return dedupIndex.get(refValue) ?? null;
  }

  // Fallback: scan all task files (used for single-task ingest)
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(tasksDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (parsed && parsed.data[refField] === refValue) {
      return path.join("wiki", "tasks", file);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Image detection
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

export function isImageFilename(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Page generation
// ---------------------------------------------------------------------------

/**
 * Generate the full markdown content for an ingested task page.
 *
 * Produces frontmatter + body sections (Description, Comments, Attachments,
 * Activity log, See also). The Attachments section is only rendered when
 * attachments are provided.
 */
export function generateIngestedTaskPage(
  taskPage: TaskPage,
  options?: {
    attachments?: AttachmentRef[];
    assetRef?: string;
    source?: string;
    /** Backend name for section scoping (e.g. "Asana", "Jira"). */
    backendName?: string;
  }
): string {
  const frontmatter: Record<string, unknown> = {
    title: taskPage.title,
    type: "task",
    ref: taskPage.ref,
    source: taskPage.source,
    status: taskPage.status,
    priority: taskPage.priority,
    assignee: taskPage.assignee,
    tags: taskPage.tags,
    created: taskPage.created,
    updated: taskPage.updated,
    closed: taskPage.closed,
    pushed: taskPage.pushed,
    due: taskPage.due,
    jira_ref: taskPage.jira_ref,
    asana_ref: taskPage.asana_ref,
    gh_ref: taskPage.gh_ref,
    comment_count: taskPage.comment_count,
  };

  // Write jira_needed for Asana-sourced pages (triage state tracking)
  if (taskPage.source === "asana") {
    frontmatter.jira_needed = taskPage.jira_needed;
  }

  // Write raw status fields when present
  if (taskPage.asana_status_raw != null) {
    frontmatter.asana_status_raw = taskPage.asana_status_raw;
  }
  if (taskPage.jira_status_raw != null) {
    frontmatter.jira_status_raw = taskPage.jira_status_raw;
  }

  const yaml = yamlStringify(frontmatter).trimEnd();
  const sections: string[] = [];

  // Section prefix: "Asana " or "Jira " when backend is specified
  const prefix = options?.backendName ? `${options.backendName} ` : "";

  // ## <Backend> description
  sections.push(`## ${prefix}description`);
  sections.push("");
  if (taskPage.description) {
    sections.push(taskPage.description);
  }
  sections.push("");

  // ## <Backend> comments
  sections.push(`## ${prefix}comments`);
  sections.push("");
  if (taskPage.comments.length > 0) {
    for (const comment of taskPage.comments) {
      sections.push(comment);
      sections.push("");
    }
  }

  // ## Attachments (only when provided)
  const attachments = options?.attachments;
  const assetRef = options?.assetRef;
  if (attachments && attachments.length > 0 && assetRef) {
    sections.push("## Attachments");
    sections.push("");
    for (const att of attachments) {
      const relPath = `../../raw/assets/${assetRef}/${att.name}`;
      if (att.isImage) {
        sections.push(`![${att.name}](${relPath})`);
      } else {
        sections.push(`[${att.name}](${relPath})`);
      }
    }
    sections.push("");
  }

  // ## Activity log
  const sourceName = options?.source ?? taskPage.source ?? "external system";
  sections.push("## Activity log");
  sections.push("");
  sections.push(
    `- ${new Date().toISOString()} \u2014 Ingested from ${sourceName} (${taskPage.ref})`
  );
  sections.push("");

  // ## See also
  sections.push("## See also");
  sections.push("");

  return `---\n${yaml}\n---\n${sections.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Run post-ingest operations: rebuild the wiki index and append a log entry.
 * Extracted so bulk ingest can call this once after the loop instead of per-task.
 */
export function postIngestProcess(
  workspaceRoot: string,
  message: string
): void {
  rebuildIndex(workspaceRoot);
  appendLog(workspaceRoot, message);
}

/**
 * Finalize a bulk ingest: count results, run post-processing once, and return
 * a BulkIngestResult. Shared by all backends so counting and post-processing
 * logic lives in one place.
 */
export function finalizeBulkIngest(
  results: IngestResult[],
  workspaceRoot: string,
  label: string
): BulkIngestResult {
  const ingested = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;

  if (ingested > 0) {
    postIngestProcess(
      workspaceRoot,
      `Bulk ingested ${ingested} ${label}${skipped > 0 ? `, skipped ${skipped}` : ""}`
    );
  }

  return { ingested, skipped, results };
}
