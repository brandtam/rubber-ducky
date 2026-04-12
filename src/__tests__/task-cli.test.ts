import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "../lib/frontmatter.js";

const CLI_PATH = path.resolve(__dirname, "..", "cli.ts");
const TSX_PATH = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

function runCli(args: string[], cwd?: string): string {
  return execFileSync(TSX_PATH, [CLI_PATH, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

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

  it("creates daily page if it does not exist", () => {
    runCli(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "2024-06-01"],
      tmpDir
    );

    const dailyPath = path.join(tmpDir, "wiki", "daily", "2024-06-01.md");
    expect(fs.existsSync(dailyPath)).toBe(true);
  });

  it("fails for nonexistent task file", () => {
    try {
      runCli(
        ["--json", "task", "start", "wiki/tasks/nonexistent.md", "--date", "2024-03-15"],
        tmpDir
      );
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not found/i);
    }
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      runCli(["--json", "task", "start", "wiki/tasks/fix-bug.md"], outsideDir);
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
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
    try {
      runCli(
        ["--json", "task", "close", "wiki/tasks/nonexistent.md", "--date", "2024-03-15"],
        tmpDir
      );
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not found/i);
    }
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      runCli(["--json", "task", "close", "wiki/tasks/fix-bug.md"], outsideDir);
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not inside/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
