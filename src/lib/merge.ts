/**
 * Merge orchestrator: composes frontmatter-merge, body-merge, vault-rewrite,
 * orphan delete, and back-link comment preparation into one atomic operation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { parseFrontmatter } from "./frontmatter.js";
import { mergeFrontmatter, type MergeConflict, type MergeResolutions } from "./frontmatter-merge.js";
import { mergePageBodies, collectPreservedExtras } from "./body-merge.js";
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

/**
 * Discriminated union on `success`. Narrowing with `if (result.success)`
 * gives the compiler proof that the post-merge fields are present, so
 * callers never need non-null assertions to reach `mergedTaskPage` or
 * `writeActions`. New adapters (push, transition, migrate) should mirror
 * this shape rather than re-introducing the bag-of-optionals pattern.
 */
export type MergeResult = MergeSuccess | MergeFailure;

export interface MergeSuccess {
  success: true;
  mergedFilename: string;
  mergedPath: string;
  /**
   * The merged canonical TaskPage written to disk. Exposed so callers can
   * drive back-link writes (`backend.comment`) against the merged identity
   * without re-parsing the file.
   */
  mergedTaskPage: TaskPage;
  writeActions: WriteAction[];
}

export interface MergeFailure {
  success: false;
  error: string;
  /** Present only when the failure was unresolved frontmatter conflicts. */
  conflicts?: MergeConflict[];
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

/**
 * Append a single `## Activity log` entry naming every non-canonical section
 * that `mergePageBodies` preserved under a `(from …)` suffix. This is the
 * provenance breadcrumb the reader scans to see what came from where.
 */
function appendMergeBreadcrumb(
  mergedBody: string,
  asanaRef: string,
  jiraRef: string,
  extras: { asana: string[]; jira: string[] }
): string {
  const quoted = (names: string[], backend: string) =>
    names.map((n) => `"${n}" (${backend})`).join(", ");
  const parts = [
    extras.asana.length > 0 ? quoted(extras.asana, "Asana") : null,
    extras.jira.length > 0 ? quoted(extras.jira, "Jira") : null,
  ].filter((p): p is string => p !== null);
  const entry = `- ${new Date().toISOString()} — Merged ${asanaRef} + ${jiraRef}. Preserved extras: ${parts.join(", ")}.`;

  const headerIdx = mergedBody.indexOf("## Activity log");
  if (headerIdx === -1) {
    // mergePageBodies always emits Activity log, but defend against a future
    // contract change by appending at the end rather than silently dropping.
    return `${mergedBody.trimEnd()}\n\n## Activity log\n\n${entry}\n`;
  }

  // Splice the entry in at the end of the Activity log section's body (before
  // the next `## ` header, or end of string).
  const tail = mergedBody.slice(headerIdx);
  const nextHeaderRel = tail.slice("## Activity log".length).search(/\n## /);
  const insertionPoint =
    nextHeaderRel === -1
      ? mergedBody.length
      : headerIdx + "## Activity log".length + nextHeaderRel;

  const before = mergedBody.slice(0, insertionPoint).trimEnd();
  const after = mergedBody.slice(insertionPoint);
  return `${before}\n${entry}\n${after.startsWith("\n") ? after : `\n${after}`}`;
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

  const extras = collectPreservedExtras(asana.body, jira.body);
  let mergedBody = mergePageBodies(asana.body, jira.body);
  if (extras.asana.length > 0 || extras.jira.length > 0) {
    mergedBody = appendMergeBreadcrumb(mergedBody, asanaRef, jiraRef, extras);
  }
  const mergedFilename = `${asanaRef} (${jiraRef}).md`;
  const mergedPath = path.join(tasksDir, mergedFilename);
  const mergedContent = generateMergedPageContent(fmResult.merged, mergedBody);

  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(mergedPath, mergedContent, "utf-8");

  // Unlink originals before the wikilink scan so `collectMdFiles` doesn't pick
  // them up: rewriting links inside files we're about to delete is wasted work
  // and leaves a confusing trail if the run is interrupted mid-pass.
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

  return {
    success: true,
    mergedFilename,
    mergedPath,
    mergedTaskPage: fmResult.merged,
    writeActions,
  };
}
