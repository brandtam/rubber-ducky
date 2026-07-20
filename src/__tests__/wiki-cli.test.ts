import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliFail } from "./harness.js";

describe("index rebuild CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rebuilds index and returns JSON result", () => {
    runCli(["--json", "page", "create", "task", "Fix bug"], tmpDir);

    const output = runCli(["--json", "index", "rebuild"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.totalPages).toBe(1);
    expect(result.pages.task).toBe(1);
    expect(result.relativePath).toBe("wiki/index.md");
  });

  it("generates index file on disk", () => {
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);
    runCli(["--json", "page", "create", "task", "Fix bug"], tmpDir);
    runCli(["--json", "page", "create", "project", "Alpha"], tmpDir);

    runCli(["--json", "index", "rebuild"], tmpDir);

    const indexPath = path.join(tmpDir, "wiki", "index.md");
    expect(fs.existsSync(indexPath)).toBe(true);

    const content = fs.readFileSync(indexPath, "utf-8");
    expect(content).toContain("## Tasks by Status");
    expect(content).toContain("## Projects");
    expect(content).toContain("## Daily Pages");
    expect(content).toContain("[[wiki/tasks/fix-bug.md\\|Fix bug]]");
    expect(content).toContain("[[wiki/projects/alpha.md\\|Alpha]]");
    expect(content).toContain("[[wiki/daily/2024-03-15.md\\|2024-03-15]]");
  });

  it("groups tasks by status in the index", () => {
    runCli(["--json", "page", "create", "task", "Backlog task"], tmpDir);
    runCli(["--json", "page", "create", "task", "Active task"], tmpDir);

    // Set one task to in-progress via frontmatter set
    runCli(
      ["--json", "frontmatter", "set", "wiki/tasks/active-task.md", "status", "in-progress"],
      tmpDir
    );

    runCli(["--json", "index", "rebuild"], tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(content).toContain("### in-progress");
    expect(content).toContain("### backlog");
  });

  it("returns empty index when no pages exist", () => {
    const output = runCli(["--json", "index", "rebuild"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.totalPages).toBe(0);
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      const { stdout, status } = runCliFail(["--json", "index", "rebuild"], outsideDir);
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout || "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not inside/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("log append CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends a log entry and returns JSON result", () => {
    const output = runCli(["--json", "log", "append", "Test message"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.entry).toContain("Test message");
    expect(result.relativePath).toBe("wiki/log.md");
  });

  it("creates log.md on disk", () => {
    runCli(["--json", "log", "append", "First entry"], tmpDir);

    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("# Log");
    expect(content).toContain("First entry");
  });

  it("includes ISO timestamp in entry", () => {
    const output = runCli(["--json", "log", "append", "Timestamped entry"], tmpDir);
    const result = JSON.parse(output);

    expect(result.entry).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("appends multiple entries", () => {
    runCli(["--json", "log", "append", "First"], tmpDir);
    runCli(["--json", "log", "append", "Second"], tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    expect(content).toContain("First");
    expect(content).toContain("Second");

    const firstPos = content.indexOf("First");
    const secondPos = content.indexOf("Second");
    expect(firstPos).toBeLessThan(secondPos);
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      const { stdout, status } = runCliFail(["--json", "log", "append", "Test"], outsideDir);
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout || "{}");
      expect(output.success).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("status check CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns false when daily page does not exist", () => {
    const output = runCli(
      ["--json", "status", "check", "morning-brief", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.flagSet).toBe(false);
    expect(result.pageExists).toBe(false);
  });

  it("returns false when flag is not set", () => {
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);

    const output = runCli(
      ["--json", "status", "check", "morning-brief", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.flagSet).toBe(false);
    expect(result.pageExists).toBe(true);
  });

  it("returns true when flag is set", () => {
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);
    runCli(
      ["--json", "frontmatter", "set", "wiki/daily/2024-03-15.md", "morning_brief", "true"],
      tmpDir
    );

    const output = runCli(
      ["--json", "status", "check", "morning-brief", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.flagSet).toBe(true);
  });

  it("converts kebab-case flag to snake_case", () => {
    const output = runCli(
      ["--json", "status", "check", "morning-brief", "2024-03-15"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.flag).toBe("morning_brief");
  });

  it("defaults to today when no date provided", () => {
    const today = new Date().toISOString().split("T")[0];
    runCli(["--json", "page", "create", "daily"], tmpDir);

    const output = runCli(["--json", "status", "check", "morning-brief"], tmpDir);
    const result = JSON.parse(output);

    expect(result.date).toBe(today);
    expect(result.pageExists).toBe(true);
  });

  it("existing status command still works", () => {
    const output = runCli(["--json", "status"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.workspace).toBeDefined();
    expect(result.workspace.name).toBeDefined();
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      const { stdout, status } = runCliFail(
        ["--json", "status", "check", "morning-brief"],
        outsideDir
      );
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout || "{}");
      expect(output.success).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("wiki search CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-wiki-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns JSON search results", () => {
    runCli(["--json", "page", "create", "task", "Auth rewrite"], tmpDir);
    // Add searchable content
    const taskPath = path.join(tmpDir, "wiki", "tasks", "auth-rewrite.md");
    const content = fs.readFileSync(taskPath, "utf-8");
    fs.writeFileSync(
      taskPath,
      content.replace("## Description", "## Description\n\nRewrite the auth middleware"),
      "utf-8"
    );

    const output = runCli(["--json", "wiki", "search", "auth middleware"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].relativePath).toBe("wiki/tasks/auth-rewrite.md");
  });

  it("returns empty results when no matches", () => {
    const output = runCli(["--json", "wiki", "search", "nonexistent"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.totalMatches).toBe(0);
    expect(result.matches).toEqual([]);
  });

  it("supports --type filter", () => {
    runCli(["--json", "page", "create", "task", "Task with keyword"], tmpDir);
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);

    const taskPath = path.join(tmpDir, "wiki", "tasks", "task-with-keyword.md");
    const dailyPath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    const taskContent = fs.readFileSync(taskPath, "utf-8");
    const dailyContent = fs.readFileSync(dailyPath, "utf-8");
    fs.writeFileSync(
      taskPath,
      taskContent.replace("## Description", "## Description\n\nShared keyword"),
      "utf-8"
    );
    fs.writeFileSync(
      dailyPath,
      dailyContent.replace("## Work log", "## Work log\n\n- Shared keyword"),
      "utf-8"
    );

    const output = runCli(["--json", "wiki", "search", "Shared keyword", "--type", "task"], tmpDir);
    const result = JSON.parse(output);

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].type).toBe("task");
  });

  it("supports --from date filter", () => {
    runCli(["--json", "page", "create", "daily", "2024-03-10"], tmpDir);
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);
    const earlyPath = path.join(tmpDir, "wiki", "daily", "2024-03-10.md");
    const latePath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    fs.writeFileSync(
      earlyPath,
      fs.readFileSync(earlyPath, "utf-8").replace("## Work log", "## Work log\n\n- Did work"),
      "utf-8"
    );
    fs.writeFileSync(
      latePath,
      fs.readFileSync(latePath, "utf-8").replace("## Work log", "## Work log\n\n- Did work"),
      "utf-8"
    );

    const output = runCli(
      ["--json", "wiki", "search", "Did work", "--from", "2024-03-12"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].relativePath).toBe("wiki/daily/2024-03-15.md");
  });

  it("supports --to date filter", () => {
    runCli(["--json", "page", "create", "daily", "2024-03-10"], tmpDir);
    runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);
    const earlyPath = path.join(tmpDir, "wiki", "daily", "2024-03-10.md");
    const latePath = path.join(tmpDir, "wiki", "daily", "2024-03-15.md");
    fs.writeFileSync(
      earlyPath,
      fs.readFileSync(earlyPath, "utf-8").replace("## Work log", "## Work log\n\n- Did work"),
      "utf-8"
    );
    fs.writeFileSync(
      latePath,
      fs.readFileSync(latePath, "utf-8").replace("## Work log", "## Work log\n\n- Did work"),
      "utf-8"
    );

    const output = runCli(
      ["--json", "wiki", "search", "Did work", "--to", "2024-03-12"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].relativePath).toBe("wiki/daily/2024-03-10.md");
  });

  it("includes frontmatter in results", () => {
    runCli(["--json", "page", "create", "task", "Important task"], tmpDir);
    runCli(
      ["--json", "frontmatter", "set", "wiki/tasks/important-task.md", "status", "in-progress"],
      tmpDir
    );

    const output = runCli(["--json", "wiki", "search", "Important task"], tmpDir);
    const result = JSON.parse(output);

    expect(result.matches[0].frontmatter.title).toBe("Important task");
    expect(result.matches[0].frontmatter.status).toBe("in-progress");
  });

  it("includes matching lines with line numbers", () => {
    runCli(["--json", "page", "create", "task", "Bug fix"], tmpDir);
    const taskPath = path.join(tmpDir, "wiki", "tasks", "bug-fix.md");
    const content = fs.readFileSync(taskPath, "utf-8");
    fs.writeFileSync(
      taskPath,
      content.replace("## Description", "## Description\n\nThe login form crashes on submit"),
      "utf-8"
    );

    const output = runCli(["--json", "wiki", "search", "login form"], tmpDir);
    const result = JSON.parse(output);

    expect(result.matches[0].matchingLines.length).toBeGreaterThan(0);
    expect(result.matches[0].matchingLines[0].text).toContain("login form");
    expect(typeof result.matches[0].matchingLines[0].lineNumber).toBe("number");
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      const { stdout, status } = runCliFail(["--json", "wiki", "search", "test"], outsideDir);
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout || "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not inside/i);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("caps results at --limit and reports truncated=true when more matches exist", () => {
    // Seed 12 task pages all containing the same keyword so total > default limit (10).
    for (let i = 0; i < 12; i++) {
      const title = `Capacity test task ${i}`;
      runCli(["--json", "page", "create", "task", title], tmpDir);
    }

    const output = runCli(["--json", "wiki", "search", "capacity"], tmpDir);
    const result = JSON.parse(output);

    expect(result.totalMatches).toBe(12);
    expect(result.returnedMatches).toBe(10);
    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBe(10);
  });

  it("--verbose returns every match regardless of --limit", () => {
    for (let i = 0; i < 12; i++) {
      runCli(["--json", "page", "create", "task", `Capacity verbose task ${i}`], tmpDir);
    }

    const output = runCli(["--json", "--verbose", "wiki", "search", "capacity"], tmpDir);
    const result = JSON.parse(output);

    expect(result.totalMatches).toBe(12);
    expect(result.returnedMatches).toBe(12);
    expect(result.truncated).toBe(false);
    expect(result.matches.length).toBe(12);
  });

  it("--limit overrides the default cap", () => {
    for (let i = 0; i < 6; i++) {
      runCli(["--json", "page", "create", "task", `Limit test task ${i}`], tmpDir);
    }

    const output = runCli(["--json", "wiki", "search", "limit test", "--limit", "3"], tmpDir);
    const result = JSON.parse(output);

    expect(result.totalMatches).toBe(6);
    expect(result.returnedMatches).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBe(3);
  });
});
