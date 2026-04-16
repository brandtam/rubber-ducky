/**
 * Vault-wide file rename + wikilink rewrite primitives.
 *
 * Three public helpers:
 *   - `safeRename(oldPath, newPath)` — rename a single file, with a temp-name
 *     dance for case-only renames so case-insensitive filesystems (macOS APFS,
 *     Windows NTFS) actually update the stored casing.
 *   - `rewriteWikilinksForStems(vaultRoot, pairs)` — walk `wiki/**\/*.md` once
 *     and apply every `(oldStem → newStem)` substitution per file. Returns the
 *     number of files modified.
 *   - `renameAndRewrite(oldPath, newPath, vaultRoot)` — convenience that does
 *     both for a single pair.
 */

import * as fs from "node:fs";
import * as path from "node:path";

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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rename a file, handling case-only renames safely. Case-only renames are a
 * silent no-op on case-insensitive filesystems (macOS APFS default, Windows
 * NTFS) — route through a temp name so the filesystem actually updates the
 * stored casing.
 */
export function safeRename(oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  fs.mkdirSync(path.dirname(newPath), { recursive: true });

  if (
    path.dirname(oldPath) === path.dirname(newPath) &&
    oldPath.toLowerCase() === newPath.toLowerCase()
  ) {
    const temp = `${newPath}.__case_tmp_${process.pid}_${Date.now()}`;
    fs.renameSync(oldPath, temp);
    fs.renameSync(temp, newPath);
  } else {
    fs.renameSync(oldPath, newPath);
  }
}

/**
 * Rewrite `[[oldStem]]` and `[[oldStem|display]]` wikilinks across every
 * markdown file under `wiki/` to the corresponding `newStem`. Matching is
 * case-insensitive. Applies every `(oldStem → newStem)` pair in a single
 * pass per file. Returns the count of files modified.
 *
 * Per-file writes are NOT atomic (no temp-file + rename). A crash mid-write
 * can leave a single file truncated. This is a known gap — operation-level
 * resumability (merge-sentinel.ts) covers the broader case; per-file
 * atomicity is deferred to a follow-up issue.
 */
export function rewriteWikilinksForStems(
  vaultRoot: string,
  pairs: Array<{ oldStem: string; newStem: string }>
): number {
  const effective = pairs.filter((p) => p.oldStem !== p.newStem);
  if (effective.length === 0) return 0;

  const compiled = effective.map(({ oldStem, newStem }) => ({
    regex: new RegExp(`\\[\\[(${escapeRegex(oldStem)})(\\|[^\\]]*)?\\]\\]`, "gi"),
    newStem,
  }));

  const mdFiles = collectMdFiles(path.join(vaultRoot, "wiki"));
  let modifiedCount = 0;

  for (const filePath of mdFiles) {
    const original = fs.readFileSync(filePath, "utf-8");
    let updated = original;
    for (const { regex, newStem } of compiled) {
      regex.lastIndex = 0;
      updated = updated.replace(regex, (_m, _stem, pipe) => `[[${newStem}${pipe ?? ""}]]`);
    }
    if (updated !== original) {
      fs.writeFileSync(filePath, updated, "utf-8");
      modifiedCount++;
    }
  }

  return modifiedCount;
}

/**
 * Rename a file and rewrite its wikilinks across the vault in one step.
 * Thin wrapper over `safeRename` + `rewriteWikilinksForStems` for the
 * single-pair case. No-op if the old and new stems are identical.
 */
export function renameAndRewrite(
  oldPath: string,
  newPath: string,
  vaultRoot: string
): void {
  const oldStem = path.basename(oldPath, ".md");
  const newStem = path.basename(newPath, ".md");
  if (oldStem === newStem) return;

  if (fs.existsSync(oldPath)) {
    safeRename(oldPath, newPath);
  }
  rewriteWikilinksForStems(vaultRoot, [{ oldStem, newStem }]);
}
