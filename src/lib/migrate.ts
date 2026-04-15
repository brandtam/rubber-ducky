/**
 * One-time vault migration: upgrades pages ingested under old conventions
 * to the new ones established in #84.
 *
 * Covers:
 * - Filename case: lowercase identifier-based filenames → uppercase
 * - Section headers: generic `## Description` / `## Comments` → backend-scoped
 * - Wikilink rewriting across the vault
 *
 * Idempotent — running against an already-migrated vault is a no-op.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { renameAndRewrite } from "./vault-rewrite.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrateResult {
  filesRenamed: number;
  headersRewritten: number;
  wikilinksRewritten: number;
  alreadyMigrated: boolean;
  renames: Array<{ from: string; to: string }>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Pattern for identifier-based filenames (e.g., "ecomm-123", "web-45",
 * "ECOMM-3585"). These are the files that may need uppercase migration.
 * Matches: letters followed by hyphen followed by digits.
 */
const IDENTIFIER_FILENAME_RE = /^[a-zA-Z]+-\d+$/;

/**
 * Check if a filename stem is already fully uppercase.
 */
function isUpperCase(stem: string): boolean {
  return stem === stem.toUpperCase();
}

/**
 * Determine the backend name for section scoping from a page's source field.
 * Returns null for sources that don't use backend-scoped sections.
 */
function backendNameFromSource(source: string | null | undefined): string | null {
  if (source === "asana") return "Asana";
  if (source === "jira") return "Jira";
  return null;
}

/**
 * Rewrite generic `## Description` and `## Comments` headers to
 * backend-scoped form. Returns the updated content if changes were
 * made, or null if no changes needed.
 */
function rewriteSectionHeaders(
  content: string,
  backendName: string
): string | null {
  let updated = content;
  let changed = false;

  // Replace `## Description` (exact, at start of line) but not already-scoped
  const descRe = /^## Description$/m;
  if (descRe.test(updated)) {
    updated = updated.replace(descRe, `## ${backendName} description`);
    changed = true;
  }

  // Replace `## Comments` (exact, at start of line) but not already-scoped
  const commentsRe = /^## Comments$/m;
  if (commentsRe.test(updated)) {
    updated = updated.replace(commentsRe, `## ${backendName} comments`);
    changed = true;
  }

  return changed ? updated : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the vault migration. Scans `wiki/tasks/` for pages that need
 * upgrading and applies filename, header, and wikilink rewrites.
 *
 * Idempotent: returns `alreadyMigrated: true` when nothing needs changing.
 */
export function runMigrate(workspaceRoot: string): MigrateResult {
  const tasksDir = path.join(workspaceRoot, "wiki", "tasks");
  const result: MigrateResult = {
    filesRenamed: 0,
    headersRewritten: 0,
    wikilinksRewritten: 0,
    alreadyMigrated: false,
    renames: [],
  };

  if (!fs.existsSync(tasksDir)) {
    result.alreadyMigrated = true;
    return result;
  }

  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) {
    result.alreadyMigrated = true;
    return result;
  }

  // Collect rename operations first, then execute them all.
  // This avoids issues with renaming affecting subsequent reads.
  interface PendingRename {
    oldFilename: string;
    newFilename: string;
    source: string | null;
  }

  const pendingRenames: PendingRename[] = [];
  const headerRewrites: Array<{ filename: string; backendName: string }> = [];

  for (const filename of files) {
    const stem = filename.replace(/\.md$/, "");
    const filePath = path.join(tasksDir, filename);
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(content);
    const source = (parsed?.data?.source as string) ?? null;

    // Determine if this is an identifier-based filename that needs uppercasing
    if (IDENTIFIER_FILENAME_RE.test(stem) && !isUpperCase(stem)) {
      const newStem = stem.toUpperCase();
      pendingRenames.push({
        oldFilename: filename,
        newFilename: `${newStem}.md`,
        source,
      });
    }

    // Determine if section headers need rewriting
    const backendName = backendNameFromSource(source);
    if (backendName) {
      // Check if generic headers exist
      if (/^## Description$/m.test(content) || /^## Comments$/m.test(content)) {
        // Use the new filename if it's being renamed, else current
        const targetFilename = pendingRenames.find((r) => r.oldFilename === filename)
          ? pendingRenames.find((r) => r.oldFilename === filename)!.newFilename
          : filename;
        headerRewrites.push({ filename: targetFilename, backendName });
      }
    }
  }

  // Execute header rewrites first (before renaming, since we read by old name)
  for (const rewrite of headerRewrites) {
    // Find the current filename on disk (before any renames)
    const pendingRename = pendingRenames.find((r) => r.newFilename === rewrite.filename);
    const currentFilename = pendingRename ? pendingRename.oldFilename : rewrite.filename;
    const filePath = path.join(tasksDir, currentFilename);

    const content = fs.readFileSync(filePath, "utf-8");
    const updated = rewriteSectionHeaders(content, rewrite.backendName);
    if (updated) {
      fs.writeFileSync(filePath, updated, "utf-8");
      result.headersRewritten++;
    }
  }

  // Execute renames + wikilink rewrites
  for (const rename of pendingRenames) {
    const oldPath = path.join(tasksDir, rename.oldFilename);
    const newPath = path.join(tasksDir, rename.newFilename);

    renameAndRewrite(oldPath, newPath, workspaceRoot);
    result.filesRenamed++;
    result.renames.push({ from: rename.oldFilename, to: rename.newFilename });
  }

  // Count wikilink rewrites (approximate — renameAndRewrite handles it)
  result.wikilinksRewritten = result.filesRenamed; // at least one rewrite per rename

  if (result.filesRenamed === 0 && result.headersRewritten === 0) {
    result.alreadyMigrated = true;
  }

  return result;
}
