import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI_PATH = path.resolve(__dirname, "..", "cli.ts");
const TSX_PATH = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

function runCli(args: string[], cwd?: string): string {
  return execFileSync(TSX_PATH, [CLI_PATH, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

// ── ASAP CLI tests ──────────────────────────────────────────────────────────

describe("asap add CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds an ASAP item and returns JSON", () => {
    const output = runCli(["--json", "asap", "add", "Buy groceries"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Buy groceries");
    expect(result.index).toBe(1);
  });

  it("creates asap.md on disk", () => {
    runCli(["--json", "asap", "add", "First item"], tmpDir);

    const asapPath = path.join(tmpDir, "wiki", "asap.md");
    expect(fs.existsSync(asapPath)).toBe(true);
    const content = fs.readFileSync(asapPath, "utf-8");
    expect(content).toContain("First item");
  });

  it("fails outside a workspace", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-outside-"));
    try {
      runCli(["--json", "asap", "add", "Test"], outsideDir);
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe("asap list CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when no items exist", () => {
    const output = runCli(["--json", "asap", "list"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("lists all items after adding them", () => {
    runCli(["--json", "asap", "add", "First"], tmpDir);
    runCli(["--json", "asap", "add", "Second"], tmpDir);

    const output = runCli(["--json", "asap", "list"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].message).toBe("First");
    expect(result.items[1].message).toBe("Second");
  });
});

describe("asap resolve CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves an ASAP item by index", () => {
    runCli(["--json", "asap", "add", "Handle this"], tmpDir);

    const output = runCli(["--json", "asap", "resolve", "1"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.resolved).toBe(true);
    expect(result.message).toBe("Handle this");
  });

  it("fails with invalid index", () => {
    runCli(["--json", "asap", "add", "Only one"], tmpDir);

    try {
      runCli(["--json", "asap", "resolve", "5"], tmpDir);
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/out of range/i);
    }
  });
});

// ── Reminder CLI tests ──────────────────────────────────────────────────────

describe("remind add CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds a reminder and returns JSON", () => {
    const output = runCli(
      ["--json", "remind", "add", "2024-04-01", "Follow up with Alice"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Follow up with Alice");
    expect(result.date).toBe("2024-04-01");
    expect(result.index).toBe(1);
  });

  it("creates reminders.md on disk", () => {
    runCli(["--json", "remind", "add", "2024-04-01", "Test"], tmpDir);

    const remindersPath = path.join(tmpDir, "wiki", "reminders.md");
    expect(fs.existsSync(remindersPath)).toBe(true);
  });
});

describe("remind list CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when no reminders exist", () => {
    const output = runCli(["--json", "remind", "list"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
  });

  it("filters reminders by date", () => {
    runCli(["--json", "remind", "add", "2024-04-01", "April first"], tmpDir);
    runCli(["--json", "remind", "add", "2024-04-15", "April fifteenth"], tmpDir);

    const output = runCli(["--json", "remind", "list", "2024-04-01"], tmpDir);
    const result = JSON.parse(output);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].message).toBe("April first");
  });

  it("lists all reminders without date filter", () => {
    runCli(["--json", "remind", "add", "2024-04-01", "First"], tmpDir);
    runCli(["--json", "remind", "add", "2024-04-15", "Second"], tmpDir);

    const output = runCli(["--json", "remind", "list"], tmpDir);
    const result = JSON.parse(output);

    expect(result.items).toHaveLength(2);
  });
});

describe("remind resolve CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a reminder by index", () => {
    runCli(["--json", "remind", "add", "2024-04-01", "Handle this"], tmpDir);

    const output = runCli(["--json", "remind", "resolve", "1"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.resolved).toBe(true);
  });
});

// ── Idea CLI tests ──────────────────────────────────────────────────────────

describe("idea add CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("adds an idea and returns JSON", () => {
    const output = runCli(["--json", "idea", "add", "Build a CLI tool"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.message).toBe("Build a CLI tool");
    expect(result.index).toBe(1);
  });

  it("creates ideas.md on disk", () => {
    runCli(["--json", "idea", "add", "Test idea"], tmpDir);

    const ideasPath = path.join(tmpDir, "wiki", "ideas.md");
    expect(fs.existsSync(ideasPath)).toBe(true);
  });
});

describe("idea list CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when no ideas exist", () => {
    const output = runCli(["--json", "idea", "list"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("lists all ideas", () => {
    runCli(["--json", "idea", "add", "First idea"], tmpDir);
    runCli(["--json", "idea", "add", "Second idea"], tmpDir);

    const output = runCli(["--json", "idea", "list"], tmpDir);
    const result = JSON.parse(output);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].message).toBe("First idea");
  });
});

// ── Screenshot CLI tests ────────────────────────────────────────────────────

describe("screenshot ingest CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests a screenshot and returns JSON", () => {
    const imgPath = path.join(tmpDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");

    const output = runCli(
      ["--json", "screenshot", "ingest", imgPath, "Bug in login form"],
      tmpDir
    );
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.title).toBe("Bug in login form");
    expect(result.rawRelativePath).toMatch(/^raw\//);
    expect(result.taskRelativePath).toBe("wiki/tasks/bug-in-login-form.md");
  });

  it("copies file to raw/ directory", () => {
    const imgPath = path.join(tmpDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");

    const output = runCli(
      ["--json", "screenshot", "ingest", imgPath, "Test task"],
      tmpDir
    );
    const result = JSON.parse(output);

    const rawPath = path.join(tmpDir, result.rawRelativePath);
    expect(fs.existsSync(rawPath)).toBe(true);
  });

  it("creates task page on disk", () => {
    const imgPath = path.join(tmpDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");

    runCli(["--json", "screenshot", "ingest", imgPath, "Test task"], tmpDir);

    const taskPath = path.join(tmpDir, "wiki", "tasks", "test-task.md");
    expect(fs.existsSync(taskPath)).toBe(true);

    const content = fs.readFileSync(taskPath, "utf-8");
    expect(content).toContain("source: screenshot");
  });

  it("fails with nonexistent image", () => {
    try {
      runCli(
        ["--json", "screenshot", "ingest", "/nonexistent/image.png", "Fail"],
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
    const imgPath = path.join(outsideDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");
    try {
      runCli(["--json", "screenshot", "ingest", imgPath, "Test"], outsideDir);
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});
