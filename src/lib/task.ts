import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter, setFrontmatterField } from "./frontmatter.js";
import { createPage } from "./page.js";
import { appendLog } from "./wiki.js";

export interface StartTaskResult {
  taskFile: string;
  taskTitle: string;
  previousStatus: string;
  newStatus: string;
  dailyFile: string;
  activityEntry: string;
}

export interface CloseTaskResult {
  taskFile: string;
  taskTitle: string;
  previousStatus: string;
  newStatus: string;
  closedDate: string;
  dailyFile: string;
  activityEntry: string;
  logEntry: string;
  clearedActiveTask: boolean;
}

/**
 * Append a line of text under a markdown ## section heading.
 * Inserts before the next ## heading, or at end of file if the section is last.
 */
export function appendToSection(
  content: string,
  sectionName: string,
  text: string
): string {
  const sectionPattern = new RegExp(`^## ${escapeRegex(sectionName)}[ \\t]*$`, "m");
  const match = content.match(sectionPattern);

  if (!match || match.index === undefined) {
    throw new Error(`Section "## ${sectionName}" not found in content`);
  }

  const sectionStart = match.index + match[0].length;

  // Find the next ## heading after this section
  const nextSectionPattern = /^## /m;
  const afterSection = content.slice(sectionStart);
  const nextMatch = afterSection.match(nextSectionPattern);

  if (nextMatch && nextMatch.index !== undefined) {
    // Insert before the next section
    const insertPoint = sectionStart + nextMatch.index;
    const beforeNext = content.slice(sectionStart, insertPoint);

    // Find the last non-whitespace content in the section
    const trimmed = beforeNext.trimEnd();
    if (trimmed.length === 0) {
      // Empty section — add blank line then text
      return (
        content.slice(0, sectionStart) +
        "\n\n" +
        text +
        "\n\n" +
        content.slice(insertPoint)
      );
    } else {
      // Has existing content — append after it
      const contentEnd = sectionStart + beforeNext.lastIndexOf(trimmed.split("\n").pop()!) +
        trimmed.split("\n").pop()!.length;
      return (
        content.slice(0, contentEnd) +
        "\n" +
        text +
        "\n\n" +
        content.slice(insertPoint)
      );
    }
  } else {
    // Last section — append at end
    const trimmedEnd = content.trimEnd();
    if (trimmedEnd.endsWith(match[0].trim())) {
      // Empty last section
      return trimmedEnd + "\n\n" + text + "\n";
    } else {
      // Has content
      return trimmedEnd + "\n" + text + "\n";
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ensure a daily page exists for the given date, creating it if needed.
 * Returns the relative path to the daily page.
 */
function ensureDailyPage(workspaceRoot: string, date: string): string {
  const relativePath = `wiki/daily/${date}.md`;
  const fullPath = path.join(workspaceRoot, relativePath);

  if (!fs.existsSync(fullPath)) {
    createPage(workspaceRoot, "daily", { date });
  }

  return relativePath;
}

/**
 * Read and validate a task file. Returns its parsed content and metadata.
 */
function readTaskFile(
  workspaceRoot: string,
  taskFile: string
): { content: string; data: Record<string, unknown>; body: string; fullPath: string } {
  const fullPath = path.join(workspaceRoot, taskFile);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Task file not found: ${taskFile}`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const parsed = parseFrontmatter(content);

  if (!parsed) {
    throw new Error(`No frontmatter found in ${taskFile}`);
  }

  if (parsed.data.type !== "task") {
    throw new Error(`${taskFile} is not a task page (type: ${parsed.data.type})`);
  }

  return { content, data: parsed.data, body: parsed.body, fullPath };
}

/**
 * Add a task to the daily page's tasks_touched array (deduplicating).
 */
function addToTasksTouched(workspaceRoot: string, dailyFile: string, taskFile: string): void {
  const fullPath = path.join(workspaceRoot, dailyFile);
  let content = fs.readFileSync(fullPath, "utf-8");
  const parsed = parseFrontmatter(content);

  if (!parsed) return;

  const touched = Array.isArray(parsed.data.tasks_touched)
    ? [...(parsed.data.tasks_touched as string[])]
    : [];

  if (!touched.includes(taskFile)) {
    touched.push(taskFile);
    content = setFrontmatterField(content, "tasks_touched", touched);
    fs.writeFileSync(fullPath, content, "utf-8");
  }
}

/**
 * Start a task: set status to in-progress, update daily page, add activity log.
 */
export function startTask(
  workspaceRoot: string,
  taskFile: string,
  date?: string
): StartTaskResult {
  const taskDate = date ?? new Date().toISOString().split("T")[0];

  // Read and validate the task
  const task = readTaskFile(workspaceRoot, taskFile);
  const previousStatus = String(task.data.status ?? "backlog");
  const taskTitle = String(task.data.title ?? "Untitled");

  // Update task: status, updated timestamp, activity log
  let taskContent = task.content;
  taskContent = setFrontmatterField(taskContent, "status", "in-progress");
  taskContent = setFrontmatterField(taskContent, "updated", new Date().toISOString());
  const activityEntry = `- Started on ${taskDate}`;
  taskContent = appendToSection(taskContent, "Activity log", activityEntry);
  fs.writeFileSync(task.fullPath, taskContent, "utf-8");

  // Ensure daily page exists
  const dailyFile = ensureDailyPage(workspaceRoot, taskDate);

  // Update daily page: active_task
  const dailyPath = path.join(workspaceRoot, dailyFile);
  let dailyContent = fs.readFileSync(dailyPath, "utf-8");
  dailyContent = setFrontmatterField(dailyContent, "active_task", taskFile);
  fs.writeFileSync(dailyPath, dailyContent, "utf-8");

  // Add to tasks_touched
  addToTasksTouched(workspaceRoot, dailyFile, taskFile);

  return {
    taskFile,
    taskTitle,
    previousStatus,
    newStatus: "in-progress",
    dailyFile,
    activityEntry,
  };
}

/**
 * Close a task: set status to done, set closed date, update daily page, append to log.
 */
export function closeTask(
  workspaceRoot: string,
  taskFile: string,
  date?: string
): CloseTaskResult {
  const taskDate = date ?? new Date().toISOString().split("T")[0];

  // Read and validate the task
  const task = readTaskFile(workspaceRoot, taskFile);
  const previousStatus = String(task.data.status ?? "backlog");
  const taskTitle = String(task.data.title ?? "Untitled");

  // Update task: status, closed date, updated timestamp, activity log
  let taskContent = task.content;
  taskContent = setFrontmatterField(taskContent, "status", "done");
  taskContent = setFrontmatterField(taskContent, "closed", taskDate);
  taskContent = setFrontmatterField(taskContent, "updated", new Date().toISOString());
  const activityEntry = `- Closed on ${taskDate}`;
  taskContent = appendToSection(taskContent, "Activity log", activityEntry);
  fs.writeFileSync(task.fullPath, taskContent, "utf-8");

  // Ensure daily page exists
  const dailyFile = ensureDailyPage(workspaceRoot, taskDate);

  // Check and clear active_task if it points to this task
  const dailyPath = path.join(workspaceRoot, dailyFile);
  let dailyContent = fs.readFileSync(dailyPath, "utf-8");
  const dailyParsed = parseFrontmatter(dailyContent);
  let clearedActiveTask = false;

  if (dailyParsed && dailyParsed.data.active_task === taskFile) {
    dailyContent = setFrontmatterField(dailyContent, "active_task", null);
    clearedActiveTask = true;
    fs.writeFileSync(dailyPath, dailyContent, "utf-8");
  }

  // Add to completed-today section on daily page
  dailyContent = fs.readFileSync(dailyPath, "utf-8");
  const completedEntry = `- [[${taskFile}|${taskTitle}]]`;
  dailyContent = appendToSection(dailyContent, "Completed today", completedEntry);
  fs.writeFileSync(dailyPath, dailyContent, "utf-8");

  // Add to tasks_touched
  addToTasksTouched(workspaceRoot, dailyFile, taskFile);

  // Append to wiki/log.md
  const logResult = appendLog(workspaceRoot, `Closed task: ${taskTitle}`);

  return {
    taskFile,
    taskTitle,
    previousStatus,
    newStatus: "done",
    closedDate: taskDate,
    dailyFile,
    activityEntry,
    logEntry: logResult.entry,
    clearedActiveTask,
  };
}
