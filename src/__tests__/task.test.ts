import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { startTask, closeTask, appendToSection } from "../lib/task.js";
import { createPage } from "../lib/page.js";
import { parseFrontmatter, setFrontmatterField } from "../lib/frontmatter.js";

function setupWorkspace(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-task-test-"));
  fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "workspace.md"),
    "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
  );
  return tmpDir;
}

describe("appendToSection", () => {
  it("appends text under an existing section", () => {
    const content = "---\ntitle: test\n---\n## Activity log\n\n## See also\n";
    const result = appendToSection(content, "Activity log", "- Started on 2024-03-15");

    expect(result).toContain("## Activity log\n\n- Started on 2024-03-15\n");
    expect(result).toContain("## See also");
  });

  it("appends text at end when section is last", () => {
    const content = "---\ntitle: test\n---\n## Activity log\n";
    const result = appendToSection(content, "Activity log", "- Started on 2024-03-15");

    expect(result).toContain("## Activity log\n\n- Started on 2024-03-15\n");
  });

  it("appends after existing entries in a section", () => {
    const content = "---\ntitle: test\n---\n## Activity log\n\n- Previous entry\n\n## See also\n";
    const result = appendToSection(content, "Activity log", "- New entry");

    expect(result).toContain("- Previous entry\n- New entry\n");
  });

  it("throws when section not found", () => {
    const content = "---\ntitle: test\n---\n## Other section\n";

    expect(() => appendToSection(content, "Activity log", "text")).toThrow(
      /section.*Activity log.*not found/i
    );
  });
});

describe("startTask", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupWorkspace();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets task status to in-progress", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.status).toBe("in-progress");
  });

  it("updates the updated timestamp", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    const before = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsedBefore = parseFrontmatter(before);
    const oldUpdated = parsedBefore!.data.updated;

    // Small delay to ensure timestamp changes
    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const after = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsedAfter = parseFrontmatter(after);
    expect(parsedAfter!.data.updated).toBeDefined();
  });

  it("sets active_task on daily page", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBe("wiki/tasks/fix-bug.md");
  });

  it("adds activity log entry to task page", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    expect(content).toContain("- Started on 2024-03-15");
  });

  it("adds task to daily page tasks_touched", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.tasks_touched).toContain("wiki/tasks/fix-bug.md");
  });

  it("does not duplicate task in tasks_touched", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");
    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    const touched = parsed!.data.tasks_touched as string[];
    expect(touched.filter((t) => t === "wiki/tasks/fix-bug.md")).toHaveLength(1);
  });

  it("creates daily page if it does not exist", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });

    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const dailyPath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    expect(fs.existsSync(dailyPath)).toBe(true);
  });

  it("returns result with task info", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    const result = startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    expect(result.taskFile).toBe("wiki/tasks/fix-bug.md");
    expect(result.taskTitle).toBe("Fix bug");
    expect(result.previousStatus).toBe("backlog");
    expect(result.newStatus).toBe("in-progress");
    expect(result.dailyFile).toBe("wiki/daily/2024-03-15.md");
  });

  it("throws when task file does not exist", () => {
    expect(() => startTask(tmpDir, "wiki/tasks/nonexistent.md", "2024-03-15")).toThrow(
      /not found/i
    );
  });

  it("throws when task file is not a task page", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    expect(() => startTask(tmpDir, "wiki/daily/2024-03-15.md", "2024-03-15")).toThrow(
      /not a task page/i
    );
  });
});

describe("closeTask", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupWorkspace();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("sets task status to done", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.status).toBe("done");
  });

  it("sets closed date in frontmatter", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.closed).toBe("2024-03-15");
  });

  it("adds activity log entry to task page", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    expect(content).toContain("- Closed on 2024-03-15");
  });

  it("clears active_task on daily page if this was the active task", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    // First start the task to set it as active
    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    // Verify it was set
    let content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    let parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBe("wiki/tasks/fix-bug.md");

    // Now close it
    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBeNull();
  });

  it("does not clear active_task if it points to a different task", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "task", { title: "Other task" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    // Start the other task (sets it as active)
    startTask(tmpDir, "wiki/tasks/other-task.md", "2024-03-15");

    // Close fix-bug (which is NOT the active task)
    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBe("wiki/tasks/other-task.md");
  });

  it("updates daily page completed-today section", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    expect(content).toContain("- [[wiki/tasks/fix-bug.md|Fix bug]]");
  });

  it("appends to wiki/log.md", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(true);
    const logContent = fs.readFileSync(logPath, "utf-8");
    expect(logContent).toContain("Closed task: Fix bug");
  });

  it("adds task to daily page tasks_touched", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.tasks_touched).toContain("wiki/tasks/fix-bug.md");
  });

  it("creates daily page if it does not exist", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });

    closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const dailyPath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    expect(fs.existsSync(dailyPath)).toBe(true);
  });

  it("returns result with task and close info", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    const result = closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    expect(result.taskFile).toBe("wiki/tasks/fix-bug.md");
    expect(result.taskTitle).toBe("Fix bug");
    expect(result.previousStatus).toBe("backlog");
    expect(result.newStatus).toBe("done");
    expect(result.closedDate).toBe("2024-03-15");
    expect(result.clearedActiveTask).toBe(false);
  });

  it("returns clearedActiveTask true when active task was cleared", () => {
    createPage(tmpDir, "task", { title: "Fix bug" });
    createPage(tmpDir, "daily", { date: "2024-03-15" });
    startTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    const result = closeTask(tmpDir, "wiki/tasks/fix-bug.md", "2024-03-15");

    expect(result.clearedActiveTask).toBe(true);
  });

  it("throws when task file does not exist", () => {
    expect(() => closeTask(tmpDir, "wiki/tasks/nonexistent.md", "2024-03-15")).toThrow(
      /not found/i
    );
  });

  it("throws when task file is not a task page", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    expect(() => closeTask(tmpDir, "wiki/daily/2024-03-15.md", "2024-03-15")).toThrow(
      /not a task page/i
    );
  });
});
