import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  formatWritePreview,
  logWriteAction,
  type WriteAction,
} from "../lib/writeback.js";

describe("formatWritePreview", () => {
  it("includes the action type in the preview", () => {
    const preview = formatWritePreview({
      action: "push",
      backend: "github",
      target: "#42",
      payload: { title: "New issue", description: "Body text" },
    });

    expect(preview).toContain("push");
  });

  it("includes the backend name in the preview", () => {
    const preview = formatWritePreview({
      action: "comment",
      backend: "jira",
      target: "PROJ-123",
      payload: { text: "A comment" },
    });

    expect(preview).toContain("jira");
  });

  it("includes the target reference in the preview", () => {
    const preview = formatWritePreview({
      action: "transition",
      backend: "asana",
      target: "1234567890",
      payload: { status: "done" },
    });

    expect(preview).toContain("1234567890");
  });

  it("includes payload details in the preview", () => {
    const preview = formatWritePreview({
      action: "push",
      backend: "github",
      target: "(new)",
      payload: { title: "Fix login bug", description: "The form crashes" },
    });

    expect(preview).toContain("Fix login bug");
  });

  it("formats as a structured multi-line preview", () => {
    const preview = formatWritePreview({
      action: "comment",
      backend: "github",
      target: "#42",
      payload: { text: "Great work on this!" },
    });

    // Should be multi-line structured output
    const lines = preview.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("handles all valid action types", () => {
    const actions: WriteAction["action"][] = ["push", "comment", "transition"];

    for (const action of actions) {
      const preview = formatWritePreview({
        action,
        backend: "github",
        target: "#1",
        payload: { text: "test" },
      });
      expect(preview).toContain(action);
    }
  });
});

describe("logWriteAction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-writeback-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends an entry to wiki/log.md", () => {
    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "#55",
      payload: { title: "New issue" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("push");
    expect(content).toContain("github");
    expect(content).toContain("#55");
  });

  it("includes the action type in the log entry", () => {
    logWriteAction(tmpDir, {
      action: "comment",
      backend: "jira",
      target: "PROJ-123",
      payload: { text: "Hello" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("comment");
  });

  it("includes the backend name in the log entry", () => {
    logWriteAction(tmpDir, {
      action: "transition",
      backend: "asana",
      target: "12345",
      payload: { status: "done" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("asana");
  });

  it("includes a timestamp in the log entry", () => {
    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "(new)",
      payload: { title: "Test" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const content = fs.readFileSync(logPath, "utf-8");
    // ISO timestamp pattern
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("creates log.md if it does not exist", () => {
    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(false);

    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "#1",
      payload: { title: "Test" },
    });

    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("appends to existing log.md without overwriting", () => {
    const logPath = path.join(tmpDir, "wiki", "log.md");
    fs.writeFileSync(logPath, "# Log\n\n- existing entry\n", "utf-8");

    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "#1",
      payload: { title: "Test" },
    });

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("existing entry");
    expect(content).toContain("push");
  });

  it("returns the log entry string", () => {
    const result = logWriteAction(tmpDir, {
      action: "comment",
      backend: "jira",
      target: "PROJ-1",
      payload: { text: "Note" },
    });

    expect(result.entry).toBeDefined();
    expect(result.entry).toContain("comment");
    expect(result.entry).toContain("jira");
    expect(result.entry).toContain("PROJ-1");
  });
});
