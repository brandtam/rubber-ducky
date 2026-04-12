import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stringify as yamlStringify } from "yaml";
import { runLinter, type LintFinding, type LintResult } from "../lib/linter.js";

function writePageFile(dir: string, filename: string, frontmatter: Record<string, unknown>, body?: string): void {
  const yaml = yamlStringify(frontmatter).trimEnd();
  const content = `---\n${yaml}\n---\n${body ?? ""}\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, "utf-8");
}

function createTestWorkspace(tmpDir: string): string {
  const dirs = ["wiki/daily", "wiki/tasks", "wiki/projects", "raw"];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
  }

  // workspace.md
  fs.writeFileSync(
    path.join(tmpDir, "workspace.md"),
    `---\nname: test\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\nbackends: []\n---\n\n# Test\n`,
    "utf-8"
  );

  // UBIQUITOUS_LANGUAGE.md with labels table
  fs.writeFileSync(
    path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"),
    `# Ubiquitous Language

## Statuses

| Term | Meaning |
|------|---------|
| backlog | Not yet scheduled |
| to-do | Scheduled, not started |
| in-progress | Actively being worked on |
| done | Completed |

## Labels

| Term |
|------|
| frontend |
| backend |
| urgent |
`,
    "utf-8"
  );

  return tmpDir;
}

describe("Linter module", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-linter-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("stale task detection", () => {
    it("detects tasks in-progress with no recent update", () => {
      createTestWorkspace(tmpDir);
      const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      writePageFile(path.join(tmpDir, "wiki/tasks"), "old-task.md", {
        title: "Old task",
        type: "task",
        status: "in-progress",
        created: staleDate,
        updated: staleDate,
      });

      const result = runLinter(tmpDir);
      const staleFindings = result.findings.filter((f: LintFinding) => f.rule === "stale-task");

      expect(staleFindings.length).toBe(1);
      expect(staleFindings[0].severity).toBe("warning");
      expect(staleFindings[0].file).toMatch(/old-task\.md/);
    });

    it("does not flag recently updated in-progress tasks", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "fresh-task.md", {
        title: "Fresh task",
        type: "task",
        status: "in-progress",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const staleFindings = result.findings.filter((f: LintFinding) => f.rule === "stale-task");
      expect(staleFindings.length).toBe(0);
    });

    it("does not flag done tasks even if old", () => {
      createTestWorkspace(tmpDir);
      const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      writePageFile(path.join(tmpDir, "wiki/tasks"), "done-task.md", {
        title: "Done task",
        type: "task",
        status: "done",
        created: staleDate,
        updated: staleDate,
      });

      const result = runLinter(tmpDir);
      const staleFindings = result.findings.filter((f: LintFinding) => f.rule === "stale-task");
      expect(staleFindings.length).toBe(0);
    });
  });

  describe("orphan page detection", () => {
    it("detects pages not linked from any other page", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "linked-task.md", {
        title: "Linked task",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      writePageFile(path.join(tmpDir, "wiki/tasks"), "orphan-task.md", {
        title: "Orphan task",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      // Create an index that links to linked-task but not orphan-task
      fs.writeFileSync(
        path.join(tmpDir, "wiki/index.md"),
        "# Index\n\n[[wiki/tasks/linked-task.md|Linked task]]\n",
        "utf-8"
      );

      const result = runLinter(tmpDir);
      const orphanFindings = result.findings.filter((f: LintFinding) => f.rule === "orphan-page");

      expect(orphanFindings.length).toBe(1);
      expect(orphanFindings[0].file).toMatch(/orphan-task\.md/);
      expect(orphanFindings[0].severity).toBe("warning");
    });

    it("does not flag pages that are linked", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "my-task.md", {
        title: "My task",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      // Link from daily page
      writePageFile(path.join(tmpDir, "wiki/daily"), "2024-01-01.md", {
        title: "2024-01-01",
        type: "daily",
        created: new Date().toISOString(),
      }, "\n[[wiki/tasks/my-task.md|My task]]\n");

      const result = runLinter(tmpDir);
      const orphanFindings = result.findings.filter((f: LintFinding) => f.rule === "orphan-page");
      // my-task is linked, daily page might be orphan (no link to it) — but daily pages shouldn't be flagged
      const taskOrphans = orphanFindings.filter((f: LintFinding) => f.file?.includes("my-task"));
      expect(taskOrphans.length).toBe(0);
    });
  });

  describe("broken wikilink detection", () => {
    it("detects wikilinks pointing to non-existent pages", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "task-with-broken-link.md", {
        title: "Task with broken link",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      }, "\nSee also: [[wiki/tasks/nonexistent.md|Gone task]]\n");

      const result = runLinter(tmpDir);
      const brokenFindings = result.findings.filter((f: LintFinding) => f.rule === "broken-wikilink");

      expect(brokenFindings.length).toBe(1);
      expect(brokenFindings[0].severity).toBe("error");
      expect(brokenFindings[0].message).toMatch(/nonexistent/);
    });

    it("does not flag valid wikilinks", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "target.md", {
        title: "Target",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      writePageFile(path.join(tmpDir, "wiki/tasks"), "source.md", {
        title: "Source",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      }, "\nSee: [[wiki/tasks/target.md|Target]]\n");

      const result = runLinter(tmpDir);
      const brokenFindings = result.findings.filter((f: LintFinding) => f.rule === "broken-wikilink");
      expect(brokenFindings.length).toBe(0);
    });
  });

  describe("frontmatter validation", () => {
    it("detects missing required frontmatter fields", () => {
      createTestWorkspace(tmpDir);
      // Task page with missing status
      const tasksDir = path.join(tmpDir, "wiki/tasks");
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, "bad-task.md"),
        "---\ntitle: Bad task\ntype: task\ncreated: 2024-01-01\n---\n",
        "utf-8"
      );

      const result = runLinter(tmpDir);
      const fmFindings = result.findings.filter((f: LintFinding) => f.rule === "frontmatter-error");

      expect(fmFindings.length).toBeGreaterThan(0);
      expect(fmFindings[0].severity).toBe("error");
      expect(fmFindings[0].message).toMatch(/status/i);
    });

    it("detects invalid status values", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "bad-status.md", {
        title: "Bad status",
        type: "task",
        status: "invalid-status",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const fmFindings = result.findings.filter((f: LintFinding) => f.rule === "frontmatter-error");

      expect(fmFindings.length).toBeGreaterThan(0);
      expect(fmFindings[0].message).toMatch(/status/i);
    });

    it("passes for valid frontmatter", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "good-task.md", {
        title: "Good task",
        type: "task",
        status: "to-do",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const fmFindings = result.findings.filter(
        (f: LintFinding) => f.rule === "frontmatter-error" && f.file?.includes("good-task")
      );
      expect(fmFindings.length).toBe(0);
    });
  });

  describe("vocabulary enforcement", () => {
    it("detects tags not in the controlled vocabulary", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "bad-tags.md", {
        title: "Task with bad tags",
        type: "task",
        status: "to-do",
        tags: ["frontend", "unknown-tag"],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const vocabFindings = result.findings.filter((f: LintFinding) => f.rule === "vocabulary-violation");

      expect(vocabFindings.length).toBe(1);
      expect(vocabFindings[0].severity).toBe("warning");
      expect(vocabFindings[0].message).toMatch(/unknown-tag/);
    });

    it("passes for tags in the controlled vocabulary", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "good-tags.md", {
        title: "Task with good tags",
        type: "task",
        status: "to-do",
        tags: ["frontend", "backend"],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const vocabFindings = result.findings.filter(
        (f: LintFinding) => f.rule === "vocabulary-violation" && f.file?.includes("good-tags")
      );
      expect(vocabFindings.length).toBe(0);
    });

    it("skips vocabulary check when UBIQUITOUS_LANGUAGE.md has no labels", () => {
      createTestWorkspace(tmpDir);
      // Overwrite with no labels table
      fs.writeFileSync(
        path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"),
        "# Ubiquitous Language\n\n## Statuses\n\nSome content here.\n",
        "utf-8"
      );

      writePageFile(path.join(tmpDir, "wiki/tasks"), "any-tags.md", {
        title: "Any tags ok",
        type: "task",
        status: "to-do",
        tags: ["anything-goes"],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const vocabFindings = result.findings.filter(
        (f: LintFinding) => f.rule === "vocabulary-violation" && f.file?.includes("any-tags")
      );
      expect(vocabFindings.length).toBe(0);
    });
  });

  describe("backend drift detection", () => {
    it("detects status mismatch between wiki and backend", () => {
      createTestWorkspace(tmpDir);
      // Configure a github backend
      fs.writeFileSync(
        path.join(tmpDir, "workspace.md"),
        `---\nname: test\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\nbackends:\n  - type: github\n    mcp_server: github\n---\n\n# Test\n`,
        "utf-8"
      );

      writePageFile(path.join(tmpDir, "wiki/tasks"), "drifted-task.md", {
        title: "Drifted task",
        type: "task",
        status: "in-progress",
        gh_ref: "https://github.com/owner/repo/issues/1",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      // Mock backend returns CLOSED issue (done), but wiki says in-progress
      const mockExec = (args: string[]): string => {
        if (args[0] === "issue" && args[1] === "view") {
          return JSON.stringify({
            number: 1,
            title: "Drifted task",
            body: "",
            state: "CLOSED",
            url: "https://github.com/owner/repo/issues/1",
            labels: [],
            comments: [],
          });
        }
        if (args[0] === "auth") return "account testuser";
        return "";
      };

      const result = runLinter(tmpDir, { backendExec: mockExec });
      const driftFindings = result.findings.filter((f: LintFinding) => f.rule === "backend-drift");

      expect(driftFindings.length).toBe(1);
      expect(driftFindings[0].severity).toBe("warning");
      expect(driftFindings[0].message).toMatch(/status mismatch/i);
    });

    it("detects new comments not yet ingested", () => {
      createTestWorkspace(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "workspace.md"),
        `---\nname: test\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\nbackends:\n  - type: github\n    mcp_server: github\n---\n\n# Test\n`,
        "utf-8"
      );

      writePageFile(path.join(tmpDir, "wiki/tasks"), "comments-task.md", {
        title: "Comments task",
        type: "task",
        status: "to-do",
        gh_ref: "https://github.com/owner/repo/issues/2",
        comment_count: 1,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const mockExec = (args: string[]): string => {
        if (args[0] === "issue" && args[1] === "view") {
          return JSON.stringify({
            number: 2,
            title: "Comments task",
            body: "",
            state: "OPEN",
            url: "https://github.com/owner/repo/issues/2",
            labels: [],
            comments: [
              { body: "first", author: { login: "user" }, createdAt: "2024-01-01" },
              { body: "second", author: { login: "user" }, createdAt: "2024-01-02" },
              { body: "third", author: { login: "user" }, createdAt: "2024-01-03" },
            ],
          });
        }
        if (args[0] === "auth") return "account testuser";
        return "";
      };

      const result = runLinter(tmpDir, { backendExec: mockExec });
      const driftFindings = result.findings.filter((f: LintFinding) => f.rule === "backend-drift");

      expect(driftFindings.some((f: LintFinding) => f.message.match(/comment/i))).toBe(true);
    });

    it("skips backend drift when no backends configured", () => {
      createTestWorkspace(tmpDir);
      writePageFile(path.join(tmpDir, "wiki/tasks"), "task.md", {
        title: "Task",
        type: "task",
        status: "to-do",
        gh_ref: "https://github.com/owner/repo/issues/1",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const driftFindings = result.findings.filter((f: LintFinding) => f.rule === "backend-drift");
      expect(driftFindings.length).toBe(0);
    });
  });

  describe("result structure", () => {
    it("groups findings by severity", () => {
      createTestWorkspace(tmpDir);
      const result = runLinter(tmpDir);

      expect(result).toHaveProperty("findings");
      expect(result).toHaveProperty("summary");
      expect(result.summary).toHaveProperty("errors");
      expect(result.summary).toHaveProperty("warnings");
      expect(result.summary).toHaveProperty("info");
    });

    it("returns clean result for a healthy workspace", () => {
      createTestWorkspace(tmpDir);
      const result = runLinter(tmpDir);

      expect(result.findings.length).toBe(0);
      expect(result.summary.errors).toBe(0);
      expect(result.summary.warnings).toBe(0);
    });
  });
});
