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
import type { AsanaClient, AsanaTask, AsanaStory } from "./asana-client.js";
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
}

export interface IngestResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  existingFile?: string;
  filePath?: string;
  taskPage?: TaskPage;
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
 */
function asanaTaskToPage(
  task: AsanaTask,
  stories: AsanaStory[],
  statusMapping?: Record<string, string>
): TaskPage {
  const sectionName = task.memberships?.[0]?.section?.name;
  const status = mapAsanaToStatus(task.completed, sectionName, statusMapping);
  const now = new Date().toISOString();

  const comments = stories
    .filter((s) => s.type === "comment")
    .map((s) => `**${s.created_by.name}** — ${s.created_at}:\n${s.text}`);

  return {
    title: task.name,
    ref: task.gid,
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
 */
function generateIngestedTaskPage(taskPage: TaskPage): string {
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
 * 2. Fetch task + stories via REST client
 * 3. Dedup check (asana_ref in wiki/tasks/)
 * 4. Write fully populated task page
 * 5. Rebuild index
 * 6. Append to log
 * 7. Return structured result
 */
export async function ingestAsanaTask(
  options: IngestAsanaOptions
): Promise<IngestResult> {
  const { client, ref, workspaceRoot, statusMapping } = options;

  const taskGid = extractTaskGid(ref);

  // Fetch from Asana REST API
  const task = await client.getTask(taskGid);
  const stories = await client.getStories(taskGid);

  // Convert to TaskPage
  const taskPage = asanaTaskToPage(task, stories, statusMapping);

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

  // Write task page
  const filename = `${slugify(taskPage.title)}.md`;
  const relativePath = path.join("wiki", "tasks", filename);
  const fullPath = path.join(workspaceRoot, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = generateIngestedTaskPage(taskPage);
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
  };
}
