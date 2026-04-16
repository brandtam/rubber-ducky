/**
 * Merge orchestrator: composes frontmatter-merge, body-merge, vault-rewrite,
 * orphan delete, and back-link comment preparation into one resumable
 * operation guarded by a sentinel file.
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
import {
  createMergeSentinel,
  writeSentinel,
  advanceSentinel,
  readSentinel,
  mergeCommentMarker,
  MERGE_STEPS,
  type MergeSentinel,
  type MergeStep,
} from "./merge-sentinel.js";

export interface MergeOptions {
  asanaRef: string;
  jiraRef: string;
  workspaceRoot: string;
  resolutions?: MergeResolutions;
  /** Test-only: throw after advancing to this step to simulate a crash. */
  __crashAfter?: MergeStep;
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
  /**
   * Live sentinel state. The caller is responsible for advancing the
   * sentinel through the back-link phase and deleting it on completion.
   */
  sentinel: MergeSentinel;
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
  const { asanaRef, jiraRef, workspaceRoot, resolutions, __crashAfter } = options;
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");

  // ---- Validation (no sentinel yet — failures are clean) ----

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

  // ---- Prepare merge content ----

  const extras = collectPreservedExtras(asana.body, jira.body);
  let mergedBody = mergePageBodies(asana.body, jira.body);
  if (extras.asana.length > 0 || extras.jira.length > 0) {
    mergedBody = appendMergeBreadcrumb(mergedBody, asanaRef, jiraRef, extras);
  }
  const mergedFilename = `${asanaRef} (${jiraRef}).md`;
  const mergedPath = path.join(tasksDir, mergedFilename);
  const mergedStem = `${asanaRef} (${jiraRef})`;
  const mergedContent = generateMergedPageContent(fmResult.merged, mergedBody);

  const marker = mergeCommentMarker(asanaRef, jiraRef);

  // ---- Sentinel: begin tracked mutation sequence ----

  let sentinel = createMergeSentinel({
    asanaRef,
    jiraRef,
    resolutions: resolutions as Record<string, string> | undefined,
    merged: {
      filename: mergedFilename,
      path: mergedPath,
      stem: mergedStem,
      oldAsanaStem: path.basename(asanaPath, ".md"),
      oldJiraStem: path.basename(jiraPath, ".md"),
    },
  });
  writeSentinel(workspaceRoot, sentinel);

  if (__crashAfter === "started") throw new Error("__crashAfter: started");

  // Phase 1: write merged file
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(mergedPath, mergedContent, "utf-8");
  sentinel = advanceSentinel(workspaceRoot, sentinel, "merged-file-written");

  if (__crashAfter === "merged-file-written") throw new Error("__crashAfter: merged-file-written");

  // Phase 2: delete originals
  if (asanaPath !== mergedPath && fs.existsSync(asanaPath)) fs.unlinkSync(asanaPath);
  if (fs.existsSync(jiraPath)) fs.unlinkSync(jiraPath);
  sentinel = advanceSentinel(workspaceRoot, sentinel, "orphans-deleted");

  if (__crashAfter === "orphans-deleted") throw new Error("__crashAfter: orphans-deleted");

  // Phase 3: rewrite wikilinks vault-wide
  rewriteWikilinksForStems(workspaceRoot, [
    { oldStem: path.basename(asanaPath, ".md"), newStem: mergedStem },
    { oldStem: path.basename(jiraPath, ".md"), newStem: mergedStem },
  ]);
  sentinel = advanceSentinel(workspaceRoot, sentinel, "wikilinks-rewritten");

  if (__crashAfter === "wikilinks-rewritten") throw new Error("__crashAfter: wikilinks-rewritten");

  // Phase 4: audit log
  appendLog(workspaceRoot, `Merged ${asanaRef} + ${jiraRef} → ${mergedFilename}`);
  sentinel = advanceSentinel(workspaceRoot, sentinel, "logged", {
    backLinks: [
      { backend: "asana", target: asana.taskPage.ref ?? asanaRef, posted: false },
      { backend: "jira", target: jira.taskPage.ref ?? jiraRef, posted: false },
    ],
  });

  if (__crashAfter === "logged") throw new Error("__crashAfter: logged");

  // ---- Build write actions with idempotency marker ----

  const writeActions: WriteAction[] = [
    {
      action: "comment",
      backend: "asana",
      target: asana.taskPage.ref ?? asanaRef,
      payload: { text: `Linked to ${jiraRef} in work log\n${marker}` },
    },
    {
      action: "comment",
      backend: "jira",
      target: jira.taskPage.ref ?? jiraRef,
      payload: { text: `Linked to ${asanaRef} in work log\n${marker}` },
    },
  ];

  return {
    success: true,
    mergedFilename,
    mergedPath,
    mergedTaskPage: fmResult.merged,
    writeActions,
    sentinel,
  };
}

/**
 * Resume a merge from the step recorded in the sentinel. Executes only
 * the phases that haven't completed yet, leaving the vault in the same
 * final state as an uninterrupted merge.
 *
 * Returns write actions for back-links that haven't been posted, or an
 * empty array if the back-link phase was already complete.
 */
export function resumeMerge(
  workspaceRoot: string,
  sentinel: MergeSentinel,
): MergeResult {
  const { asanaRef, jiraRef } = sentinel.args;
  const { merged } = sentinel;
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  // Captured once at entry: all phases after this index run unconditionally.
  const stepIndex = MERGE_STEPS.indexOf(sentinel.step);

  let current = sentinel;

  // Phase 1: write merged file (if not done)
  if (stepIndex < MERGE_STEPS.indexOf("merged-file-written")) {
    const asanaPath = findTaskFile(workspaceRoot, asanaRef);
    const jiraPath = findTaskFile(workspaceRoot, jiraRef);
    if (!asanaPath && !jiraPath && !fs.existsSync(merged.path)) {
      return {
        success: false,
        error: `Cannot resume: neither original files nor merged file found.`,
      };
    }

    if (!fs.existsSync(merged.path)) {
      if (!asanaPath || !jiraPath) {
        return {
          success: false,
          error: `Cannot resume from 'started': original page(s) missing. Use --abort.`,
        };
      }
      const asana = parsePageFile(asanaPath);
      const jira = parsePageFile(jiraPath);
      const resolutions = sentinel.args.resolutions as MergeResolutions | undefined;
      const fmResult = mergeFrontmatter(asana.taskPage, jira.taskPage, resolutions);
      if (fmResult.conflicts.length > 0) {
        return {
          success: false,
          error: `Resume encountered unresolved conflicts. Use --abort and re-run with resolution flags.`,
          conflicts: fmResult.conflicts,
        };
      }
      const extras = collectPreservedExtras(asana.body, jira.body);
      let mergedBody = mergePageBodies(asana.body, jira.body);
      if (extras.asana.length > 0 || extras.jira.length > 0) {
        mergedBody = appendMergeBreadcrumb(mergedBody, asanaRef, jiraRef, extras);
      }
      const mergedContent = generateMergedPageContent(fmResult.merged, mergedBody);
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(merged.path, mergedContent, "utf-8");
    }
    current = advanceSentinel(workspaceRoot, current, "merged-file-written");
  }

  // Phase 2: delete originals (if not done)
  if (stepIndex < MERGE_STEPS.indexOf("orphans-deleted")) {
    const asanaPath = path.join(tasksDir, `${merged.oldAsanaStem}.md`);
    const jiraPath = path.join(tasksDir, `${merged.oldJiraStem}.md`);
    if (asanaPath !== merged.path && fs.existsSync(asanaPath)) fs.unlinkSync(asanaPath);
    if (fs.existsSync(jiraPath)) fs.unlinkSync(jiraPath);
    current = advanceSentinel(workspaceRoot, current, "orphans-deleted");
  }

  // Phase 3: rewrite wikilinks (if not done)
  if (stepIndex < MERGE_STEPS.indexOf("wikilinks-rewritten")) {
    rewriteWikilinksForStems(workspaceRoot, [
      { oldStem: merged.oldAsanaStem, newStem: merged.stem },
      { oldStem: merged.oldJiraStem, newStem: merged.stem },
    ]);
    current = advanceSentinel(workspaceRoot, current, "wikilinks-rewritten");
  }

  // Phase 4: audit log (if not done)
  if (stepIndex < MERGE_STEPS.indexOf("logged")) {
    appendLog(workspaceRoot, `Merged ${asanaRef} + ${jiraRef} → ${merged.filename} (resumed)`);
    const backLinks = current.backLinks ?? [
      { backend: "asana" as const, target: asanaRef, posted: false },
      { backend: "jira" as const, target: jiraRef, posted: false },
    ];
    current = advanceSentinel(workspaceRoot, current, "logged", { backLinks });
  }

  // Re-parse the merged file to get the TaskPage for back-link posting
  const mergedPage = parsePageFile(merged.path);
  const marker = mergeCommentMarker(asanaRef, jiraRef);

  const pendingBackLinks = (current.backLinks ?? []).filter((b) => !b.posted);
  const writeActions: WriteAction[] = pendingBackLinks.map((bl) => ({
    action: "comment" as const,
    backend: bl.backend,
    target: bl.target,
    payload: {
      text: bl.backend === "asana"
        ? `Linked to ${jiraRef} in work log\n${marker}`
        : `Linked to ${asanaRef} in work log\n${marker}`,
    },
  }));

  return {
    success: true,
    mergedFilename: merged.filename,
    mergedPath: merged.path,
    mergedTaskPage: mergedPage.taskPage,
    writeActions,
    sentinel: current,
  };
}
