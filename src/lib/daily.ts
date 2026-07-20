import * as fs from "node:fs";
import * as path from "node:path";
import { stringify as yamlStringify } from "yaml";
import { parseFrontmatter, setFrontmatterField } from "./frontmatter.js";
import type { PageGeneratorResult } from "./page.js";

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
    projects_touched: [],
    meetings_touched: [],
    spikes_touched: [],
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
 * Ensure a daily page exists for the given date, creating it if needed.
 * Returns the relative path (e.g. "wiki/daily/2026-05-08.md").
 */
export function ensureDailyPage(workspaceRoot: string, date: string): string {
  const relativePath = `wiki/daily/${date}.md`;
  const fullPath = path.join(workspaceRoot, relativePath);

  if (!fs.existsSync(fullPath)) {
    const generated = generateDailyPage(date);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, generated.content, "utf-8");
  }

  return relativePath;
}

/**
 * Append a string value to a frontmatter array on a daily page, deduplicating.
 * No-op when value is missing, non-string, or empty.
 */
export function appendUniqueToFrontmatterArray(
  workspaceRoot: string,
  dailyFile: string,
  field: string,
  value: unknown
): void {
  if (typeof value !== "string" || value.length === 0) return;

  const fullPath = path.join(workspaceRoot, dailyFile);
  let content = fs.readFileSync(fullPath, "utf-8");
  const parsed = parseFrontmatter(content);
  if (!parsed) return;

  const existing = Array.isArray(parsed.data[field])
    ? [...(parsed.data[field] as string[])]
    : [];

  if (existing.includes(value)) return;

  existing.push(value);
  content = setFrontmatterField(content, field, existing);
  fs.writeFileSync(fullPath, content, "utf-8");
}

/**
 * Record a touch on a daily page: ensure the daily page exists for `date`
 * (default: today) and append `value` to its `<field>` array, deduplicating.
 * No-op when value is missing or non-string.
 */
export function recordDailyTouch(
  workspaceRoot: string,
  field: string,
  value: unknown,
  date?: string
): void {
  if (typeof value !== "string" || value.length === 0) return;

  const touchDate = date ?? new Date().toISOString().split("T")[0];
  const dailyFile = ensureDailyPage(workspaceRoot, touchDate);
  appendUniqueToFrontmatterArray(workspaceRoot, dailyFile, field, value);
}
