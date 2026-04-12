import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getBundledTemplates,
  scanWorkspace,
  generateDiff,
  applyFileUpdate,
  type FileComparison,
} from "../lib/update.js";

describe("getBundledTemplates", () => {
  it("returns an array of bundled templates", () => {
    const templates = getBundledTemplates();

    expect(templates).toBeInstanceOf(Array);
    expect(templates.length).toBeGreaterThan(0);
  });

  it("each template has relativePath, content, and description", () => {
    const templates = getBundledTemplates();

    for (const t of templates) {
      expect(t.relativePath).toBeDefined();
      expect(typeof t.relativePath).toBe("string");
      expect(t.content).toBeDefined();
      expect(typeof t.content).toBe("string");
      expect(t.content.length).toBeGreaterThan(0);
      expect(t.description).toBeDefined();
      expect(typeof t.description).toBe("string");
    }
  });

  it("all template paths are under .claude/commands/ or .claude/agents/", () => {
    const templates = getBundledTemplates();

    for (const t of templates) {
      const valid =
        t.relativePath.startsWith(".claude/commands/") ||
        t.relativePath.startsWith(".claude/agents/");
      expect(valid, `unexpected path: ${t.relativePath}`).toBe(true);
    }
  });
});

describe("scanWorkspace", () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-update-test-"));
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeBundledFile(relativePath: string, content: string): void {
    const fullPath = path.join(workspacePath, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  it("marks files as 'new' when they don't exist locally", () => {
    const result = scanWorkspace(workspacePath);

    expect(result.newFiles.length).toBeGreaterThan(0);
    for (const f of result.newFiles) {
      expect(f.status).toBe("new");
      expect(f.localContent).toBeNull();
    }
  });

  it("marks files as 'unchanged' when local matches bundled", () => {
    const templates = getBundledTemplates();
    for (const t of templates) {
      writeBundledFile(t.relativePath, t.content);
    }

    const result = scanWorkspace(workspacePath);

    expect(result.unchanged.length).toBe(templates.length);
    expect(result.modified.length).toBe(0);
    expect(result.newFiles.length).toBe(0);
  });

  it("marks files as 'modified' when local differs from bundled", () => {
    const templates = getBundledTemplates();
    // Write all files but modify the first one
    for (const t of templates) {
      writeBundledFile(t.relativePath, t.content);
    }
    const firstTemplate = templates[0];
    writeBundledFile(firstTemplate.relativePath, firstTemplate.content + "\n\n<!-- user customization -->");

    const result = scanWorkspace(workspacePath);

    expect(result.modified.length).toBe(1);
    expect(result.modified[0].relativePath).toBe(firstTemplate.relativePath);
    expect(result.modified[0].status).toBe("modified");
    expect(result.modified[0].diff).not.toBeNull();
  });

  it("returns comparisons array with all files", () => {
    const templates = getBundledTemplates();
    const result = scanWorkspace(workspacePath);

    expect(result.comparisons.length).toBe(templates.length);
    expect(result.comparisons.length).toBe(
      result.unchanged.length + result.modified.length + result.newFiles.length
    );
  });

  it("includes bundled content in all comparisons", () => {
    const result = scanWorkspace(workspacePath);

    for (const c of result.comparisons) {
      expect(c.bundledContent).toBeDefined();
      expect(c.bundledContent.length).toBeGreaterThan(0);
    }
  });

  it("includes description from template in comparisons", () => {
    const result = scanWorkspace(workspacePath);

    for (const c of result.comparisons) {
      expect(c.description).toBeDefined();
      expect(typeof c.description).toBe("string");
    }
  });
});

describe("generateDiff", () => {
  it("returns empty string for identical content", () => {
    const diff = generateDiff("hello\nworld", "hello\nworld");
    expect(diff).toBe("");
  });

  it("shows added lines with + prefix", () => {
    const diff = generateDiff("hello", "hello\nworld");

    expect(diff).toContain("+world");
  });

  it("shows removed lines with - prefix", () => {
    const diff = generateDiff("hello\nworld", "hello");

    expect(diff).toContain("-world");
  });

  it("shows context lines with space prefix", () => {
    const diff = generateDiff("hello\nold\nworld", "hello\nnew\nworld");

    expect(diff).toContain(" hello");
    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
    expect(diff).toContain(" world");
  });

  it("handles completely different content", () => {
    const diff = generateDiff("aaa\nbbb", "ccc\nddd");

    expect(diff).toContain("-aaa");
    expect(diff).toContain("-bbb");
    expect(diff).toContain("+ccc");
    expect(diff).toContain("+ddd");
  });

  it("handles empty local content", () => {
    const diff = generateDiff("", "hello\nworld");

    expect(diff).toContain("+hello");
    expect(diff).toContain("+world");
  });
});

describe("applyFileUpdate", () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-apply-test-"));
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("overwrites local file with bundled content when action is 'overwrite'", () => {
    const relPath = ".claude/commands/test.md";
    const fullPath = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "old content", "utf-8");

    const result = applyFileUpdate(workspacePath, relPath, "new content", "overwrite");

    expect(result.applied).toBe(true);
    expect(result.action).toBe("overwrite");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("new content");
  });

  it("creates new file when action is 'overwrite' and file does not exist", () => {
    const relPath = ".claude/commands/new-skill.md";
    const fullPath = path.join(workspacePath, relPath);

    const result = applyFileUpdate(workspacePath, relPath, "skill content", "overwrite");

    expect(result.applied).toBe(true);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("skill content");
  });

  it("does not modify file when action is 'keep'", () => {
    const relPath = ".claude/commands/test.md";
    const fullPath = path.join(workspacePath, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, "user content", "utf-8");

    const result = applyFileUpdate(workspacePath, relPath, "new content", "keep");

    expect(result.applied).toBe(false);
    expect(result.action).toBe("keep");
    expect(fs.readFileSync(fullPath, "utf-8")).toBe("user content");
  });

  it("does not create file when action is 'skip'", () => {
    const relPath = ".claude/commands/skipped.md";
    const fullPath = path.join(workspacePath, relPath);

    const result = applyFileUpdate(workspacePath, relPath, "content", "skip");

    expect(result.applied).toBe(false);
    expect(result.action).toBe("skip");
    expect(fs.existsSync(fullPath)).toBe(false);
  });
});
