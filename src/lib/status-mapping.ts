/**
 * Parser for wiki/status-mapping.md — the workspace-scoped config that maps
 * backend-native status values to the canonical wiki vocabulary.
 *
 * File format: plain markdown with `## <Backend> → wiki` sections containing
 * bullet lines of the form `- \`<raw>\` → \`<canonical>\``. Renders in
 * Obsidian, editable as normal markdown.
 *
 * Public interface:
 *   loadMapping(workspaceRoot) — read + parse the file
 *   translateStatus(mapping, backend, rawValue) — bidirectional lookup
 *   parseStatusMapping(content) — pure parse (no I/O)
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Mapping from lowercase raw backend values to canonical wiki values,
 * keyed by lowercase backend name.
 */
export type StatusMapping = Record<string, Record<string, string>>;

// Matches section headers like "## Jira → wiki" or "## Asana -> wiki"
const SECTION_RE = /^##\s+(\S+)\s*(?:→|->)\s*wiki\s*$/i;

// Matches bullet lines like "- `In Progress` → `in-progress`"
// Permissive on whitespace, supports both → and ->
const BULLET_RE = /^-\s*`([^`]*)`\s*(?:→|->)\s*`([^`]*)`\s*$/;

/**
 * Parse the content of a status-mapping.md file into a StatusMapping.
 * Permissive on whitespace, section ordering, and malformed lines (skipped).
 */
export function parseStatusMapping(content: string): StatusMapping {
  const mapping: StatusMapping = {};
  let currentBackend: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    const sectionMatch = trimmed.match(SECTION_RE);
    if (sectionMatch) {
      currentBackend = sectionMatch[1].toLowerCase();
      if (!mapping[currentBackend]) mapping[currentBackend] = {};
      continue;
    }

    // A non-backend `## heading` closes the current backend section
    // (e.g. "## Wiki vocabulary").
    if (/^##\s/.test(trimmed)) {
      currentBackend = null;
      continue;
    }

    if (currentBackend) {
      const bulletMatch = trimmed.match(BULLET_RE);
      if (bulletMatch) {
        const rawValue = bulletMatch[1].trim().toLowerCase();
        const canonicalValue = bulletMatch[2].trim().toLowerCase();
        mapping[currentBackend][rawValue] = canonicalValue;
      }
    }
  }

  return mapping;
}

/**
 * Translate a status value using the mapping.
 *
 * Direction "forward" (default): raw backend value → canonical wiki value
 * Direction "reverse": canonical wiki value → itself (confirming it exists
 * in the backend's mapping as a target value)
 *
 * Returns null for unknown values or unknown backends.
 */
export function translateStatus(
  mapping: StatusMapping,
  backend: string,
  rawValue: string,
  direction: "forward" | "reverse" = "forward",
): string | null {
  const backendMap = mapping[backend.toLowerCase()];
  if (!backendMap) return null;

  const normalized = rawValue.toLowerCase().trim();
  if (!normalized) return null;

  if (direction === "forward") {
    return backendMap[normalized] ?? null;
  }

  // Reverse: find if the canonical value exists as a target
  for (const [, canonical] of Object.entries(backendMap)) {
    if (canonical === normalized) {
      return canonical;
    }
  }

  return null;
}

/**
 * Load and parse the status mapping from a workspace root.
 * Returns an empty mapping if the file does not exist.
 */
export function loadMapping(workspaceRoot: string): StatusMapping {
  const filePath = path.join(workspaceRoot, "wiki", "status-mapping.md");

  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return parseStatusMapping(content);
}
