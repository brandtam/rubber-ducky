import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { generateDailyPage, recordDailyTouch } from "./daily.js";

export interface PageResult {
  filePath: string;
  relativePath: string;
  pageType: string;
  created: boolean;
}

export interface PageGeneratorResult {
  filename: string;
  directory: string;
  content: string;
}

export interface CreatePageOptions {
  title?: string;
  date?: string;
  source?: string;
  ref?: string;
  project?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  vendor?: string;
  periodStart?: string;
  periodEnd?: string;
  repo?: string;
  changelogPath?: string;
  releaseReferencePattern?: string;
  defaultBranch?: string;
}

/**
 * Thrown by `createPage` when the target file already exists. Identity-based
 * (`instanceof PageExistsError`) so callers can map this specific failure to
 * the typed `StateConflict` exit code without parsing the message string.
 */
export class PageExistsError extends Error {
  readonly relativePath: string;

  constructor(relativePath: string) {
    super(`Page already exists: ${relativePath}`);
    this.name = "PageExistsError";
    this.relativePath = relativePath;
  }
}

/**
 * Convert a title to a filename-safe slug (lowercase kebab-case).
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generate a task page with correct frontmatter and body sections.
 */
export function generateTaskPage(
  title: string,
  opts?: { source?: string; ref?: string; project?: string }
): PageGeneratorResult {
  const now = new Date().toISOString();

  const frontmatter = {
    title,
    type: "task",
    ref: opts?.ref ?? null,
    source: opts?.source ?? null,
    project: opts?.project ?? null,
    status: "backlog",
    priority: null,
    assignee: null,
    tags: [],
    created: now,
    updated: now,
    closed: null,
    pushed: null,
    due: null,
    jira_ref: null,
    asana_ref: null,
    gh_ref: null,
    jira_needed: null,
    comment_count: 0,
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `## Description

## Context

## Comments

## Activity log

## See also
`;

  return {
    filename: `${slugify(title)}.md`,
    directory: "wiki/tasks",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Generate a meeting page with correct frontmatter and body sections.
 */
export function generateMeetingPage(
  title: string,
  opts?: {
    date?: string;
    start?: string;
    end?: string;
    attendees?: string[];
    project?: string;
  }
): PageGeneratorResult {
  const meetingDate = opts?.date ?? new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  const frontmatter = {
    title,
    type: "meeting",
    date: meetingDate,
    start: opts?.start ?? null,
    end: opts?.end ?? null,
    attendees: opts?.attendees ?? [],
    project: opts?.project ?? null,
    related: [],
    tags: [],
    created: now,
    updated: now,
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `## Agenda

## Notes

## Decisions

## Action items

## Related
`;

  return {
    filename: `${meetingDate}-${slugify(title)}.md`,
    directory: "wiki/meetings",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Generate a spike (investigation) page with correct frontmatter and body sections.
 */
export function generateSpikePage(
  title: string,
  opts?: { project?: string; vendor?: string }
): PageGeneratorResult {
  const now = new Date().toISOString();

  const frontmatter = {
    title,
    type: "spike",
    status: "open",
    verdict: null,
    vendor: opts?.vendor ?? null,
    project: opts?.project ?? null,
    related: [],
    tags: [],
    created: now,
    updated: now,
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `## Question

## Approach

## Findings

## Verdict

<!-- One-line summary that future-self reads first. Required when status: closed. -->

## Related
`;

  return {
    filename: `${slugify(title)}.md`,
    directory: "wiki/spikes",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Generate a project page with correct frontmatter and body sections.
 */
export function generateProjectPage(title: string): PageGeneratorResult {
  const now = new Date().toISOString();

  const frontmatter = {
    title,
    type: "project",
    created: now,
    updated: now,
    status: "backlog",
    tags: [],
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `## Description

## Tasks

## Notes
`;

  return {
    filename: `${slugify(title)}.md`,
    directory: "wiki/projects",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Generate a weekly summary page with correct frontmatter and body sections.
 *
 * The period_end (or `date` arg) doubles as the filename — every weekly
 * summary file is `wiki/weekly/<period_end>.md`. `period_start` defaults to
 * seven days before period_end when not provided, matching the
 * "last summary to this summary" convention the `/weekly-summary` skill
 * uses on a brand-new workspace.
 */
export function generateWeeklyPage(opts?: {
  date?: string;
  periodStart?: string;
  periodEnd?: string;
}): PageGeneratorResult {
  const today = new Date().toISOString().split("T")[0];
  const periodEnd = opts?.periodEnd ?? opts?.date ?? today;
  const periodStart =
    opts?.periodStart ??
    new Date(new Date(periodEnd).getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
  const now = new Date().toISOString();

  const frontmatter = {
    title: `Weekly Summary ${periodEnd}`,
    type: "weekly",
    created: now,
    updated: now,
    period_start: periodStart,
    period_end: periodEnd,
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `# Weekly Summary ${periodEnd}

_Period: ${periodStart} → ${periodEnd}_

## Completed & In Review since last summary

### Theme — Completed

### Theme — In Review

### Admin — Completed

## In Progress and Upcoming

### Theme — In Progress and Upcoming

### Admin — In Progress and Upcoming
`;

  return {
    filename: `${periodEnd}.md`,
    directory: "wiki/weekly",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Generate a repo page — a wiki anchor for a code repository the workspace
 * tracks releases for. Frontmatter captures the upstream `repo` (owner/repo
 * form), the `changelog_path` to read on `/release`, an optional
 * `release_reference_pattern` regex for pulling ticket refs out of changelog
 * entries, and the `default_branch` to fetch from. The `/release` skill
 * reads these on every invocation; values it doesn't find are gathered from
 * the user on first run and then persisted back to this page's frontmatter.
 */
export function generateRepoPage(
  title: string,
  opts?: {
    repo?: string;
    changelogPath?: string;
    releaseReferencePattern?: string;
    defaultBranch?: string;
  }
): PageGeneratorResult {
  const now = new Date().toISOString();

  const frontmatter = {
    title,
    type: "repo",
    repo: opts?.repo ?? null,
    changelog_path: opts?.changelogPath ?? "CHANGELOG.md",
    release_reference_pattern: opts?.releaseReferencePattern ?? null,
    default_branch: opts?.defaultBranch ?? "main",
    created: now,
    updated: now,
    tags: [],
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `## Description

## Releases
`;

  return {
    filename: `${slugify(title)}.md`,
    directory: "wiki/repos",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Create a page file on disk inside the workspace.
 * Throws if the file already exists (duplicate prevention).
 */
export function createPage(
  workspaceRoot: string,
  pageType: string,
  opts?: CreatePageOptions
): PageResult {
  let generated: PageGeneratorResult;

  switch (pageType) {
    case "daily":
      generated = generateDailyPage(opts?.date);
      break;
    case "task":
      if (!opts?.title) throw new Error("Title is required for task pages");
      generated = generateTaskPage(opts.title, {
        source: opts.source,
        ref: opts.ref,
        project: opts.project,
      });
      break;
    case "project":
      if (!opts?.title) throw new Error("Title is required for project pages");
      generated = generateProjectPage(opts.title);
      break;
    case "meeting":
      if (!opts?.title) throw new Error("Title is required for meeting pages");
      generated = generateMeetingPage(opts.title, {
        date: opts.date,
        start: opts.start,
        end: opts.end,
        attendees: opts.attendees,
        project: opts.project,
      });
      break;
    case "spike":
      if (!opts?.title) throw new Error("Title is required for spike pages");
      generated = generateSpikePage(opts.title, {
        project: opts.project,
        vendor: opts.vendor,
      });
      break;
    case "weekly":
      generated = generateWeeklyPage({
        date: opts?.date,
        periodStart: opts?.periodStart,
        periodEnd: opts?.periodEnd,
      });
      break;
    case "repo":
      if (!opts?.title) throw new Error("Title is required for repo pages");
      generated = generateRepoPage(opts.title, {
        repo: opts.repo,
        changelogPath: opts.changelogPath,
        releaseReferencePattern: opts.releaseReferencePattern,
        defaultBranch: opts.defaultBranch,
      });
      break;
    default:
      throw new Error(`Unknown page type: ${pageType}`);
  }

  const filePath = path.join(workspaceRoot, generated.directory, generated.filename);
  const relativePath = path.join(generated.directory, generated.filename);

  if (fs.existsSync(filePath)) {
    throw new PageExistsError(relativePath);
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, generated.content, "utf-8");

  // Record on the relevant daily page so the workspace's temporal spine
  // reflects what was created today (or on the meeting's date).
  if (pageType === "meeting") {
    const meetingDate = opts?.date ?? new Date().toISOString().split("T")[0];
    recordDailyTouch(workspaceRoot, "meetings_touched", relativePath, meetingDate);
  } else if (pageType === "spike") {
    recordDailyTouch(workspaceRoot, "spikes_touched", relativePath);
  }

  return {
    filePath,
    relativePath,
    pageType,
    created: true,
  };
}
