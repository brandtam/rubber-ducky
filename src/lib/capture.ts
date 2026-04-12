import * as fs from "node:fs";
import * as path from "node:path";
import { createPage } from "./page.js";

// ── ASAP types ──────────────────────────────────────────────────────────────

export interface AsapAddResult {
  filePath: string;
  relativePath: string;
  message: string;
  index: number;
}

export interface AsapItem {
  index: number;
  message: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface AsapListResult {
  items: AsapItem[];
  total: number;
  pending: number;
}

export interface AsapResolveResult {
  index: number;
  message: string;
  resolved: boolean;
}

// ── Reminder types ──────────────────────────────────────────────────────────

export interface ReminderAddResult {
  filePath: string;
  relativePath: string;
  message: string;
  date: string;
  index: number;
}

export interface ReminderItem {
  index: number;
  message: string;
  date: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface ReminderListResult {
  items: ReminderItem[];
  total: number;
  pending: number;
}

export interface ReminderResolveResult {
  index: number;
  message: string;
  resolved: boolean;
}

// ── Idea types ──────────────────────────────────────────────────────────────

export interface IdeaAddResult {
  filePath: string;
  relativePath: string;
  message: string;
  index: number;
}

export interface IdeaItem {
  index: number;
  message: string;
  createdAt: string;
}

export interface IdeaListResult {
  items: IdeaItem[];
  total: number;
}

// ── Screenshot types ────────────────────────────────────────────────────────

export interface ScreenshotResult {
  rawPath: string;
  rawRelativePath: string;
  taskPath: string;
  taskRelativePath: string;
  title: string;
}

// ── Internal parsing helpers ────────────────────────────────────────────────

const ASAP_HEADER = "# ASAP\n";
const REMINDERS_HEADER = "# Reminders\n";
const IDEAS_HEADER = "# Ideas\n";

// Parse a checkbox line: - [ ] or - [x] followed by timestamp — message
const ASAP_LINE_RE = /^- \[([ x])\] (\S+) — (.+?)(?:\s+\(resolved: (\S+)\))?$/;
const REMINDER_LINE_RE = /^- \[([ x])\] (\S+) — (.+?) \(created: (\S+?)(?:, resolved: (\S+))?\)$/;
const IDEA_LINE_RE = /^- (\S+) — (.+)$/;

function parseAsapLine(line: string): Omit<AsapItem, "index"> | null {
  const match = line.match(ASAP_LINE_RE);
  if (!match) return null;
  return {
    resolved: match[1] === "x",
    createdAt: match[2],
    message: match[3],
    ...(match[4] ? { resolvedAt: match[4] } : {}),
  };
}

function parseReminderLine(line: string): Omit<ReminderItem, "index"> | null {
  const match = line.match(REMINDER_LINE_RE);
  if (!match) return null;
  return {
    resolved: match[1] === "x",
    date: match[2],
    message: match[3],
    createdAt: match[4],
    ...(match[5] ? { resolvedAt: match[5] } : {}),
  };
}

function parseIdeaLine(line: string): Omit<IdeaItem, "index"> | null {
  const match = line.match(IDEA_LINE_RE);
  if (!match) return null;
  return {
    createdAt: match[1],
    message: match[2],
  };
}

function readLines(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8").split("\n");
}

// ── ASAP operations ─────────────────────────────────────────────────────────

export function addAsap(workspaceRoot: string, message: string): AsapAddResult {
  const asapPath = path.join(workspaceRoot, "wiki", "asap.md");
  const timestamp = new Date().toISOString();
  const line = `- [ ] ${timestamp} — ${message}\n`;

  fs.mkdirSync(path.dirname(asapPath), { recursive: true });

  if (!fs.existsSync(asapPath)) {
    fs.writeFileSync(asapPath, `${ASAP_HEADER}\n${line}`, "utf-8");
  } else {
    fs.appendFileSync(asapPath, line, "utf-8");
  }

  // Count items to determine index
  const lines = readLines(asapPath);
  const itemCount = lines.filter((l) => ASAP_LINE_RE.test(l)).length;

  return {
    filePath: asapPath,
    relativePath: "wiki/asap.md",
    message,
    index: itemCount,
  };
}

export function listAsap(workspaceRoot: string): AsapListResult {
  const asapPath = path.join(workspaceRoot, "wiki", "asap.md");
  const lines = readLines(asapPath);

  const items: AsapItem[] = [];
  let idx = 0;
  for (const line of lines) {
    const parsed = parseAsapLine(line);
    if (parsed) {
      idx++;
      items.push({ index: idx, ...parsed });
    }
  }

  return {
    items,
    total: items.length,
    pending: items.filter((i) => !i.resolved).length,
  };
}

export function resolveAsap(workspaceRoot: string, index: number): AsapResolveResult {
  const asapPath = path.join(workspaceRoot, "wiki", "asap.md");

  if (!fs.existsSync(asapPath)) {
    throw new Error("No ASAP list found. Add items first with `asap add`.");
  }

  const lines = readLines(asapPath);
  let itemIdx = 0;
  let targetLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (ASAP_LINE_RE.test(lines[i])) {
      itemIdx++;
      if (itemIdx === index) {
        targetLineIdx = i;
        break;
      }
    }
  }

  if (targetLineIdx === -1) {
    throw new Error(`Index ${index} out of range. Use \`asap list\` to see items.`);
  }

  const parsed = parseAsapLine(lines[targetLineIdx]);
  if (!parsed) {
    throw new Error(`Failed to parse item at index ${index}.`);
  }

  if (parsed.resolved) {
    throw new Error(`Item ${index} is already resolved.`);
  }

  const resolvedAt = new Date().toISOString();
  lines[targetLineIdx] = `- [x] ${parsed.createdAt} — ${parsed.message} (resolved: ${resolvedAt})`;

  fs.writeFileSync(asapPath, lines.join("\n"), "utf-8");

  return {
    index,
    message: parsed.message,
    resolved: true,
  };
}

// ── Reminder operations ─────────────────────────────────────────────────────

export function addReminder(
  workspaceRoot: string,
  date: string,
  message: string
): ReminderAddResult {
  const remindersPath = path.join(workspaceRoot, "wiki", "reminders.md");
  const timestamp = new Date().toISOString();
  const line = `- [ ] ${date} — ${message} (created: ${timestamp})\n`;

  fs.mkdirSync(path.dirname(remindersPath), { recursive: true });

  if (!fs.existsSync(remindersPath)) {
    fs.writeFileSync(remindersPath, `${REMINDERS_HEADER}\n${line}`, "utf-8");
  } else {
    fs.appendFileSync(remindersPath, line, "utf-8");
  }

  const lines = readLines(remindersPath);
  const itemCount = lines.filter((l) => REMINDER_LINE_RE.test(l)).length;

  return {
    filePath: remindersPath,
    relativePath: "wiki/reminders.md",
    message,
    date,
    index: itemCount,
  };
}

export function listReminders(
  workspaceRoot: string,
  date?: string
): ReminderListResult {
  const remindersPath = path.join(workspaceRoot, "wiki", "reminders.md");
  const lines = readLines(remindersPath);

  const items: ReminderItem[] = [];
  let idx = 0;
  for (const line of lines) {
    const parsed = parseReminderLine(line);
    if (parsed) {
      idx++;
      if (!date || parsed.date === date) {
        items.push({ index: idx, ...parsed });
      }
    }
  }

  return {
    items,
    total: items.length,
    pending: items.filter((i) => !i.resolved).length,
  };
}

export function resolveReminder(
  workspaceRoot: string,
  index: number
): ReminderResolveResult {
  const remindersPath = path.join(workspaceRoot, "wiki", "reminders.md");

  if (!fs.existsSync(remindersPath)) {
    throw new Error("No reminders found. Add reminders first with `remind add`.");
  }

  const lines = readLines(remindersPath);
  let itemIdx = 0;
  let targetLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (REMINDER_LINE_RE.test(lines[i])) {
      itemIdx++;
      if (itemIdx === index) {
        targetLineIdx = i;
        break;
      }
    }
  }

  if (targetLineIdx === -1) {
    throw new Error(`Index ${index} out of range. Use \`remind list\` to see reminders.`);
  }

  const parsed = parseReminderLine(lines[targetLineIdx]);
  if (!parsed) {
    throw new Error(`Failed to parse reminder at index ${index}.`);
  }

  if (parsed.resolved) {
    throw new Error(`Reminder ${index} is already resolved.`);
  }

  const resolvedAt = new Date().toISOString();
  lines[targetLineIdx] = `- [x] ${parsed.date} — ${parsed.message} (created: ${parsed.createdAt}, resolved: ${resolvedAt})`;

  fs.writeFileSync(remindersPath, lines.join("\n"), "utf-8");

  return {
    index,
    message: parsed.message,
    resolved: true,
  };
}

// ── Idea operations ─────────────────────────────────────────────────────────

export function addIdea(workspaceRoot: string, message: string): IdeaAddResult {
  const ideasPath = path.join(workspaceRoot, "wiki", "ideas.md");
  const timestamp = new Date().toISOString();
  const line = `- ${timestamp} — ${message}\n`;

  fs.mkdirSync(path.dirname(ideasPath), { recursive: true });

  if (!fs.existsSync(ideasPath)) {
    fs.writeFileSync(ideasPath, `${IDEAS_HEADER}\n${line}`, "utf-8");
  } else {
    fs.appendFileSync(ideasPath, line, "utf-8");
  }

  const lines = readLines(ideasPath);
  const itemCount = lines.filter((l) => IDEA_LINE_RE.test(l)).length;

  return {
    filePath: ideasPath,
    relativePath: "wiki/ideas.md",
    message,
    index: itemCount,
  };
}

export function listIdeas(workspaceRoot: string): IdeaListResult {
  const ideasPath = path.join(workspaceRoot, "wiki", "ideas.md");
  const lines = readLines(ideasPath);

  const items: IdeaItem[] = [];
  let idx = 0;
  for (const line of lines) {
    const parsed = parseIdeaLine(line);
    if (parsed) {
      idx++;
      items.push({ index: idx, ...parsed });
    }
  }

  return {
    items,
    total: items.length,
  };
}

// ── Screenshot ingest ───────────────────────────────────────────────────────

export function ingestScreenshot(
  workspaceRoot: string,
  imagePath: string,
  title: string
): ScreenshotResult {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Screenshot not found: ${imagePath}`);
  }

  const rawDir = path.join(workspaceRoot, "raw");
  fs.mkdirSync(rawDir, { recursive: true });

  // Copy screenshot to raw/ with timestamp prefix for uniqueness
  const ext = path.extname(imagePath) || ".png";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawFilename = `${timestamp}-${path.basename(imagePath, ext)}${ext}`;
  const rawPath = path.join(rawDir, rawFilename);

  fs.copyFileSync(imagePath, rawPath);

  // Create task page
  const pageResult = createPage(workspaceRoot, "task", { title, source: "screenshot" });

  return {
    rawPath,
    rawRelativePath: path.join("raw", rawFilename),
    taskPath: pageResult.filePath,
    taskRelativePath: pageResult.relativePath,
    title,
  };
}
