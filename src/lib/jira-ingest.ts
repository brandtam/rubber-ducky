/**
 * Jira issue ingest orchestration.
 *
 * Fetches an issue + comments via the REST client, checks for dedup,
 * writes a fully populated task page, rebuilds the index, and appends
 * to the log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import type { JiraClient, JiraIssue, JiraComment } from "./jira-client.js";
import type { Status, TaskPage } from "./backend.js";
import { mapJiraStatusToStatus } from "./jira-backend.js";
import { slugify } from "./page.js";
import { rebuildIndex, appendLog } from "./wiki.js";
import { parseFrontmatter } from "./frontmatter.js";

export interface IngestJiraOptions {
  client: JiraClient;
  ref: string;
  workspaceRoot: string;
  serverUrl: string;
  statusMapping?: Record<string, Status>;
}

export interface IngestJiraProjectOptions {
  client: JiraClient;
  projectKey: string;
  workspaceRoot: string;
  serverUrl: string;
  statusMapping?: Record<string, Status>;
  scope?: "mine" | "all";
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
 * Check whether a task with the given jira_ref already exists in wiki/tasks/.
 * Returns the relative path of the existing file, or null if no duplicate found.
 */
function findExistingByJiraRef(
  workspaceRoot: string,
  jiraRef: string
): string | null {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(tasksDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (parsed && parsed.data.jira_ref === jiraRef) {
      return path.join("wiki", "tasks", file);
    }
  }
  return null;
}

/**
 * Convert a Jira issue + comments into a TaskPage.
 */
function jiraIssueToPage(
  issue: JiraIssue,
  comments: JiraComment[],
  serverUrl: string,
  statusMapping?: Record<string, Status>
): TaskPage {
  const status = mapJiraStatusToStatus(issue.fields.status.name, statusMapping);
  const now = new Date().toISOString();

  const formattedComments = comments.map(
    (c) => `**${c.author.displayName}** — ${c.created}:\n${c.body}`
  );

  return {
    title: issue.fields.summary,
    ref: issue.key,
    source: "jira",
    status,
    priority: issue.fields.priority?.name ?? null,
    assignee: issue.fields.assignee?.displayName ?? null,
    tags: issue.fields.labels,
    created: now,
    updated: now,
    closed: issue.fields.resolutiondate ?? (status === "done" ? issue.fields.updated : null),
    pushed: null,
    due: issue.fields.duedate ?? null,
    jira_ref: `${serverUrl.replace(/\/+$/, "")}/browse/${issue.key}`,
    asana_ref: null,
    gh_ref: null,
    comment_count: formattedComments.length,
    description: issue.fields.description ?? "",
    comments: formattedComments,
  };
}

/**
 * Generate the full markdown content for an ingested Jira task page.
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
    `- ${taskPage.created} — Ingested from Jira (${taskPage.ref})`
  );
  sections.push("");

  // ## See also
  sections.push("## See also");
  sections.push("");

  return `---\n${yaml}\n---\n${sections.join("\n")}`;
}

/**
 * Ingest a single Jira issue into the workspace.
 *
 * 1. Fetch issue + comments via REST client
 * 2. Dedup check (jira_ref in wiki/tasks/)
 * 3. Write fully populated task page
 * 4. Rebuild index
 * 5. Append to log
 * 6. Return structured result
 */
export async function ingestJiraIssue(
  options: IngestJiraOptions
): Promise<IngestResult> {
  const { client, ref, workspaceRoot, serverUrl, statusMapping } = options;

  // Fetch from Jira REST API
  const issue = await client.getIssue(ref);
  const comments = await client.getComments(ref);

  // Convert to TaskPage
  const taskPage = jiraIssueToPage(issue, comments, serverUrl, statusMapping);

  // Dedup check
  const existingFile = findExistingByJiraRef(workspaceRoot, taskPage.jira_ref!);
  if (existingFile) {
    return {
      success: true,
      skipped: true,
      reason: "already ingested",
      existingFile,
    };
  }

  // Write task page — use issue key as filename (e.g., ecomm-4643.md)
  const filename = `${slugify(issue.key)}.md`;
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
    `Ingested Jira issue: ${taskPage.title} (${taskPage.ref})`
  );

  return {
    success: true,
    skipped: false,
    filePath: relativePath,
    taskPage,
  };
}

/**
 * Ingest all issues from a Jira project.
 *
 * Uses JQL to search for issues. Supports --mine scope filtering.
 * Processes each issue sequentially, skipping duplicates.
 */
export async function ingestJiraProject(
  options: IngestJiraProjectOptions
): Promise<IngestResult[]> {
  const { client, projectKey, workspaceRoot, serverUrl, statusMapping, scope } = options;

  // Build JQL
  let jql = `project = ${projectKey}`;
  if (scope === "mine") {
    jql += " AND assignee = currentUser()";
  }
  jql += " ORDER BY created DESC";

  // Search for issues
  const searchResult = await client.searchIssues(jql);

  const results: IngestResult[] = [];
  for (const issue of searchResult.issues) {
    const result = await ingestJiraIssue({
      client,
      ref: issue.key,
      workspaceRoot,
      serverUrl,
      statusMapping,
    });
    results.push(result);
  }

  return results;
}
