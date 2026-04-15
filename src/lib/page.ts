import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";

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
 * Slugify that preserves original casing.
 * Replaces non-alphanumeric runs with hyphens, strips leading/trailing hyphens.
 */
export function slugifyPreserveCase(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generate a daily page with correct frontmatter and body sections.
 */
export function generateDailyPage(date?: string): PageGeneratorResult {
  const pageDate = date ?? new Date().toISOString().split("T")[0];
  const now = new Date().toISOString();

  const frontmatter = {
    title: pageDate,
    type: "daily",
    created: now,
    updated: now,
    active_task: null,
    morning_brief: false,
    wrap_up: false,
    tasks_touched: [],
  };

  const yaml = yamlStringify(frontmatter).trimEnd();
  const body = `## Focus

## Work log

## Completed today

## Carried over

## Notes & context

## Blockers
`;

  return {
    filename: `${pageDate}.md`,
    directory: "wiki/daily",
    content: `---\n${yaml}\n---\n${body}`,
  };
}

/**
 * Generate a task page with correct frontmatter and body sections.
 */
export function generateTaskPage(
  title: string,
  opts?: { source?: string; ref?: string }
): PageGeneratorResult {
  const now = new Date().toISOString();

  const frontmatter = {
    title,
    type: "task",
    ref: opts?.ref ?? null,
    source: opts?.source ?? null,
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
      });
      break;
    case "project":
      if (!opts?.title) throw new Error("Title is required for project pages");
      generated = generateProjectPage(opts.title);
      break;
    default:
      throw new Error(`Unknown page type: ${pageType}`);
  }

  const filePath = path.join(workspaceRoot, generated.directory, generated.filename);
  const relativePath = path.join(generated.directory, generated.filename);

  if (fs.existsSync(filePath)) {
    throw new Error(`Page already exists: ${relativePath}`);
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, generated.content, "utf-8");

  return {
    filePath,
    relativePath,
    pageType,
    created: true,
  };
}
