import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface SearchMatch {
  relativePath: string;
  type: string;
  frontmatter: Record<string, unknown>;
  matchingLines: Array<{ lineNumber: number; text: string }>;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
  totalMatches: number;
}

export interface SearchOptions {
  type?: string;
  from?: string;
  to?: string;
}

export interface IndexResult {
  filePath: string;
  relativePath: string;
  totalPages: number;
  pages: {
    daily: number;
    task: number;
    project: number;
  };
}

export interface LogResult {
  filePath: string;
  relativePath: string;
  entry: string;
}

export interface StatusCheckResult {
  flag: string;
  date: string;
  flagSet: boolean;
  pageExists: boolean;
}

interface PageInfo {
  filePath: string;
  relativePath: string;
  type: string;
  data: Record<string, unknown>;
}

/**
 * Convert a kebab-case flag name to snake_case frontmatter field name.
 */
function flagToField(flag: string): string {
  return flag.replace(/-/g, "_");
}

/**
 * Scan all wiki pages and read their frontmatter.
 */
function scanPages(workspaceRoot: string): PageInfo[] {
  const pages: PageInfo[] = [];
  const wikiDir = path.join(workspaceRoot, "wiki");

  const dirs = [
    { dir: "daily", type: "daily" },
    { dir: "tasks", type: "task" },
    { dir: "projects", type: "project" },
  ];

  for (const { dir, type } of dirs) {
    const fullDir = path.join(wikiDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = parseFrontmatter(content);
      if (parsed) {
        pages.push({
          filePath,
          relativePath: path.join("wiki", dir, file),
          type,
          data: parsed.data,
        });
      }
    }
  }

  return pages;
}

/**
 * Regenerate wiki/index.md with correctly grouped tables.
 * Groups pages by status, project, and type.
 */
export function rebuildIndex(workspaceRoot: string): IndexResult {
  const pages = scanPages(workspaceRoot);

  const dailyPages = pages.filter((p) => p.type === "daily");
  const taskPages = pages.filter((p) => p.type === "task");
  const projectPages = pages.filter((p) => p.type === "project");

  // Sort daily pages reverse chronological
  dailyPages.sort((a, b) => {
    const titleA = String(a.data.title ?? "");
    const titleB = String(b.data.title ?? "");
    return titleB.localeCompare(titleA);
  });

  // Group tasks by status
  const tasksByStatus: Record<string, PageInfo[]> = {};
  for (const task of taskPages) {
    const status = String(task.data.status ?? "unknown");
    if (!tasksByStatus[status]) tasksByStatus[status] = [];
    tasksByStatus[status].push(task);
  }

  // Build index content
  const lines: string[] = [];
  lines.push("# Wiki Index");
  lines.push("");

  // Tasks by Status
  lines.push("## Tasks by Status");
  lines.push("");

  const statusOrder = [
    "in-progress", "in-review", "pending", "blocked",
    "to-do", "backlog", "done", "deferred",
  ];

  const sortedStatuses = Object.keys(tasksByStatus).sort((a, b) => {
    const idxA = statusOrder.indexOf(a);
    const idxB = statusOrder.indexOf(b);
    const posA = idxA === -1 ? statusOrder.length : idxA;
    const posB = idxB === -1 ? statusOrder.length : idxB;
    return posA - posB;
  });

  for (const status of sortedStatuses) {
    const tasks = tasksByStatus[status];
    lines.push(`### ${status}`);
    lines.push("");
    lines.push("| Title | Created | Due |");
    lines.push("|---|---|---|");
    for (const task of tasks) {
      const title = String(task.data.title ?? "Untitled");
      const created = task.data.created
        ? String(task.data.created).split("T")[0]
        : "\u2014";
      const due = task.data.due ? String(task.data.due) : "\u2014";
      lines.push(`| [[${task.relativePath}|${title}]] | ${created} | ${due} |`);
    }
    lines.push("");
  }

  if (sortedStatuses.length === 0) {
    lines.push("No tasks found.");
    lines.push("");
  }

  // Projects
  lines.push("## Projects");
  lines.push("");

  if (projectPages.length > 0) {
    lines.push("| Title | Status | Created |");
    lines.push("|---|---|---|");
    for (const project of projectPages) {
      const title = String(project.data.title ?? "Untitled");
      const status = String(project.data.status ?? "\u2014");
      const created = project.data.created
        ? String(project.data.created).split("T")[0]
        : "\u2014";
      lines.push(`| [[${project.relativePath}|${title}]] | ${status} | ${created} |`);
    }
  } else {
    lines.push("No projects found.");
  }
  lines.push("");

  // Daily Pages
  lines.push("## Daily Pages");
  lines.push("");

  if (dailyPages.length > 0) {
    lines.push("| Date | Morning Brief | Tasks Touched |");
    lines.push("|---|---|---|");
    for (const daily of dailyPages) {
      const title = String(daily.data.title ?? "Untitled");
      const morningBrief = daily.data.morning_brief ? "\u2713" : "\u2014";
      const tasksTouched = Array.isArray(daily.data.tasks_touched)
        ? String(daily.data.tasks_touched.length)
        : "\u2014";
      lines.push(
        `| [[${daily.relativePath}|${title}]] | ${morningBrief} | ${tasksTouched} |`
      );
    }
  } else {
    lines.push("No daily pages found.");
  }
  lines.push("");

  const content = lines.join("\n");
  const indexPath = path.join(workspaceRoot, "wiki", "index.md");

  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, content, "utf-8");

  return {
    filePath: indexPath,
    relativePath: "wiki/index.md",
    totalPages: pages.length,
    pages: {
      daily: dailyPages.length,
      task: taskPages.length,
      project: projectPages.length,
    },
  };
}

const LOG_HEADER = "# Log\n";

/**
 * Add a dated, timestamped entry to wiki/log.md.
 */
export function appendLog(workspaceRoot: string, message: string): LogResult {
  const logPath = path.join(workspaceRoot, "wiki", "log.md");
  const timestamp = new Date().toISOString();
  const entry = `${timestamp} \u2014 ${message}`;
  const line = `- ${entry}\n`;

  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, `${LOG_HEADER}\n${line}`, "utf-8");
  } else {
    fs.appendFileSync(logPath, line, "utf-8");
  }

  return {
    filePath: logPath,
    relativePath: "wiki/log.md",
    entry,
  };
}

/**
 * Check whether a flag is set on the daily page for a given date.
 * Converts kebab-case flags to snake_case for frontmatter lookup.
 */
export function checkStatusFlag(
  workspaceRoot: string,
  flag: string,
  date?: string
): StatusCheckResult {
  const checkDate = date ?? new Date().toISOString().split("T")[0];
  const fieldName = flagToField(flag);
  const dailyPath = path.join(workspaceRoot, "wiki", "daily", `${checkDate}.md`);

  if (!fs.existsSync(dailyPath)) {
    return {
      flag: fieldName,
      date: checkDate,
      flagSet: false,
      pageExists: false,
    };
  }

  const content = fs.readFileSync(dailyPath, "utf-8");
  const parsed = parseFrontmatter(content);

  if (!parsed) {
    return {
      flag: fieldName,
      date: checkDate,
      flagSet: false,
      pageExists: true,
    };
  }

  const value = parsed.data[fieldName];
  const flagSet = Boolean(value);

  return {
    flag: fieldName,
    date: checkDate,
    flagSet,
    pageExists: true,
  };
}

/**
 * Search across all wiki pages for a keyword query.
 * Returns matching pages with frontmatter metadata and matching lines.
 *
 * Supports filtering by page type and date range (daily pages only for date filters).
 */
export function searchWiki(
  workspaceRoot: string,
  query: string,
  options?: SearchOptions
): SearchResult {
  const matches: SearchMatch[] = [];
  const queryLower = query.toLowerCase();
  const wikiDir = path.join(workspaceRoot, "wiki");

  // Collect all candidate files
  const candidates: Array<{ filePath: string; relativePath: string; type: string }> = [];

  const dirs = [
    { dir: "daily", type: "daily" },
    { dir: "tasks", type: "task" },
    { dir: "projects", type: "project" },
  ];

  for (const { dir, type } of dirs) {
    if (options?.type && options.type !== type) continue;

    const fullDir = path.join(wikiDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      candidates.push({
        filePath: path.join(fullDir, file),
        relativePath: path.join("wiki", dir, file),
        type,
      });
    }
  }

  // Also search log.md if no type filter or explicitly requested
  if (!options?.type) {
    const logPath = path.join(wikiDir, "log.md");
    if (fs.existsSync(logPath)) {
      candidates.push({
        filePath: logPath,
        relativePath: "wiki/log.md",
        type: "log",
      });
    }
  }

  for (const candidate of candidates) {
    const content = fs.readFileSync(candidate.filePath, "utf-8");
    const parsed = parseFrontmatter(content);
    const frontmatter = parsed?.data ?? {};

    // Apply date range filter for daily pages
    if (candidate.type === "daily" && (options?.from || options?.to)) {
      const dateStr = String(frontmatter.title ?? "");
      if (options?.from && dateStr < options.from) continue;
      if (options?.to && dateStr > options.to) continue;
    }

    // Search all lines of the file content for the query
    const lines = content.split("\n");
    const matchingLines: Array<{ lineNumber: number; text: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        matchingLines.push({ lineNumber: i + 1, text: lines[i] });
      }
    }

    if (matchingLines.length > 0) {
      matches.push({
        relativePath: candidate.relativePath,
        type: candidate.type,
        frontmatter,
        matchingLines,
      });
    }
  }

  return {
    query,
    matches,
    totalMatches: matches.length,
  };
}
