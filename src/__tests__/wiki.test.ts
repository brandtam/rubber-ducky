import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  rebuildIndex,
  appendLog,
  checkStatusFlag,
} from "../lib/wiki.js";
import { createPage } from "../lib/page.js";
import { setFrontmatterField } from "../lib/frontmatter.js";

describe("rebuildIndex", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates an index file at wiki/index.md", () => {
    const result = rebuildIndex(tmpDir);

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "index.md"));
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("returns page counts in result", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "project", { title: "Q2 Migration" });

    const result = rebuildIndex(tmpDir);

    expect(result.pages.daily).toBe(1);
    expect(result.pages.task).toBe(1);
    expect(result.pages.project).toBe(1);
    expect(result.totalPages).toBe(3);
  });

  it("generates empty index when no pages exist", () => {
    const result = rebuildIndex(tmpDir);

    expect(result.totalPages).toBe(0);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("groups tasks by status in the index", () => {
    createPage(tmpDir, "task", { title: "Task One" });
    createPage(tmpDir, "task", { title: "Task Two" });

    // Update Task Two to in-progress
    const taskTwoPath = path.join(tmpDir, "wiki", "tasks", "task-two.md");
    const content = fs.readFileSync(taskTwoPath, "utf-8");
    const updated = setFrontmatterField(content, "status", "in-progress");
    fs.writeFileSync(taskTwoPath, updated, "utf-8");

    rebuildIndex(tmpDir);

    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("### in-progress");
    expect(index).toContain("### backlog");
    expect(index).toContain("Task Two");
    expect(index).toContain("Task One");
  });

  it("includes wikilinks to each page", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    rebuildIndex(tmpDir);

    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("[[wiki/tasks/fix-bug.md|Fix bug]]");
    expect(index).toContain("[[wiki/daily/2024-03-15.md|2024-03-15]]");
  });

  it("groups pages by type", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "project", { title: "Alpha" });

    rebuildIndex(tmpDir);

    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("## Tasks by Status");
    expect(index).toContain("## Projects");
    expect(index).toContain("## Daily Pages");
  });

  it("includes project pages in a table", () => {
    createPage(tmpDir, "project", { title: "Alpha" });
    createPage(tmpDir, "project", { title: "Beta" });

    rebuildIndex(tmpDir);

    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("[[wiki/projects/alpha.md|Alpha]]");
    expect(index).toContain("[[wiki/projects/beta.md|Beta]]");
  });

  it("sorts daily pages in reverse chronological order", () => {
    createPage(tmpDir, "daily", { date: "2024-03-13" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    createPage(tmpDir, "daily", { date: "2024-03-14" });

    rebuildIndex(tmpDir);

    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    const pos15 = index.indexOf("2024-03-15");
    const pos14 = index.indexOf("2024-03-14");
    const pos13 = index.indexOf("2024-03-13");
    expect(pos15).toBeLessThan(pos14);
    expect(pos14).toBeLessThan(pos13);
  });

  it("overwrites existing index on rebuild", () => {
    createPage(tmpDir, "task", { title: "First task" });
    rebuildIndex(tmpDir);

    createPage(tmpDir, "task", { title: "Second task" });
    rebuildIndex(tmpDir);

    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("Second task");
    expect(index).toContain("First task");
  });
});

describe("appendLog", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates log.md if it does not exist", () => {
    appendLog(tmpDir, "First entry");

    expect(fs.existsSync(path.join(tmpDir, "wiki", "log.md"))).toBe(true);
  });

  it("adds a timestamped entry", () => {
    const result = appendLog(tmpDir, "Test message");

    const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    expect(log).toContain("Test message");
    expect(result.entry).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(result.entry).toContain("Test message");
  });

  it("appends multiple entries in order", () => {
    appendLog(tmpDir, "First entry");
    appendLog(tmpDir, "Second entry");

    const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    const firstPos = log.indexOf("First entry");
    const secondPos = log.indexOf("Second entry");
    expect(firstPos).toBeLessThan(secondPos);
  });

  it("returns the file path and entry text", () => {
    const result = appendLog(tmpDir, "A log message");

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "log.md"));
    expect(result.entry).toContain("A log message");
  });

  it("includes ISO date and time in entry", () => {
    appendLog(tmpDir, "Timestamped");

    const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    // Match ISO-like timestamp pattern
    expect(log).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("preserves log header on append", () => {
    appendLog(tmpDir, "First");
    appendLog(tmpDir, "Second");

    const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    // Header should appear only once
    const headerCount = (log.match(/# Log/g) || []).length;
    expect(headerCount).toBe(1);
  });
});

describe("checkStatusFlag", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when daily page does not exist", () => {
    const result = checkStatusFlag(tmpDir, "morning-brief", "2024-03-15");

    expect(result.flagSet).toBe(false);
    expect(result.pageExists).toBe(false);
  });

  it("returns false when flag is not set", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    const result = checkStatusFlag(tmpDir, "morning-brief", "2024-03-15");

    expect(result.flagSet).toBe(false);
    expect(result.pageExists).toBe(true);
  });

  it("returns true when morning-brief flag is set", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    const pagePath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    const content = fs.readFileSync(pagePath, "utf-8");
    const updated = setFrontmatterField(content, "morning_brief", true);
    fs.writeFileSync(pagePath, updated, "utf-8");

    const result = checkStatusFlag(tmpDir, "morning-brief", "2024-03-15");

    expect(result.flagSet).toBe(true);
    expect(result.pageExists).toBe(true);
  });

  it("converts kebab-case flag to snake_case frontmatter field", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    const pagePath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    const content = fs.readFileSync(pagePath, "utf-8");
    const updated = setFrontmatterField(content, "morning_brief", true);
    fs.writeFileSync(pagePath, updated, "utf-8");

    // Both formats should work
    const result = checkStatusFlag(tmpDir, "morning-brief", "2024-03-15");
    expect(result.flagSet).toBe(true);
    expect(result.flag).toBe("morning_brief");
  });

  it("defaults to today when no date provided", () => {
    const today = new Date().toISOString().split("T")[0];
    createPage(tmpDir, "daily", { date: today });

    const result = checkStatusFlag(tmpDir, "morning-brief");

    expect(result.date).toBe(today);
    expect(result.pageExists).toBe(true);
  });

  it("returns flag name and date in result", () => {
    const result = checkStatusFlag(tmpDir, "wrap-up", "2024-03-15");

    expect(result.flag).toBe("wrap_up");
    expect(result.date).toBe("2024-03-15");
  });

  it("handles flags that are already snake_case", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    const pagePath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    const content = fs.readFileSync(pagePath, "utf-8");
    const updated = setFrontmatterField(content, "morning_brief", true);
    fs.writeFileSync(pagePath, updated, "utf-8");

    const result = checkStatusFlag(tmpDir, "morning_brief", "2024-03-15");
    expect(result.flagSet).toBe(true);
  });
});
