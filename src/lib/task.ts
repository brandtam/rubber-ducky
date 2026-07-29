import * as fs from "node:fs";
import * as path from "node:path";
import {
  addToFrontmatterArray,
  parseFrontmatter,
  setFrontmatterField,
  validateFrontmatter,
  type ValidationError,
} from "./frontmatter.js";
import { writeFileAtomic } from "./fs-atomic.js";
import { resolveInsideWorkspace } from "./paths.js";
import { appendUniqueToFrontmatterArray, ensureDailyPage } from "./daily.js";
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
 * Read and validate a task file. Returns its parsed content and metadata.
 */
function readTaskFile(
  workspaceRoot: string,
  taskFile: string
): { content: string; data: Record<string, unknown>; body: string; fullPath: string } {
  // Confinement: taskFile is user/agent-supplied — resolve it and require
  // the result inside the workspace root (rejects ../../escape.md).
  const fullPath = resolveInsideWorkspace(workspaceRoot, taskFile);

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
  writeFileAtomic(task.fullPath, taskContent);

  // Ensure daily page exists
  const dailyFile = ensureDailyPage(workspaceRoot, taskDate);

  // Update daily page: active_task
  const dailyPath = path.join(workspaceRoot, dailyFile);
  let dailyContent = fs.readFileSync(dailyPath, "utf-8");
  dailyContent = setFrontmatterField(dailyContent, "active_task", taskFile);
  writeFileAtomic(dailyPath, dailyContent);

  appendUniqueToFrontmatterArray(workspaceRoot, dailyFile, "tasks_touched", taskFile);
  appendUniqueToFrontmatterArray(workspaceRoot, dailyFile, "projects_touched", task.data.project);

  return {
    taskFile,
    taskTitle,
    previousStatus,
    newStatus: "in-progress",
    dailyFile,
    activityEntry,
  };
}

export interface StampWriteOptions {
  /** Scalar frontmatter fields to set, e.g. { source: "github", ref: "o/r#7" }. */
  set?: Record<string, unknown>;
  /** Values appended (deduplicated) to the `tags` array. */
  tags?: string[];
  /** New status. `"done"` delegates to the full closeTask flow. */
  status?: string;
  /** Increment `comment_count` by this many (default 0). */
  bumpComments?: number;
  /** Stamp `pushed` with the current ISO timestamp. */
  pushed?: boolean;
  /** Line appended to `## Activity log` (without the leading `- `). */
  activity?: string;
  /** Message appended to wiki/log.md. */
  log?: string;
  /** Run frontmatter validation (type: task) after stamping. */
  validate?: boolean;
  /** Date for the daily page when status is "done" (defaults to today). */
  date?: string;
}

export interface StampWriteResult {
  taskFile: string;
  taskTitle: string;
  fieldsSet: string[];
  tagsAdded: string[];
  newStatus: string | null;
  closed: boolean;
  activityEntry: string | null;
  logEntry: string | null;
  validationErrors: ValidationError[] | null;
}

/**
 * Composite post-write stamp: the mechanical wiki bookkeeping that follows a
 * successful external write (or an ingest), in ONE invocation instead of
 * 4–6. Purely structural — no judgment, no normalization: values land
 * exactly as passed (the calling skill owns mapping/normalization, per
 * docs/adr/drift-pure-structural-diff.md).
 *
 * Always stamps `updated`. `status: "done"` delegates to {@link closeTask}
 * so the daily page and log keep their close semantics.
 */
export function stampWrite(
  workspaceRoot: string,
  taskFile: string,
  opts: StampWriteOptions
): StampWriteResult {
  const task = readTaskFile(workspaceRoot, taskFile);
  const taskTitle = String(task.data.title ?? "Untitled");
  const now = new Date().toISOString();

  const fieldsSet: string[] = [];
  let content = task.content;

  for (const [field, value] of Object.entries(opts.set ?? {})) {
    content = setFrontmatterField(content, field, value);
    fieldsSet.push(field);
  }

  const tagsAdded: string[] = [];
  for (const tag of opts.tags ?? []) {
    const next = addToFrontmatterArray(content, "tags", tag);
    if (next !== content) tagsAdded.push(tag);
    content = next;
  }

  if (opts.bumpComments && opts.bumpComments > 0) {
    const current = typeof task.data.comment_count === "number" ? task.data.comment_count : 0;
    content = setFrontmatterField(content, "comment_count", current + opts.bumpComments);
    fieldsSet.push("comment_count");
  }

  if (opts.pushed) {
    content = setFrontmatterField(content, "pushed", now);
    fieldsSet.push("pushed");
  }

  const closing = opts.status === "done";
  let newStatus: string | null = opts.status ?? null;
  if (opts.status !== undefined && !closing) {
    content = setFrontmatterField(content, "status", opts.status);
    fieldsSet.push("status");
  }

  content = setFrontmatterField(content, "updated", now);

  let activityEntry: string | null = null;
  if (opts.activity) {
    activityEntry = `- ${opts.activity}`;
    content = appendToSection(content, "Activity log", activityEntry);
  }

  writeFileAtomic(task.fullPath, content);

  if (closing) {
    // Full close flow: daily page bookkeeping + log line, on the already
    // stamped file.
    closeTask(workspaceRoot, taskFile, opts.date);
    newStatus = "done";
  }

  let logEntry: string | null = null;
  if (opts.log) {
    logEntry = appendLog(workspaceRoot, opts.log).entry;
  }

  let validationErrors: ValidationError[] | null = null;
  if (opts.validate) {
    const parsed = parseFrontmatter(fs.readFileSync(task.fullPath, "utf-8"));
    validationErrors = parsed ? validateFrontmatter(parsed.data, "task") : [];
  }

  return {
    taskFile,
    taskTitle,
    fieldsSet,
    tagsAdded,
    newStatus,
    closed: closing,
    activityEntry,
    logEntry,
    validationErrors,
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
  writeFileAtomic(task.fullPath, taskContent);

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
    writeFileAtomic(dailyPath, dailyContent);
  }

  // Add to completed-today section on daily page
  dailyContent = fs.readFileSync(dailyPath, "utf-8");
  const completedEntry = `- [[${taskFile}|${taskTitle}]]`;
  dailyContent = appendToSection(dailyContent, "Completed today", completedEntry);
  writeFileAtomic(dailyPath, dailyContent);

  appendUniqueToFrontmatterArray(workspaceRoot, dailyFile, "tasks_touched", taskFile);
  appendUniqueToFrontmatterArray(workspaceRoot, dailyFile, "projects_touched", task.data.project);

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
