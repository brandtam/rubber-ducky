/**
 * Pure frontmatter merge for Asana + Jira task pages.
 *
 * `mergeFrontmatter(asana, jira, resolutions?)` returns the merged
 * frontmatter fields plus a list of conflicts. Conflicts are reported
 * for fields where both backends have differing non-null values and
 * no resolution override was provided.
 *
 * Raw per-backend values (asana_status_raw, jira_status_raw) are always
 * preserved regardless of conflict resolution.
 */

import type { TaskPage, Status } from "./backend.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergeConflict {
  field: string;
  asanaValue: unknown;
  jiraValue: unknown;
}

export interface MergeResolutions {
  status?: Status;
  priority?: string;
  assignee?: string;
  due?: string;
}

export interface MergeFrontmatterResult {
  merged: TaskPage;
  conflicts: MergeConflict[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fields that can conflict between the two backends. */
const CONFLICTABLE_FIELDS: Array<keyof MergeResolutions> = [
  "status",
  "priority",
  "assignee",
  "due",
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge frontmatter from an Asana page and a Jira page into one
 * canonical merged TaskPage. Asana is the primary identity.
 *
 * When both backends have differing non-null values for a conflictable
 * field and no resolution is provided, a MergeConflict is emitted.
 * When a resolution IS provided, the resolved value is used and no
 * conflict is emitted.
 */
export function mergeFrontmatter(
  asana: TaskPage,
  jira: TaskPage,
  resolutions?: MergeResolutions
): MergeFrontmatterResult {
  const conflicts: MergeConflict[] = [];

  // Resolve conflictable fields
  const resolved: Record<string, unknown> = {};
  for (const field of CONFLICTABLE_FIELDS) {
    const aVal = asana[field];
    const jVal = jira[field];

    if (resolutions && resolutions[field] !== undefined) {
      resolved[field] = resolutions[field];
    } else if (aVal != null && jVal != null && aVal !== jVal) {
      conflicts.push({ field, asanaValue: aVal, jiraValue: jVal });
      // Default to Asana value when unresolved
      resolved[field] = aVal;
    } else {
      // Use whichever is non-null, or Asana if both null
      resolved[field] = aVal ?? jVal;
    }
  }

  // Tags: union, deduped
  const tagSet = new Set([...asana.tags, ...jira.tags]);

  // Dates: earliest created, latest updated
  const created =
    asana.created <= jira.created ? asana.created : jira.created;
  const updated =
    asana.updated >= jira.updated ? asana.updated : jira.updated;

  // Closed: use whichever is set (prefer non-null)
  const closed = asana.closed ?? jira.closed;

  // Pushed: use whichever is set
  const pushed = asana.pushed ?? jira.pushed;

  // gh_ref: use whichever is set
  const gh_ref = asana.gh_ref ?? jira.gh_ref;

  const merged: TaskPage = {
    // Asana is primary identity
    title: asana.title,
    source: "asana",
    ref: asana.ref,
    asana_ref: asana.asana_ref,
    jira_ref: jira.jira_ref,
    jira_needed: "yes",
    gh_ref,

    // Resolved fields
    status: resolved.status as Status,
    priority: (resolved.priority as string) ?? null,
    assignee: (resolved.assignee as string) ?? null,
    due: (resolved.due as string) ?? null,

    // Union
    tags: [...tagSet],

    // Timestamps
    created,
    updated,
    closed,
    pushed,

    // Raw values always preserved
    asana_status_raw: asana.asana_status_raw,
    jira_status_raw: jira.jira_status_raw,

    // Sum comment counts
    comment_count: asana.comment_count + jira.comment_count,

    // Body fields — not used by frontmatter merge (body-merge handles these)
    description: asana.description,
    comments: asana.comments,
  };

  return { merged, conflicts };
}
