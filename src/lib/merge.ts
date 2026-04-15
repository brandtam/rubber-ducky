/**
 * Merge orchestrator: composes frontmatter-merge, body-merge, vault-rewrite,
 * orphan delete, and back-link comment preparation into one atomic operation.
 *
 * `runMerge(options)` is the single public entry point. It:
 * 1. Locates the Asana and Jira pages on disk by filename stem
 * 2. Checks many-to-one rule (one Jira key per ECOMM page)
 * 3. Parses frontmatter + body from both pages
 * 4. Merges frontmatter (with optional conflict resolutions)
 * 5. Merges bodies
 * 6. Writes the merged page as `ECOMM-XXXX (WEB-NNN).md`
 * 7. Rewrites wikilinks vault-wide (both ECOMM-XXXX and WEB-NNN → merged name)
 * 8. Deletes orphan pages
 * 9. Appends to wiki/log.md
 * 10. Returns write actions for back-link comments (caller confirms + executes)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { parseFrontmatter } from "./frontmatter.js";
import { mergeFrontmatter, type MergeConflict, type MergeResolutions } from "./frontmatter-merge.js";
import { mergePageBodies } from "./body-merge.js";
import { renameAndRewrite } from "./vault-rewrite.js";
import { appendLog } from "./wiki.js";
import type { TaskPage, Status } from "./backend.js";
import type { WriteAction } from "./writeback.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Find a task file in wiki/tasks/ by its filename stem (case-insensitive).
 * Returns the full path if found, null otherwise.
 */
function findTaskFile(
  workspaceRoot: string,
  stem: string
): string | null {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  const target = stem.toLowerCase();
  for (const file of files) {
    const fileStem = file.replace(/\.md$/, "").toLowerCase();
    if (fileStem === target) {
      return path.join(tasksDir, file);
    }
  }
  return null;
}

/**
 * Parse a task page file into a TaskPage object by reading frontmatter.
 */
function parseTaskPageFromFile(filePath: string): TaskPage {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) throw new Error(`Failed to parse frontmatter from ${filePath}`);

  const d = parsed.data;
  return {
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
    jira_needed: d.jira_needed != null ? String(d.jira_needed) as "yes" | "no" : null,
    asana_status_raw: d.asana_status_raw != null ? String(d.asana_status_raw) : null,
    jira_status_raw: d.jira_status_raw != null ? String(d.jira_status_raw) : null,
    comment_count: typeof d.comment_count === "number" ? d.comment_count : 0,
    description: "",
    comments: [],
  };
}

/**
 * Check many-to-one: scan tasks dir for any page that already has
 * the given jira_ref set. Returns the filename stem of the existing
 * pairing, or null if no pairing exists.
 */
function findExistingJiraPairing(
  workspaceRoot: string,
  jiraRef: string,
  excludeStems: string[]
): string | null {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return null;

  const excluded = new Set(excludeStems.map((s) => s.toLowerCase()));
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const stem = file.replace(/\.md$/, "");
    if (excluded.has(stem.toLowerCase())) continue;

    const content = fs.readFileSync(path.join(tasksDir, file), "utf-8");
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const fileJiraRef = parsed.data.jira_ref;
    if (
      typeof fileJiraRef === "string" &&
      fileJiraRef.length > 0 &&
      fileJiraRef !== "null"
    ) {
      // Check if the jira_ref URL or key contains our jira ref
      if (
        fileJiraRef.includes(jiraRef) ||
        fileJiraRef === jiraRef
      ) {
        return stem;
      }
    }
  }
  return null;
}

/**
 * Generate merged page markdown (frontmatter + body).
 */
function generateMergedPageContent(
  mergedTaskPage: TaskPage,
  mergedBody: string
): string {
  const fm: Record<string, unknown> = {
    title: mergedTaskPage.title,
    type: "task",
    ref: mergedTaskPage.ref,
    source: mergedTaskPage.source,
    status: mergedTaskPage.status,
    priority: mergedTaskPage.priority,
    assignee: mergedTaskPage.assignee,
    tags: mergedTaskPage.tags,
    created: mergedTaskPage.created,
    updated: mergedTaskPage.updated,
    closed: mergedTaskPage.closed,
    pushed: mergedTaskPage.pushed,
    due: mergedTaskPage.due,
    jira_ref: mergedTaskPage.jira_ref,
    asana_ref: mergedTaskPage.asana_ref,
    gh_ref: mergedTaskPage.gh_ref,
    jira_needed: mergedTaskPage.jira_needed,
    comment_count: mergedTaskPage.comment_count,
  };

  // Conditionally add raw status fields
  if (mergedTaskPage.asana_status_raw != null) {
    fm.asana_status_raw = mergedTaskPage.asana_status_raw;
  }
  if (mergedTaskPage.jira_status_raw != null) {
    fm.jira_status_raw = mergedTaskPage.jira_status_raw;
  }

  const yaml = yamlStringify(fm).trimEnd();
  return `---\n${yaml}\n---\n${mergedBody}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the merge operation. Returns a MergeResult.
 *
 * When conflicts exist and no resolutions are provided, returns
 * `success: false` with the conflict list — caller is expected to
 * prompt the user and retry with resolutions.
 *
 * When successful, returns `writeActions` — the back-link comment
 * WriteActions that the caller should present for confirmation and
 * then execute via the backend comment API.
 */
export function runMerge(options: MergeOptions): MergeResult {
  const { asanaRef, jiraRef, workspaceRoot, resolutions } = options;
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");

  // 1. Locate pages
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

  // 2. Many-to-one check — exclude both the asana and jira page being merged
  const existingPairing = findExistingJiraPairing(
    workspaceRoot,
    jiraRef,
    [asanaRef, jiraRef]
  );
  if (existingPairing) {
    return {
      success: false,
      error: `Cannot merge: ${jiraRef} is already linked to ${existingPairing}. One Jira key can only be linked to one ECOMM page.`,
    };
  }

  // 3. Parse both pages
  const asanaTaskPage = parseTaskPageFromFile(asanaPath);
  const jiraTaskPage = parseTaskPageFromFile(jiraPath);

  const asanaContent = fs.readFileSync(asanaPath, "utf-8");
  const jiraContent = fs.readFileSync(jiraPath, "utf-8");

  const asanaParsed = parseFrontmatter(asanaContent);
  const jiraParsed = parseFrontmatter(jiraContent);

  const asanaBody = asanaParsed?.body ?? "";
  const jiraBody = jiraParsed?.body ?? "";

  // 4. Merge frontmatter
  const fmResult = mergeFrontmatter(asanaTaskPage, jiraTaskPage, resolutions);

  // If conflicts exist and no resolutions were provided, bail out
  if (fmResult.conflicts.length > 0) {
    return {
      success: false,
      conflicts: fmResult.conflicts,
      error: `Merge has ${fmResult.conflicts.length} unresolved conflict(s). Provide resolution flags: ${fmResult.conflicts.map((c) => c.field).join(", ")}`,
    };
  }

  // 5. Merge bodies
  const mergedBody = mergePageBodies(asanaBody, jiraBody);

  // 6. Write merged page
  const mergedFilename = `${asanaRef} (${jiraRef}).md`;
  const mergedPath = path.join(tasksDir, mergedFilename);
  const mergedContent = generateMergedPageContent(fmResult.merged, mergedBody);

  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(mergedPath, mergedContent, "utf-8");

  // 7. Rewrite wikilinks vault-wide
  //    First: rewrite [[ECOMM-XXXX]] → [[ECOMM-XXXX (WEB-NNN)]]
  const asanaStem = path.basename(asanaPath, ".md");
  const mergedStem = `${asanaRef} (${jiraRef})`;

  // Delete originals before wikilink rewrite to avoid them being scanned
  // But we need them for renameAndRewrite, so handle carefully:
  // renameAndRewrite expects oldPath to exist — but we already wrote
  // mergedPath. We'll do wikilink rewriting manually.

  // Delete the Asana original (merged page already written with new name)
  if (asanaPath !== mergedPath && fs.existsSync(asanaPath)) {
    fs.unlinkSync(asanaPath);
  }

  // Now rewrite [[ECOMM-XXXX]] wikilinks across vault
  rewriteWikilinks(workspaceRoot, asanaStem, mergedStem);

  // Delete the Jira orphan
  if (fs.existsSync(jiraPath)) {
    fs.unlinkSync(jiraPath);
  }

  // Rewrite [[WEB-NNN]] wikilinks across vault
  const jiraStem = path.basename(jiraPath, ".md");
  rewriteWikilinks(workspaceRoot, jiraStem, mergedStem);

  // 9. Append to log
  appendLog(
    workspaceRoot,
    `Merged ${asanaRef} + ${jiraRef} → ${mergedFilename}`
  );

  // 10. Prepare write actions for back-link comments
  const writeActions: WriteAction[] = [
    {
      action: "comment",
      backend: "asana",
      target: asanaTaskPage.ref ?? asanaRef,
      payload: {
        text: `Linked to ${jiraRef} in work log`,
      },
    },
    {
      action: "comment",
      backend: "jira",
      target: jiraTaskPage.ref ?? jiraRef,
      payload: {
        text: `Linked to ${asanaRef} in work log`,
      },
    },
  ];

  return {
    success: true,
    mergedFilename,
    mergedPath,
    writeActions,
  };
}

// ---------------------------------------------------------------------------
// Wikilink rewriting (without file rename — files are already in place)
// ---------------------------------------------------------------------------

/**
 * Rewrite all [[oldStem]] wikilinks across wiki/**\/*.md to [[newStem]].
 * Case-insensitive matching. Does NOT rename any files.
 */
function rewriteWikilinks(
  vaultRoot: string,
  oldStem: string,
  newStem: string
): void {
  if (oldStem === newStem) return;

  const escaped = oldStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wikilinkRegex = new RegExp(
    `\\[\\[(${escaped})(\\|[^\\]]*)?\\]\\]`,
    "gi"
  );

  const wikiDir = path.join(vaultRoot, "wiki");
  const mdFiles = collectMdFiles(wikiDir);

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!wikilinkRegex.test(content)) continue;

    wikilinkRegex.lastIndex = 0;
    const updated = content.replace(wikilinkRegex, (_match, _stem, pipe) => {
      return `[[${newStem}${pipe ?? ""}]]`;
    });

    if (updated !== content) {
      fs.writeFileSync(filePath, updated, "utf-8");
    }
  }
}

/**
 * Collect all .md files under a directory (recursive).
 */
function collectMdFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMdFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}
