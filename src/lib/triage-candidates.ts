/**
 * Triage candidate detection: scans an Asana page body for Jira-style
 * ticket key mentions (e.g. WEB-297, PROJ-55) and intersects with
 * existing Jira pages in the vault.
 *
 * Public API: `findJiraCandidates(asanaPagePath, vaultRoot)`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraCandidate {
  /** Uppercase Jira key, e.g. "WEB-297" */
  jiraKey: string;
  /** Where the mention was found: "description", "comments", or "activity log" */
  location: "description" | "comments" | "activity log";
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Jira key pattern: one or more uppercase letters, a dash, then one or
 * more digits. Case-insensitive matching — we uppercase the result.
 */
const JIRA_KEY_REGEX = /\b([A-Z][A-Z0-9]+-\d+)\b/gi;

/** Location priority order for deduplication (lower index = higher priority). */
const LOCATION_PRIORITY: JiraCandidate["location"][] = [
  "description",
  "comments",
  "activity log",
];

/**
 * Determine which section of the page body a given offset falls into
 * by scanning for `## <section>` headers.
 */
function classifyLocation(
  body: string,
  matchIndex: number
): JiraCandidate["location"] {
  // Walk backward from matchIndex to find the most recent ## header
  const before = body.slice(0, matchIndex);
  const headers = [...before.matchAll(/^## (.+)$/gm)];
  if (headers.length === 0) return "description";

  const lastHeader = headers[headers.length - 1][1].toLowerCase();
  if (lastHeader.includes("comment")) return "comments";
  if (lastHeader.includes("activity")) return "activity log";
  if (lastHeader.includes("description")) return "description";
  // Default: if we're in an unknown section, treat as description
  return "description";
}

/**
 * Collect the set of Jira-style filenames present in wiki/tasks/.
 * Returns a Set of uppercase stems (e.g. "WEB-297").
 */
function collectJiraStemsInVault(vaultRoot: string): Set<string> {
  const tasksDir = path.join(vaultRoot, "wiki", "tasks");
  if (!fs.existsSync(tasksDir)) return new Set();

  const stems = new Set<string>();
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const stem = file.replace(/\.md$/, "").toUpperCase();
    // Only include files that look like Jira keys (LETTERS-DIGITS)
    if (/^[A-Z][A-Z0-9]+-\d+$/.test(stem)) {
      stems.add(stem);
    }
  }
  return stems;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan an Asana page's body for Jira key mentions and intersect with
 * Jira pages present in the vault.
 *
 * Returns ranked candidates — deduplicated by key, with the
 * highest-priority location (description > comments > activity log).
 */
export function findJiraCandidates(
  asanaPagePath: string,
  vaultRoot: string
): JiraCandidate[] {
  const content = fs.readFileSync(asanaPagePath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) return [];

  const body = parsed.body;
  const vaultJiraKeys = collectJiraStemsInVault(vaultRoot);
  if (vaultJiraKeys.size === 0) return [];

  // Collect all mentions with their locations
  const mentionMap = new Map<string, JiraCandidate["location"]>();

  for (const match of body.matchAll(JIRA_KEY_REGEX)) {
    const key = match[0].toUpperCase();
    if (!vaultJiraKeys.has(key)) continue;

    const location = classifyLocation(body, match.index!);

    // Keep the highest-priority location
    const existing = mentionMap.get(key);
    if (
      existing == null ||
      LOCATION_PRIORITY.indexOf(location) <
        LOCATION_PRIORITY.indexOf(existing)
    ) {
      mentionMap.set(key, location);
    }
  }

  // Convert to array
  const candidates: JiraCandidate[] = [];
  for (const [jiraKey, location] of mentionMap) {
    candidates.push({ jiraKey, location });
  }

  return candidates;
}
