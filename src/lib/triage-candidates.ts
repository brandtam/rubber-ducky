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

const JIRA_KEY_REGEX = /\b[A-Za-z][A-Za-z0-9]+-\d+\b/g;
const SECTION_HEADER_REGEX = /^## (.+)$/gm;

/** Location priority order for deduplication (lower index = higher priority). */
const LOCATION_PRIORITY: JiraCandidate["location"][] = [
  "description",
  "comments",
  "activity log",
];

interface SectionBoundary {
  offset: number;
  location: JiraCandidate["location"];
}

/**
 * Compute section boundaries once, so per-match classification is an O(log n)
 * binary search instead of re-scanning headers from the start of the body.
 */
function computeSectionBoundaries(body: string): SectionBoundary[] {
  const boundaries: SectionBoundary[] = [];
  for (const match of body.matchAll(SECTION_HEADER_REGEX)) {
    const header = match[1].toLowerCase();
    let location: JiraCandidate["location"] = "description";
    if (header.includes("comment")) location = "comments";
    else if (header.includes("activity")) location = "activity log";
    boundaries.push({ offset: match.index!, location });
  }
  return boundaries;
}

function locateMatch(
  boundaries: SectionBoundary[],
  matchIndex: number
): JiraCandidate["location"] {
  let lo = 0;
  let hi = boundaries.length - 1;
  let result: JiraCandidate["location"] = "description";
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (boundaries[mid].offset <= matchIndex) {
      result = boundaries[mid].location;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
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

  const boundaries = computeSectionBoundaries(body);
  const mentionMap = new Map<string, JiraCandidate["location"]>();

  for (const match of body.matchAll(JIRA_KEY_REGEX)) {
    const key = match[0].toUpperCase();
    if (!vaultJiraKeys.has(key)) continue;

    const location = locateMatch(boundaries, match.index!);
    const existing = mentionMap.get(key);
    if (existing == null || LOCATION_PRIORITY.indexOf(location) < LOCATION_PRIORITY.indexOf(existing)) {
      mentionMap.set(key, location);
    }
  }

  return [...mentionMap].map(([jiraKey, location]) => ({ jiraKey, location }));
}
