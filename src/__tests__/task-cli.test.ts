import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { runCli, runCliFail } from "./harness.js";

describe("task start CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-task-cli-"));
    runCli(["--json", "init", tmpDir]);
    runCli(["--json", "page", "create", "task", "Fix bug"], tmpDir);
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts a task and returns JSON result", () => {
    const output = runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.taskTitle).toBe("Fix bug");
    expect(result.newStatus).toBe("in-progress");
    expect(result.dailyFile).toBe("wiki/daily/2024-03-15.md");
  });

  it("sets task status to in-progress on disk", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.status).toBe("in-progress");
  });

  it("sets active_task on daily page", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBe("wiki/tasks/fix-bug.md");
  });

  it("adds activity log entry to task page", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    expect(content).toContain("- Started on 2024-03-15");
  });

  it("adds task to tasks_touched on daily page", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.tasks_touched).toContain("wiki/tasks/fix-bug.md");
  });

  it("adds project to projects_touched on daily page when task has a project", () => {
    runCli(
      ["--json", "page", "create", "task", "Project task", "--project", "storefront"],
      tmpDir
    );
    runCli(
      ["--json", "task", "start", "wiki/tasks/project-task.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.projects_touched).toContain("storefront");
  });

  it("does not modify projects_touched when task has no project", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.projects_touched).toEqual([]);
  });

  it("creates daily page if it does not exist", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-06-01"],
      tmpDir
    );

    const dailyPath = path.join(tmpDir, "wiki", "daily", "2024-06-01.md");
    expect(fs.existsSync(dailyPath)).toBe(true);
  });

  it("fails for nonexistent task file", () => {
    const { stdout, status } = runCliFail(
      ["--json", "task", "start", "wiki/tasks/nonexistent.md", "--date", "2024-03-15"],
      tmpDir
    );
    expect(status).not.toBe(0);
    const output = JSON.parse(stdout);
    expect(output.success).toBe(false);
    expect(output.error).toMatch(/not found/i);
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      const { stdout, status } = runCliFail(
        ["--json", "task", "start", "wiki/tasks/fix-bug.md"],
        outsideDir
      );
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not inside/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("task close CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-task-cli-"));
    runCli(["--json", "init", tmpDir]);
    runCli(["--json", "page", "create", "task", "Fix bug"], tmpDir);
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("closes a task and returns JSON result", () => {
    const output = runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.taskTitle).toBe("Fix bug");
    expect(result.newStatus).toBe("done");
    expect(result.closedDate).toBe("2024-03-15");
  });

  it("sets task status to done and closed date on disk", () => {
    runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.status).toBe("done");
    expect(parsed!.data.closed).toBe("2024-03-15");
  });

  it("adds activity log entry to task page", () => {
    runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    expect(content).toContain("- Closed on 2024-03-15");
  });

  it("clears active_task when closing the active task", () => {
    // Start the task first
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    // Verify it's active
    let content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    let parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBe("wiki/tasks/fix-bug.md");

    // Close the task
    const output = runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);
    expect(result.clearedActiveTask).toBe(true);

    // Verify it's cleared
    content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    parsed = parseFrontmatter(content);
    expect(parsed!.data.active_task).toBeNull();
  });

  it("updates completed-today section on daily page", () => {
    runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"), "utf-8");
    expect(content).toContain("- [[wiki/tasks/fix-bug.md|Fix bug]]");
  });

  it("appends to wiki/log.md", () => {
    runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(true);
    const logContent = fs.readFileSync(logPath, "utf-8");
    expect(logContent).toContain("Closed task: Fix bug");
  });

  it("full start-then-close lifecycle", () => {
    // Start the task
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    // Close the task
    runCli(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2024-03-15"],
      tmpDir
    );

    // Verify task page
    const taskContent = fs.readFileSync(path.join(tmpDir, "wiki", "tasks", "fix-bug.md"), "utf-8");
    const taskParsed = parseFrontmatter(taskContent);
    expect(taskParsed!.data.status).toBe("done");
    expect(taskParsed!.data.closed).toBe("2024-03-15");
    expect(taskContent).toContain("- Started on 2024-03-15");
    expect(taskContent).toContain("- Closed on 2024-03-15");

    // Verify daily page
    const dailyContent = fs.readFileSync(
      path.join(tmpDir, "wiki", "daily", "2024-03-15.md"),
      "utf-8"
    );
    const dailyParsed = parseFrontmatter(dailyContent);
    expect(dailyParsed!.data.active_task).toBeNull();
    expect(dailyParsed!.data.tasks_touched).toContain("wiki/tasks/fix-bug.md");
    expect(dailyContent).toContain("- [[wiki/tasks/fix-bug.md|Fix bug]]");

    // Verify log
    const logContent = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    expect(logContent).toContain("Closed task: Fix bug");
  });

  it("fails for nonexistent task file", () => {
    const { stdout, status } = runCliFail(
      ["--json", "task", "close", "wiki/tasks/nonexistent.md", "--date", "2024-03-15"],
      tmpDir
    );
    expect(status).not.toBe(0);
    const output = JSON.parse(stdout);
    expect(output.success).toBe(false);
    expect(output.error).toMatch(/not found/i);
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      const { stdout, status } = runCliFail(
        ["--json", "task", "close", "wiki/tasks/fix-bug.md"],
        outsideDir
      );
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not inside/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("task stamp-write CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-stamp-cli-"));
    runCli(["--json", "init", tmpDir]);
    runCli(["--json", "page", "create", "task", "Ship feature"], tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const taskPath = () => path.join(tmpDir, "wiki", "tasks", "ship-feature.md");

  it("stamps source/ref/url/pushed, activity, and log in one call", () => {
    const output = runCli(
      [
        "--json", "task", "stamp-write", "wiki/tasks/ship-feature.md",
        "--set", "source=github", "--set", "ref=acme/app#42", "--set", "gh_ref=https://github.com/acme/app/issues/42",
        "--pushed",
        "--activity", "Pushed to github as acme/app#42",
        "--log", "[backend-write] github.create acme/app#42 -- pushed",
        "--validate",
      ],
      tmpDir
    );
    const result = JSON.parse(output);
    expect(result.success).toBe(true);
    expect(result.fieldsSet).toContain("source");
    expect(result.fieldsSet).toContain("pushed");
    expect(result.validationErrors).toEqual([]);

    const content = fs.readFileSync(taskPath(), "utf-8");
    const parsed = parseFrontmatter(content);
    expect(parsed!.data.source).toBe("github");
    expect(parsed!.data.ref).toBe("acme/app#42");
    expect(parsed!.data.pushed).toBeTruthy();
    expect(parsed!.data.updated).toBeTruthy();
    expect(content).toContain("- Pushed to github as acme/app#42");

    const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    expect(log).toContain("[backend-write] github.create acme/app#42 -- pushed");
  });

  it("bumps comment_count and dedups tags", () => {
    runCli(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md",
       "--bump-comments", "--tag", "frontend", "--tag", "frontend"],
      tmpDir
    );
    const output = runCli(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md",
       "--bump-comments", "2", "--tag", "frontend"],
      tmpDir
    );
    const result = JSON.parse(output);
    expect(result.tagsAdded).toEqual([]);
    const parsed = parseFrontmatter(fs.readFileSync(taskPath(), "utf-8"));
    expect(parsed!.data.comment_count).toBe(3);
    expect(parsed!.data.tags).toEqual(["frontend"]);
  });

  it("sets a non-done status without closing", () => {
    const output = runCli(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md", "--status", "in-review"],
      tmpDir
    );
    const result = JSON.parse(output);
    expect(result.newStatus).toBe("in-review");
    expect(result.closed).toBe(false);
    const parsed = parseFrontmatter(fs.readFileSync(taskPath(), "utf-8"));
    expect(parsed!.data.status).toBe("in-review");
    expect(parsed!.data.closed).toBeNull();
  });

  it("--status done runs the full close flow (closed date + daily page)", () => {
    const output = runCli(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md",
       "--status", "done", "--date", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);
    expect(result.closed).toBe(true);
    const parsed = parseFrontmatter(fs.readFileSync(taskPath(), "utf-8"));
    expect(parsed!.data.status).toBe("done");
    expect(parsed!.data.closed).toBe("2024-03-15");
    expect(fs.existsSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"))).toBe(true);
  });

  it("rejects a malformed --set pair with InvalidInput", () => {
    const { status } = runCliFail(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md", "--set", "no-equals-sign"],
      tmpDir
    );
    expect(status).toBe(2);
  });

  it("rejects a malformed --date with InvalidInput", () => {
    const { status } = runCliFail(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md", "--status", "done", "--date", "bogus"],
      tmpDir
    );
    expect(status).toBe(2);
  });

  it("rejects a path escaping the workspace with InvalidInput", () => {
    const { status } = runCliFail(
      ["--json", "task", "stamp-write", "../../outside.md", "--pushed"],
      tmpDir
    );
    expect(status).toBe(2);
  });

  it("surfaces validation failures with success false and InvalidInput", () => {
    const { stdout, status } = runCliFail(
      ["--json", "task", "stamp-write", "wiki/tasks/ship-feature.md",
       "--set", "status=not-a-status", "--validate"],
      tmpDir
    );
    expect(status).toBe(2);
    const result = JSON.parse(stdout);
    expect(result.success).toBe(false);
    expect(result.validationErrors.length).toBeGreaterThan(0);
  });
});
