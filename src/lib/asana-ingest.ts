/**
 * Asana single-task ingest orchestration.
 *
 * Fetches a task + stories via the REST client, checks for dedup,
 * writes a fully populated task page, rebuilds the index, and appends
 * to the log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import type {
  AsanaClient,
  AsanaTask,
  AsanaStory,
  AsanaAttachment,
} from "./asana-client.js";
import type { Status, TaskPage } from "./backend.js";
import { mapAsanaToStatus } from "./asana-backend.js";
import { slugify } from "./page.js";
import { rebuildIndex, appendLog } from "./wiki.js";
import { parseFrontmatter } from "./frontmatter.js";

export interface IngestAsanaOptions {
  client: AsanaClient;
  ref: string;
  workspaceRoot: string;
  statusMapping?: Record<string, string>;
  identifierField?: string;
}

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

/**
 * Extract an Asana task GID from a reference string.
 * Accepts plain GIDs or full Asana URLs.
 */
function extractTaskGid(ref: string): string {
  if (ref.includes("asana.com")) {
    const match = ref.match(/\/(\d+)\s*$/);
    if (match) return match[1];
  }
  return ref;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".bmp",
  ".ico",
]);

function isImageFilename(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

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

/**
 * Check whether a task with the given asana_ref already exists in wiki/tasks/.
 * Returns the relative path of the existing file, or null if no duplicate found.
 */
function findExistingByAsanaRef(
  workspaceRoot: string,
  asanaRef: string
): string | null {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(tasksDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (parsed && parsed.data.asana_ref === asanaRef) {
      return path.join("wiki", "tasks", file);
    }
  }
  return null;
}

/**
 * Convert a raw Asana task + stories into a TaskPage.
 * When resolvedRef is provided (from identifier_field), it's used as the ref.
 * Otherwise falls back to the task GID.
 */
function asanaTaskToPage(
  task: AsanaTask,
  stories: AsanaStory[],
  statusMapping?: Record<string, string>,
  resolvedRef?: string | null
): TaskPage {
  const sectionName = task.memberships?.[0]?.section?.name;
  const status = mapAsanaToStatus(task.completed, sectionName, statusMapping);
  const now = new Date().toISOString();

  const comments = stories
    .filter((s) => s.type === "comment")
    .map((s) => `**${s.created_by.name}** — ${s.created_at}:\n${s.text}`);

  return {
    title: task.name,
    ref: resolvedRef ?? task.gid,
    source: "asana",
    status,
    priority: null,
    assignee: task.assignee?.name ?? null,
    tags: task.tags.map((t) => t.name),
    created: now,
    updated: now,
    closed: task.completed ? (task.completed_at ?? now) : null,
    pushed: null,
    due: task.due_on ?? null,
    jira_ref: null,
    asana_ref: task.permalink_url,
    gh_ref: null,
    comment_count: comments.length,
    description: task.notes ?? "",
    comments,
  };
}

/**
 * Generate the full markdown content for a task page with populated body.
 * Includes ## Attachments section when attachments are provided.
 */
function generateIngestedTaskPage(
  taskPage: TaskPage,
  attachments?: AsanaAttachment[],
  assetRef?: string
): string {
  const frontmatter = {
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

  const yaml = yamlStringify(frontmatter).trimEnd();

  // Build body sections
  const sections: string[] = [];

  // ## Description
  sections.push("## Description");
  sections.push("");
  if (taskPage.description) {
    sections.push(taskPage.description);
  }
  sections.push("");

  // ## Comments
  sections.push("## Comments");
  sections.push("");
  if (taskPage.comments.length > 0) {
    for (const comment of taskPage.comments) {
      sections.push(comment);
      sections.push("");
    }
  }

  // ## Attachments
  sections.push("## Attachments");
  sections.push("");
  if (attachments && attachments.length > 0 && assetRef) {
    for (const att of attachments) {
      const relPath = `../../raw/assets/${assetRef}/${att.name}`;
      if (isImageFilename(att.name)) {
        sections.push(`![${att.name}](${relPath})`);
      } else {
        sections.push(`[${att.name}](${relPath})`);
      }
    }
    sections.push("");
  }

  // ## Activity log
  sections.push("## Activity log");
  sections.push("");
  sections.push(
    `- ${taskPage.created} — Ingested from Asana (GID: ${taskPage.ref})`
  );
  sections.push("");

  // ## See also
  sections.push("## See also");
  sections.push("");

  return `---\n${yaml}\n---\n${sections.join("\n")}`;
}

/**
 * Ingest a single Asana task into the workspace.
 *
 * 1. Extract GID from ref (plain GID or URL)
 * 2. Fetch task + stories + attachments via REST client
 * 3. Resolve identifier (custom field or GID fallback)
 * 4. Dedup check (asana_ref in wiki/tasks/)
 * 5. Download attachments to raw/assets/<ref>/
 * 6. Write fully populated task page
 * 7. Rebuild index
 * 8. Append to log
 * 9. Return structured result
 */
export async function ingestAsanaTask(
  options: IngestAsanaOptions
): Promise<IngestResult> {
  const { client, ref, workspaceRoot, statusMapping, identifierField } =
    options;

  const taskGid = extractTaskGid(ref);

  // Fetch from Asana REST API
  const task = await client.getTask(taskGid);
  const stories = await client.getStories(taskGid);
  const attachments = await client.getAttachments(taskGid);

  // Resolve identifier from custom fields or fall back to GID
  const resolvedIdentifier = resolveIdentifier(task, identifierField);

  // Convert to TaskPage (with resolved identifier as ref when available)
  const taskPage = asanaTaskToPage(
    task,
    stories,
    statusMapping,
    resolvedIdentifier
  );

  // Dedup check
  const existingFile = findExistingByAsanaRef(
    workspaceRoot,
    taskPage.asana_ref!
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

  // Download attachments to raw/assets/<ref>/
  const downloadable = attachments.filter((a) => a.download_url);
  if (downloadable.length > 0) {
    const assetDir = path.join(workspaceRoot, "raw", "assets", assetRef);
    fs.mkdirSync(assetDir, { recursive: true });
    for (const att of downloadable) {
      const data = await client.downloadFile(att.download_url!);
      fs.writeFileSync(path.join(assetDir, att.name), data);
    }
  }

  // Determine filename: use identifier when available, otherwise title
  const filenameBase = resolvedIdentifier
    ? slugify(resolvedIdentifier)
    : slugify(taskPage.title);
  const filename = `${filenameBase}.md`;
  const relativePath = path.join("wiki", "tasks", filename);
  const fullPath = path.join(workspaceRoot, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = generateIngestedTaskPage(taskPage, attachments, assetRef);
  fs.writeFileSync(fullPath, content, "utf-8");

  // Rebuild index
  rebuildIndex(workspaceRoot);

  // Append to log
  appendLog(
    workspaceRoot,
    `Ingested Asana task: ${taskPage.title} (${taskPage.ref})`
  );

  return {
    success: true,
    skipped: false,
    filePath: relativePath,
    taskPage,
    attachmentCount: attachments.length,
  };
}
