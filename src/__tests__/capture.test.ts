import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  addAsap,
  listAsap,
  resolveAsap,
  addReminder,
  listReminders,
  resolveReminder,
  addIdea,
  listIdeas,
  ingestScreenshot,
} from "../lib/capture.js";

describe("addAsap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates asap.md if it does not exist", () => {
    addAsap(tmpDir, "Buy groceries");
    expect(fs.existsSync(path.join(tmpDir, "wiki", "asap.md"))).toBe(true);
  });

  it("adds an item with a timestamp", () => {
    const result = addAsap(tmpDir, "Buy groceries");

    expect(result.message).toBe("Buy groceries");
    expect(result.index).toBe(1);
    expect(result.relativePath).toBe("wiki/asap.md");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "asap.md"), "utf-8");
    expect(content).toContain("- [ ]");
    expect(content).toContain("Buy groceries");
  });

  it("assigns sequential indices to items", () => {
    const r1 = addAsap(tmpDir, "First");
    const r2 = addAsap(tmpDir, "Second");
    const r3 = addAsap(tmpDir, "Third");

    expect(r1.index).toBe(1);
    expect(r2.index).toBe(2);
    expect(r3.index).toBe(3);
  });

  it("includes ISO timestamp in each item", () => {
    addAsap(tmpDir, "Timestamped item");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "asap.md"), "utf-8");
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("preserves header when adding multiple items", () => {
    addAsap(tmpDir, "First");
    addAsap(tmpDir, "Second");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "asap.md"), "utf-8");
    const headerCount = (content.match(/# ASAP/g) || []).length;
    expect(headerCount).toBe(1);
  });
});

describe("listAsap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when asap.md does not exist", () => {
    const result = listAsap(tmpDir);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
  });

  it("returns all items with their indices", () => {
    addAsap(tmpDir, "First");
    addAsap(tmpDir, "Second");

    const result = listAsap(tmpDir);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].index).toBe(1);
    expect(result.items[0].message).toBe("First");
    expect(result.items[0].resolved).toBe(false);
    expect(result.items[1].index).toBe(2);
    expect(result.items[1].message).toBe("Second");
  });

  it("counts pending vs resolved items", () => {
    addAsap(tmpDir, "First");
    addAsap(tmpDir, "Second");
    resolveAsap(tmpDir, 1);

    const result = listAsap(tmpDir);

    expect(result.total).toBe(2);
    expect(result.pending).toBe(1);
  });

  it("includes timestamps on items", () => {
    addAsap(tmpDir, "Timestamped");

    const result = listAsap(tmpDir);

    expect(result.items[0].createdAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("resolveAsap", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks an item as resolved", () => {
    addAsap(tmpDir, "Handle this");

    const result = resolveAsap(tmpDir, 1);

    expect(result.resolved).toBe(true);
    expect(result.message).toBe("Handle this");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "asap.md"), "utf-8");
    expect(content).toContain("- [x]");
    expect(content).not.toContain("- [ ]");
  });

  it("throws when index is out of range", () => {
    addAsap(tmpDir, "Only one");

    expect(() => resolveAsap(tmpDir, 5)).toThrow(/out of range/i);
  });

  it("throws when asap.md does not exist", () => {
    expect(() => resolveAsap(tmpDir, 1)).toThrow(/no asap/i);
  });

  it("throws when item is already resolved", () => {
    addAsap(tmpDir, "Already done");
    resolveAsap(tmpDir, 1);

    expect(() => resolveAsap(tmpDir, 1)).toThrow(/already resolved/i);
  });

  it("resolves a specific item without affecting others", () => {
    addAsap(tmpDir, "First");
    addAsap(tmpDir, "Second");
    addAsap(tmpDir, "Third");

    resolveAsap(tmpDir, 2);

    const result = listAsap(tmpDir);
    expect(result.items[0].resolved).toBe(false);
    expect(result.items[1].resolved).toBe(true);
    expect(result.items[2].resolved).toBe(false);
  });
});

// ── Reminder tests ──────────────────────────────────────────────────────────

describe("addReminder", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates reminders.md if it does not exist", () => {
    addReminder(tmpDir, "2024-04-01", "Follow up with Alice");
    expect(fs.existsSync(path.join(tmpDir, "wiki", "reminders.md"))).toBe(true);
  });

  it("adds a reminder with target date and creation timestamp", () => {
    const result = addReminder(tmpDir, "2024-04-01", "Follow up with Alice");

    expect(result.message).toBe("Follow up with Alice");
    expect(result.date).toBe("2024-04-01");
    expect(result.index).toBe(1);
    expect(result.relativePath).toBe("wiki/reminders.md");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "reminders.md"), "utf-8");
    expect(content).toContain("- [ ]");
    expect(content).toContain("2024-04-01");
    expect(content).toContain("Follow up with Alice");
    expect(content).toContain("created:");
  });

  it("assigns sequential indices to reminders", () => {
    const r1 = addReminder(tmpDir, "2024-04-01", "First");
    const r2 = addReminder(tmpDir, "2024-04-02", "Second");

    expect(r1.index).toBe(1);
    expect(r2.index).toBe(2);
  });

  it("preserves header when adding multiple reminders", () => {
    addReminder(tmpDir, "2024-04-01", "First");
    addReminder(tmpDir, "2024-04-02", "Second");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "reminders.md"), "utf-8");
    const headerCount = (content.match(/# Reminders/g) || []).length;
    expect(headerCount).toBe(1);
  });
});

describe("listReminders", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when reminders.md does not exist", () => {
    const result = listReminders(tmpDir);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
  });

  it("returns all reminders with their indices", () => {
    addReminder(tmpDir, "2024-04-01", "First");
    addReminder(tmpDir, "2024-04-15", "Second");

    const result = listReminders(tmpDir);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].index).toBe(1);
    expect(result.items[0].message).toBe("First");
    expect(result.items[0].date).toBe("2024-04-01");
    expect(result.items[0].resolved).toBe(false);
  });

  it("filters reminders by date", () => {
    addReminder(tmpDir, "2024-04-01", "April first");
    addReminder(tmpDir, "2024-04-15", "April fifteenth");
    addReminder(tmpDir, "2024-04-01", "Also april first");

    const result = listReminders(tmpDir, "2024-04-01");

    expect(result.items).toHaveLength(2);
    expect(result.items[0].message).toBe("April first");
    expect(result.items[1].message).toBe("Also april first");
  });

  it("counts pending vs resolved reminders", () => {
    addReminder(tmpDir, "2024-04-01", "First");
    addReminder(tmpDir, "2024-04-02", "Second");
    resolveReminder(tmpDir, 1);

    const result = listReminders(tmpDir);

    expect(result.total).toBe(2);
    expect(result.pending).toBe(1);
  });

  it("includes creation timestamps on reminders", () => {
    addReminder(tmpDir, "2024-04-01", "Timestamped");

    const result = listReminders(tmpDir);

    expect(result.items[0].createdAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("resolveReminder", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("marks a reminder as resolved", () => {
    addReminder(tmpDir, "2024-04-01", "Follow up");

    const result = resolveReminder(tmpDir, 1);

    expect(result.resolved).toBe(true);
    expect(result.message).toBe("Follow up");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "reminders.md"), "utf-8");
    expect(content).toContain("- [x]");
    expect(content).toContain("resolved:");
  });

  it("throws when index is out of range", () => {
    addReminder(tmpDir, "2024-04-01", "Only one");

    expect(() => resolveReminder(tmpDir, 5)).toThrow(/out of range/i);
  });

  it("throws when reminders.md does not exist", () => {
    expect(() => resolveReminder(tmpDir, 1)).toThrow(/no reminders/i);
  });

  it("throws when reminder is already resolved", () => {
    addReminder(tmpDir, "2024-04-01", "Done");
    resolveReminder(tmpDir, 1);

    expect(() => resolveReminder(tmpDir, 1)).toThrow(/already resolved/i);
  });

  it("resolves a specific reminder without affecting others", () => {
    addReminder(tmpDir, "2024-04-01", "First");
    addReminder(tmpDir, "2024-04-02", "Second");
    addReminder(tmpDir, "2024-04-03", "Third");

    resolveReminder(tmpDir, 2);

    const result = listReminders(tmpDir);
    expect(result.items[0].resolved).toBe(false);
    expect(result.items[1].resolved).toBe(true);
    expect(result.items[2].resolved).toBe(false);
  });
});

// ── Ideas tests ─────────────────────────────────────────────────────────────

describe("addIdea", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates ideas.md if it does not exist", () => {
    addIdea(tmpDir, "Build a CLI tool");
    expect(fs.existsSync(path.join(tmpDir, "wiki", "ideas.md"))).toBe(true);
  });

  it("adds an idea with a timestamp", () => {
    const result = addIdea(tmpDir, "Build a CLI tool");

    expect(result.message).toBe("Build a CLI tool");
    expect(result.index).toBe(1);
    expect(result.relativePath).toBe("wiki/ideas.md");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "ideas.md"), "utf-8");
    expect(content).toContain("Build a CLI tool");
  });

  it("assigns sequential indices to ideas", () => {
    const r1 = addIdea(tmpDir, "First");
    const r2 = addIdea(tmpDir, "Second");

    expect(r1.index).toBe(1);
    expect(r2.index).toBe(2);
  });

  it("preserves header when adding multiple ideas", () => {
    addIdea(tmpDir, "First");
    addIdea(tmpDir, "Second");

    const content = fs.readFileSync(path.join(tmpDir, "wiki", "ideas.md"), "utf-8");
    const headerCount = (content.match(/# Ideas/g) || []).length;
    expect(headerCount).toBe(1);
  });
});

describe("listIdeas", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty list when ideas.md does not exist", () => {
    const result = listIdeas(tmpDir);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns all ideas with their indices", () => {
    addIdea(tmpDir, "First idea");
    addIdea(tmpDir, "Second idea");

    const result = listIdeas(tmpDir);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].index).toBe(1);
    expect(result.items[0].message).toBe("First idea");
    expect(result.items[1].index).toBe(2);
    expect(result.items[1].message).toBe("Second idea");
  });

  it("includes creation timestamps on ideas", () => {
    addIdea(tmpDir, "Timestamped idea");

    const result = listIdeas(tmpDir);

    expect(result.items[0].createdAt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ── Screenshot ingest tests ─────────────────────────────────────────────────

describe("ingestScreenshot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-capture-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "raw"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies screenshot to raw/ directory", () => {
    const imgPath = path.join(tmpDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");

    const result = ingestScreenshot(tmpDir, imgPath, "Bug in login form");

    expect(fs.existsSync(result.rawPath)).toBe(true);
    expect(result.rawRelativePath).toMatch(/^raw\//);
    expect(fs.readFileSync(result.rawPath, "utf-8")).toBe("fake-image-data");
  });

  it("creates a task page for the screenshot", () => {
    const imgPath = path.join(tmpDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");

    const result = ingestScreenshot(tmpDir, imgPath, "Bug in login form");

    expect(fs.existsSync(result.taskPath)).toBe(true);
    expect(result.taskRelativePath).toBe("wiki/tasks/bug-in-login-form.md");

    const content = fs.readFileSync(result.taskPath, "utf-8");
    expect(content).toContain("Bug in login form");
    expect(content).toContain("source: screenshot");
  });

  it("throws when screenshot file does not exist", () => {
    expect(() =>
      ingestScreenshot(tmpDir, "/nonexistent/image.png", "Missing image")
    ).toThrow(/not found/i);
  });

  it("preserves original file extension", () => {
    const imgPath = path.join(tmpDir, "capture.jpg");
    fs.writeFileSync(imgPath, "jpeg-data");

    const result = ingestScreenshot(tmpDir, imgPath, "JPG capture");

    expect(result.rawRelativePath).toContain(".jpg");
  });

  it("returns the title in the result", () => {
    const imgPath = path.join(tmpDir, "screenshot.png");
    fs.writeFileSync(imgPath, "fake-image-data");

    const result = ingestScreenshot(tmpDir, imgPath, "My task title");

    expect(result.title).toBe("My task title");
  });
});
