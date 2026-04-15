/**
 * Vault-wide file rename + wikilink rewrite.
 *
 * Exposes `renameAndRewrite(oldPath, newPath, vaultRoot)` which:
 * 1. Renames a file from oldPath to newPath
 * 2. Rewrites all [[wikilinks]] across wiki/**\/*.md that reference the
 *    old filename stem to the new filename stem
 *
 * Used by `rubber-ducky migrate` and the future merge primitive.
 */

import * as fs from "node:fs";
import * as path from "node:path";

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

/**
 * Rename a file and rewrite all [[wikilinks]] across `wiki/**\/*.md`
 * that reference the old filename to the new filename.
 *
 * Wikilink matching is case-insensitive to handle vaults where links
 * were written with inconsistent casing.
 *
 * No-op if oldPath === newPath.
 */
export function renameAndRewrite(
  oldPath: string,
  newPath: string,
  vaultRoot: string
): void {
  const oldStem = path.basename(oldPath, ".md");
  const newStem = path.basename(newPath, ".md");

  // No-op when names are identical
  if (oldStem === newStem) return;

  // Rename the file
  if (oldPath !== newPath && fs.existsSync(oldPath)) {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    // Case-only renames are a silent no-op on case-insensitive filesystems
    // (macOS APFS default, Windows NTFS). Route through a temp name so the
    // filesystem actually updates the stored casing.
    if (
      path.dirname(oldPath) === path.dirname(newPath) &&
      oldPath !== newPath &&
      oldPath.toLowerCase() === newPath.toLowerCase()
    ) {
      const temp = `${newPath}.__case_tmp_${process.pid}_${Date.now()}`;
      fs.renameSync(oldPath, temp);
      fs.renameSync(temp, newPath);
    } else {
      fs.renameSync(oldPath, newPath);
    }
  }

  // Build a regex that matches [[oldStem]] or [[oldStem|display text]]
  // Case-insensitive so [[Ecomm-123]] and [[ecomm-123]] both match
  const escaped = oldStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wikilinkRegex = new RegExp(
    `\\[\\[(${escaped})(\\|[^\\]]*)?\\]\\]`,
    "gi"
  );

  // Rewrite wikilinks across all .md files under wiki/
  const wikiDir = path.join(vaultRoot, "wiki");
  const mdFiles = collectMdFiles(wikiDir);

  for (const filePath of mdFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    if (!wikilinkRegex.test(content)) continue;

    // Reset lastIndex after test()
    wikilinkRegex.lastIndex = 0;
    const updated = content.replace(wikilinkRegex, (_match, _stem, pipe) => {
      return `[[${newStem}${pipe ?? ""}]]`;
    });

    if (updated !== content) {
      fs.writeFileSync(filePath, updated, "utf-8");
    }
  }
}
