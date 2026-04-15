/**
 * Merge orchestrator: composes frontmatter-merge, body-merge, vault-rewrite,
 * orphan delete, and back-link comment preparation into one atomic operation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { parseFrontmatter } from "./frontmatter.js";
import { mergeFrontmatter, type MergeConflict, type MergeResolutions } from "./frontmatter-merge.js";
import { mergePageBodies } from "./body-merge.js";
import { rewriteWikilinksForStems } from "./vault-rewrite.js";
import { appendLog } from "./wiki.js";
import type { TaskPage, Status } from "./backend.js";
import type { WriteAction } from "./writeback.js";

export interface MergeOptions {
  asanaRef: string;
  jiraRef: string;
  workspaceRoot: string;
  resolutions?: MergeResolutions;
}

export interface MergeResult {
  success: boolean;
  mergedFilename?: string;
  mergedPath?: string;
  conflicts?: MergeConflict[];
  writeActions?: WriteAction[];
  error?: string;
}

interface ParsedPage {
  taskPage: TaskPage;
  body: string;
}

function findTaskFile(workspaceRoot: string, stem: string): string | null {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const target = stem.toLowerCase();
  for (const file of fs.readdirSync(tasksDir)) {
    if (!file.endsWith(".md")) continue;
    if (path.basename(file, ".md").toLowerCase() === target) {
      return path.join(tasksDir, file);
    }
  }
  return null;
}

function parsePageFile(filePath: string): ParsedPage {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) throw new Error(`Failed to parse frontmatter from ${filePath}`);

  const d = parsed.data;
  const taskPage: TaskPage = {
    title: String(d.title ?? ""),
    ref: d.ref != null ? String(d.ref) : null,
    source: d.source != null ? String(d.source) : null,
    status: (d.status as Status) ?? "backlog",
    priority: d.priority != null ? String(d.priority) : null,
    assignee: d.assignee != null ? String(d.assignee) : null,
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    created: String(d.created ?? new Date().toISOString()),
    updated: String(d.updated ?? new Date().toISOString()),
    closed: d.closed != null ? String(d.closed) : null,
    pushed: d.pushed != null ? String(d.pushed) : null,
    due: d.due != null ? String(d.due) : null,
    jira_ref: d.jira_ref != null ? String(d.jira_ref) : null,
    asana_ref: d.asana_ref != null ? String(d.asana_ref) : null,
    gh_ref: d.gh_ref != null ? String(d.gh_ref) : null,
    jira_needed: d.jira_needed != null ? (String(d.jira_needed) as "yes" | "no") : null,
    asana_status_raw: d.asana_status_raw != null ? String(d.asana_status_raw) : null,
    jira_status_raw: d.jira_status_raw != null ? String(d.jira_status_raw) : null,
    comment_count: typeof d.comment_count === "number" ? d.comment_count : 0,
    description: "",
    comments: [],
  };
  return { taskPage, body: parsed.body };
}

/**
 * Find a page already linked to `jiraRef` (excluding the two pages being
 * merged). Matches the Jira key at a word boundary so `WEB-297` and
 * `https://.../browse/WEB-297` both match without matching `WEB-2970`.
 */
function findExistingJiraPairing(
  workspaceRoot: string,
  jiraRef: string,
  excludeStems: string[]
): string | null {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const excluded = new Set(excludeStems.map((s) => s.toLowerCase()));
  const keyPattern = new RegExp(`\\b${jiraRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

  for (const file of fs.readdirSync(tasksDir)) {
    if (!file.endsWith(".md")) continue;
    const stem = path.basename(file, ".md");
    if (excluded.has(stem.toLowerCase())) continue;

    const parsed = parseFrontmatter(fs.readFileSync(path.join(tasksDir, file), "utf-8"));
    const stored = parsed?.data.jira_ref;
    if (typeof stored !== "string" || stored.length === 0) continue;
    if (stored === jiraRef || keyPattern.test(stored)) return stem;
  }
  return null;
}

function generateMergedPageContent(taskPage: TaskPage, body: string): string {
  const fm: Record<string, unknown> = {
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
    jira_needed: taskPage.jira_needed,
    comment_count: taskPage.comment_count,
  };

  if (taskPage.asana_status_raw != null) fm.asana_status_raw = taskPage.asana_status_raw;
  if (taskPage.jira_status_raw != null) fm.jira_status_raw = taskPage.jira_status_raw;

  return `---\n${yamlStringify(fm).trimEnd()}\n---\n${body}`;
}

/**
 * Run the merge operation. When conflicts exist and no resolutions are
 * provided, returns `success: false` with the conflict list — the caller
 * should prompt the user and retry with resolutions.
 *
 * On success, returns `writeActions` — back-link comment WriteActions the
 * caller presents for confirmation and executes via the backend API.
 */
export function runMerge(options: MergeOptions): MergeResult {
  const { asanaRef, jiraRef, workspaceRoot, resolutions } = options;
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");

  const asanaPath = findTaskFile(workspaceRoot, asanaRef);
  if (!asanaPath) {
    return {
      success: false,
      error: `Asana page not found: ${asanaRef}. Expected ${asanaRef}.md in wiki/tasks/`,
    };
  }

  const jiraPath = findTaskFile(workspaceRoot, jiraRef);
  if (!jiraPath) {
    return {
      success: false,
      error: `Jira page not found: ${jiraRef}. Expected ${jiraRef}.md in wiki/tasks/`,
    };
  }

  const existingPairing = findExistingJiraPairing(workspaceRoot, jiraRef, [asanaRef, jiraRef]);
  if (existingPairing) {
    return {
      success: false,
      error: `Cannot merge: ${jiraRef} is already linked to ${existingPairing}. One Jira key can only be linked to one ECOMM page.`,
    };
  }

  const asana = parsePageFile(asanaPath);
  const jira = parsePageFile(jiraPath);

  const fmResult = mergeFrontmatter(asana.taskPage, jira.taskPage, resolutions);
  if (fmResult.conflicts.length > 0) {
    return {
      success: false,
      conflicts: fmResult.conflicts,
      error: `Merge has ${fmResult.conflicts.length} unresolved conflict(s). Provide resolution flags: ${fmResult.conflicts.map((c) => c.field).join(", ")}`,
    };
  }

  const mergedBody = mergePageBodies(asana.body, jira.body);
  const mergedFilename = `${asanaRef} (${jiraRef}).md`;
  const mergedPath = path.join(tasksDir, mergedFilename);
  const mergedContent = generateMergedPageContent(fmResult.merged, mergedBody);

  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(mergedPath, mergedContent, "utf-8");

  // Delete originals before the vault-wide wikilink scan so their own
  // frontmatter ref values don't match themselves.
  if (asanaPath !== mergedPath && fs.existsSync(asanaPath)) fs.unlinkSync(asanaPath);
  if (fs.existsSync(jiraPath)) fs.unlinkSync(jiraPath);

  const mergedStem = `${asanaRef} (${jiraRef})`;
  rewriteWikilinksForStems(workspaceRoot, [
    { oldStem: path.basename(asanaPath, ".md"), newStem: mergedStem },
    { oldStem: path.basename(jiraPath, ".md"), newStem: mergedStem },
  ]);

  appendLog(workspaceRoot, `Merged ${asanaRef} + ${jiraRef} → ${mergedFilename}`);

  const writeActions: WriteAction[] = [
    {
      action: "comment",
      backend: "asana",
      target: asana.taskPage.ref ?? asanaRef,
      payload: { text: `Linked to ${jiraRef} in work log` },
    },
    {
      action: "comment",
      backend: "jira",
      target: jira.taskPage.ref ?? jiraRef,
      payload: { text: `Linked to ${asanaRef} in work log` },
    },
  ];

  return { success: true, mergedFilename, mergedPath, writeActions };
}
