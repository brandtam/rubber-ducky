/**
 * Asana ingest orchestration — single-task and bulk.
 *
 * Fetches tasks + stories via the REST client, checks for dedup,
 * writes fully populated task pages, rebuilds the index, and appends
 * to the log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AsanaClient,
  AsanaTask,
  AsanaAttachment,
  TaskListOptions,
} from "./asana-client.js";
import type { Status } from "./backend.js";
import { asanaTaskToPage, extractTaskGid, mapAsanaToStatus } from "./asana-backend.js";
import { slugify } from "./page.js";
import {
  type IngestResult,
  type BulkIngestResult,
  type DedupIndex,
  buildDedupIndex,
  findExistingByRef,
  isImageFilename,
  generateIngestedTaskPage,
  postIngestProcess,
  finalizeBulkIngest,
  mapWithConcurrency,
} from "./ingest-shared.js";

// Re-export shared types so consumers don't need to import from two places
export type { IngestResult, BulkIngestResult } from "./ingest-shared.js";
export { resolveScope } from "./ingest-shared.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IngestAsanaOptions {
  client: AsanaClient;
  ref: string;
  workspaceRoot: string;
  statusMapping?: Record<string, Status>;
  identifierField?: string;
  /** Pre-fetched task data from bulk list call — avoids redundant API request. */
  prefetchedTask?: AsanaTask;
  /** Pre-built dedup index — avoids re-scanning wiki/tasks/ per task in bulk. */
  dedupIndex?: DedupIndex;
  /** Skip index rebuild and log append — caller handles these after the loop. */
  skipPostProcess?: boolean;
}

export interface BulkIngestOptions {
  client: AsanaClient;
  ref?: string;
  workspaceRoot: string;
  statusMapping?: Record<string, Status>;
  identifierField?: string;
  defaultProjectGid?: string;
  scope?: "mine" | "all";
}

// ---------------------------------------------------------------------------
// Ref parsing
// ---------------------------------------------------------------------------

export interface ParsedRef {
  type: "task" | "project" | "section";
  gid: string;
}

/**
 * Parse an Asana ref string into a typed ref.
 * Formats: project:<gid>, section:<gid>, plain GID, or Asana URL.
 */
export function parseAsanaRef(ref: string): ParsedRef {
  const projectMatch = ref.match(/^project:(.+)$/);
  if (projectMatch) return { type: "project", gid: projectMatch[1] };

  const sectionMatch = ref.match(/^section:(.+)$/);
  if (sectionMatch) return { type: "section", gid: sectionMatch[1] };

  return { type: "task", gid: extractTaskGid(ref) };
}

// ---------------------------------------------------------------------------
// Identifier resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a human-readable identifier from Asana custom fields.
 * Matches by field name (case-insensitive). Returns the display_value
 * if found and non-empty, otherwise returns null (caller falls back to GID).
 */
function resolveIdentifier(
  task: AsanaTask,
  identifierField?: string
): string | null {
  if (!identifierField) return null;

  const needle = identifierField.toLowerCase();
  const field = task.custom_fields?.find(
    (cf) => cf.name.toLowerCase() === needle
  );

  if (field?.display_value) {
    return field.display_value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single-task ingest
// ---------------------------------------------------------------------------

/**
 * Ingest a single Asana task into the workspace.
 *
 * 1. Fetch task + stories + attachments via REST client (or use prefetched data)
 * 2. Resolve identifier (custom field or GID fallback)
 * 3. Dedup check (asana_ref in wiki/tasks/)
 * 4. Download attachments to raw/assets/<ref>/
 * 5. Write fully populated task page
 * 6. Optionally rebuild index and append log
 * 7. Return structured result
 */
export async function ingestAsanaTask(
  options: IngestAsanaOptions
): Promise<IngestResult> {
  const {
    client,
    ref,
    workspaceRoot,
    statusMapping,
    identifierField,
    prefetchedTask,
    dedupIndex,
    skipPostProcess,
  } = options;

  const taskGid = extractTaskGid(ref);

  // Fetch data — use prefetched task if available, parallelize remaining calls
  const task = prefetchedTask ?? await client.getTask(taskGid);
  const [stories, attachments] = await Promise.all([
    client.getStories(taskGid),
    client.getAttachments(taskGid),
  ]);

  // Resolve identifier from custom fields or fall back to GID
  const resolvedIdentifier = resolveIdentifier(task, identifierField);

  // Convert to TaskPage
  const taskPage = asanaTaskToPage(
    task,
    stories,
    statusMapping,
    resolvedIdentifier
  );

  // Dedup check
  if (!taskPage.asana_ref) {
    throw new Error(`Internal error: asana_ref is null after conversion for task ${taskGid}`);
  }
  const existingFile = findExistingByRef(
    workspaceRoot,
    "asana_ref",
    taskPage.asana_ref,
    dedupIndex
  );
  if (existingFile) {
    return {
      success: true,
      skipped: true,
      reason: "already ingested",
      existingFile,
    };
  }

  // Determine the asset ref (slugified identifier or raw GID)
  const assetRef = resolvedIdentifier
    ? slugify(resolvedIdentifier)
    : task.gid;

  // Download attachments in parallel
  const downloadable = attachments.filter(
    (a): a is AsanaAttachment & { download_url: string } => a.download_url !== null
  );
  if (downloadable.length > 0) {
    const assetDir = path.join(workspaceRoot, "raw", "assets", assetRef);
    fs.mkdirSync(assetDir, { recursive: true });
    await Promise.all(
      downloadable.map(async (att) => {
        const data = await client.downloadFile(att.download_url);
        fs.writeFileSync(path.join(assetDir, att.name), data);
      })
    );
  }

  // Build attachment refs for page generation
  const attachmentRefs = attachments.map((att) => ({
    name: att.name,
    isImage: isImageFilename(att.name),
  }));

  // Determine filename
  const filenameBase = resolvedIdentifier
    ? slugify(resolvedIdentifier)
    : slugify(taskPage.title);
  const filename = `${filenameBase}.md`;
  const relativePath = path.join("wiki", "tasks", filename);
  const fullPath = path.join(workspaceRoot, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = generateIngestedTaskPage(taskPage, {
    attachments: attachmentRefs,
    assetRef,
    source: "Asana",
  });
  fs.writeFileSync(fullPath, content, "utf-8");

  // Post-processing (skipped in bulk mode — caller handles it)
  if (!skipPostProcess) {
    postIngestProcess(
      workspaceRoot,
      `Ingested Asana task: ${taskPage.title} (${taskPage.ref})`
    );
  }

  return {
    success: true,
    skipped: false,
    filePath: relativePath,
    taskPage,
    attachmentCount: attachments.length,
  };
}

// ---------------------------------------------------------------------------
// Bulk ingest
// ---------------------------------------------------------------------------

/**
 * Bulk ingest Asana tasks from a project, section, or default project.
 *
 * Optimizations over naive per-task ingest:
 * - Builds dedup index once before the loop (avoids O(N*M) file scans)
 * - Passes prefetched task data from the list call (avoids N redundant API calls)
 * - Rebuilds index and appends log once after the loop (avoids O(N^2) I/O)
 */
export async function ingestAsanaBulk(
  options: BulkIngestOptions
): Promise<BulkIngestResult> {
  const {
    client,
    ref,
    workspaceRoot,
    statusMapping,
    identifierField,
    defaultProjectGid,
    scope,
  } = options;

  // Determine what to fetch
  let parsedRef: ParsedRef;
  if (ref) {
    parsedRef = parseAsanaRef(ref);
    if (parsedRef.type === "task") {
      const result = await ingestAsanaTask({
        client,
        ref: parsedRef.gid,
        workspaceRoot,
        statusMapping,
        identifierField,
      });
      return {
        ingested: result.skipped ? 0 : 1,
        skipped: result.skipped ? 1 : 0,
        results: [result],
      };
    }
  } else if (defaultProjectGid) {
    parsedRef = { type: "project", gid: defaultProjectGid };
  } else {
    throw new Error(
      "No ref provided and no default project configured. " +
      "Pass a project:<gid> or section:<gid> ref, or set project_gid in your Asana backend config."
    );
  }

  // Resolve scope filtering
  let listOpts: TaskListOptions | undefined;
  if (scope === "mine") {
    const me = await client.getMe();
    listOpts = { assigneeGid: me.gid };
  }

  // Fetch task list
  let tasks: AsanaTask[];
  if (parsedRef.type === "project") {
    tasks = await client.getTasksForProject(parsedRef.gid, listOpts);
  } else {
    tasks = await client.getTasksForSection(parsedRef.gid, listOpts);
  }

  // Build dedup index once before the loop
  const dedupIndex = buildDedupIndex(workspaceRoot, "asana_ref");

  // Process tasks with bounded concurrency (5 concurrent API calls)
  const results = await mapWithConcurrency(tasks, 5, (task) =>
    ingestAsanaTask({
      client,
      ref: task.gid,
      workspaceRoot,
      statusMapping,
      identifierField,
      prefetchedTask: task,
      dedupIndex,
      skipPostProcess: true,
    })
  );

  return finalizeBulkIngest(results, workspaceRoot, "Asana task(s)");
}
