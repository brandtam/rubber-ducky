import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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
    `---\nname: test\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\n---\n\n# Test\n`,
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

  describe("per-status stale thresholds", () => {
    it("uses status-specific threshold when provided", () => {
      createTestWorkspace(tmpDir);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      // in-progress 10d old (would normally be stale at default 7d)
      writePageFile(path.join(tmpDir, "wiki/tasks"), "in-progress.md", {
        title: "WIP",
        type: "task",
        status: "in-progress",
        created: tenDaysAgo,
        updated: tenDaysAgo,
      });

      // blocked 10d old — should be ignored when threshold is 14d
      writePageFile(path.join(tmpDir, "wiki/tasks"), "blocked-task.md", {
        title: "Blocked",
        type: "task",
        status: "blocked",
        created: tenDaysAgo,
        updated: tenDaysAgo,
      });

      const result = runLinter(tmpDir, {
        staleDays: 14,
        staleDaysPerStatus: { "in-progress": 7, blocked: 14 },
      });

      const staleFindings = result.findings.filter((f) => f.rule === "stale-task");
      // in-progress (10d) > 7d threshold → flagged
      // blocked (10d) < 14d threshold → not flagged
      expect(staleFindings.length).toBe(1);
      expect(staleFindings[0].file).toMatch(/in-progress\.md/);
    });

    it("flags tasks across multiple tracked statuses", () => {
      createTestWorkspace(tmpDir);
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      writePageFile(path.join(tmpDir, "wiki/tasks"), "blocked.md", {
        title: "Blocked",
        type: "task",
        status: "blocked",
        created: old,
        updated: old,
      });
      writePageFile(path.join(tmpDir, "wiki/tasks"), "in-review.md", {
        title: "Review",
        type: "task",
        status: "in-review",
        created: old,
        updated: old,
      });

      const result = runLinter(tmpDir, {
        staleDaysPerStatus: { blocked: 27, "in-review": 23 },
      });

      const staleFindings = result.findings.filter((f) => f.rule === "stale-task");
      expect(staleFindings.length).toBe(2);
    });
  });

  describe("brand vocabulary check", () => {
    it("flags brands not in the controlled vocabulary", () => {
      createTestWorkspace(tmpDir);

      // Add a Brands section to UBIQUITOUS_LANGUAGE.md
      fs.appendFileSync(
        path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"),
        `\n## Brands\n\n| Term |\n|------|\n| ANO |\n| CIR |\n| FBW |\n`,
        "utf-8"
      );

      writePageFile(path.join(tmpDir, "wiki/tasks"), "task.md", {
        title: "Test",
        type: "task",
        status: "to-do",
        brands: ["ANO", "GJ"],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const violations = result.findings.filter(
        (f) => f.rule === "vocabulary-violation" && f.message.includes("GJ")
      );

      expect(violations.length).toBe(1);
      expect(violations[0].message).toContain("Brand");
    });

    it("does not flag brands when no Brands section is defined", () => {
      createTestWorkspace(tmpDir);

      writePageFile(path.join(tmpDir, "wiki/tasks"), "task.md", {
        title: "Test",
        type: "task",
        status: "to-do",
        brands: ["UNKNOWN"],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const brandViolations = result.findings.filter(
        (f) => f.rule === "vocabulary-violation" && f.message.includes("Brand")
      );

      expect(brandViolations.length).toBe(0);
    });
  });

  describe("ASAP hygiene", () => {
    it("does nothing when asap.md is absent", () => {
      createTestWorkspace(tmpDir);
      const result = runLinter(tmpDir, { checkAsapHygiene: true });
      const asap = result.findings.filter((f) => f.rule.startsWith("asap-"));
      expect(asap.length).toBe(0);
    });

    it("does nothing when checkAsapHygiene is off (default)", () => {
      createTestWorkspace(tmpDir);
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(
        path.join(tmpDir, "wiki/asap.md"),
        `# ASAP\n\n- [ ] ${old} — Old item\n`,
        "utf-8"
      );

      const result = runLinter(tmpDir);
      const asap = result.findings.filter((f) => f.rule.startsWith("asap-"));
      expect(asap.length).toBe(0);
    });

    it("flags stale unresolved ASAP items", () => {
      createTestWorkspace(tmpDir);
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(
        path.join(tmpDir, "wiki/asap.md"),
        `# ASAP\n\n- [ ] ${old} — Forgotten thing\n`,
        "utf-8"
      );

      const result = runLinter(tmpDir, { checkAsapHygiene: true });
      const stale = result.findings.filter((f) => f.rule === "asap-stale");
      expect(stale.length).toBe(1);
      expect(stale[0].message).toContain("Forgotten thing");
    });

    it("flags malformed lines", () => {
      createTestWorkspace(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, "wiki/asap.md"),
        `# ASAP\n\n- [?] not a valid checkbox\n`,
        "utf-8"
      );

      const result = runLinter(tmpDir, { checkAsapHygiene: true });
      const malformed = result.findings.filter((f) => f.rule === "asap-format");
      expect(malformed.length).toBe(1);
    });

    it("emits progress-rot info when resolved items accumulate", () => {
      createTestWorkspace(tmpDir);
      const recent = new Date().toISOString();
      const lines = [
        "# ASAP",
        "",
        `- [x] ${recent} — A (resolved: ${recent})`,
        `- [x] ${recent} — B (resolved: ${recent})`,
        `- [x] ${recent} — C (resolved: ${recent})`,
        `- [ ] ${recent} — D`,
      ];
      fs.writeFileSync(path.join(tmpDir, "wiki/asap.md"), lines.join("\n") + "\n", "utf-8");

      const result = runLinter(tmpDir, { checkAsapHygiene: true });
      const rot = result.findings.filter((f) => f.rule === "asap-progress-rot");
      expect(rot.length).toBe(1);
    });

    it("respects custom asapStaleDays threshold", () => {
      createTestWorkspace(tmpDir);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(
        path.join(tmpDir, "wiki/asap.md"),
        `# ASAP\n\n- [ ] ${sevenDaysAgo} — Recent\n`,
        "utf-8"
      );

      // 14d threshold (default): 7d old → not stale
      const r1 = runLinter(tmpDir, { checkAsapHygiene: true });
      expect(r1.findings.filter((f) => f.rule === "asap-stale").length).toBe(0);

      // 3d threshold: 7d old → stale
      const r2 = runLinter(tmpDir, { checkAsapHygiene: true, asapStaleDays: 3 });
      expect(r2.findings.filter((f) => f.rule === "asap-stale").length).toBe(1);
    });
  });

  describe("orphan-by-status toggle", () => {
    it("default behavior: emits orphan-page rule for all unlinked pages", () => {
      createTestWorkspace(tmpDir);

      writePageFile(path.join(tmpDir, "wiki/tasks"), "active.md", {
        title: "Active",
        type: "task",
        status: "in-progress",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      writePageFile(path.join(tmpDir, "wiki/tasks"), "closed.md", {
        title: "Closed",
        type: "task",
        status: "done",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir);
      const orphans = result.findings.filter((f) =>
        f.rule.startsWith("orphan-page")
      );
      expect(orphans.length).toBe(2);
      // All emit the unified rule by default
      expect(orphans.every((f) => f.rule === "orphan-page")).toBe(true);
    });

    it("with splitOrphansByStatus, splits done from active", () => {
      createTestWorkspace(tmpDir);

      writePageFile(path.join(tmpDir, "wiki/tasks"), "active.md", {
        title: "Active",
        type: "task",
        status: "in-progress",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });
      writePageFile(path.join(tmpDir, "wiki/tasks"), "closed.md", {
        title: "Closed",
        type: "task",
        status: "done",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      });

      const result = runLinter(tmpDir, { splitOrphansByStatus: true });
      const active = result.findings.filter((f) => f.rule === "orphan-page-active");
      const done = result.findings.filter((f) => f.rule === "orphan-page-done");

      expect(active.length).toBe(1);
      expect(active[0].file).toMatch(/active\.md/);
      expect(done.length).toBe(1);
      expect(done[0].file).toMatch(/closed\.md/);
    });
  });

  describe("empty daily page check", () => {
    it("flags daily pages with morning_brief set but no task wikilinks", () => {
      createTestWorkspace(tmpDir);

      writePageFile(
        path.join(tmpDir, "wiki/daily"),
        "2026-05-08.md",
        {
          title: "2026-05-08",
          type: "daily",
          created: new Date().toISOString(),
          morning_brief: "2026-05-08",
          tasks_touched: [],
        },
        "## Focus\n\n## Work log\n\nWent to a meeting.\n"
      );

      const result = runLinter(tmpDir);
      const findings = result.findings.filter((f) => f.rule === "empty-daily-page");

      expect(findings.length).toBe(1);
    });

    it("does not flag fresh daily pages (no morning_brief, no wrap_up)", () => {
      createTestWorkspace(tmpDir);

      writePageFile(
        path.join(tmpDir, "wiki/daily"),
        "2026-05-08.md",
        {
          title: "2026-05-08",
          type: "daily",
          created: new Date().toISOString(),
          morning_brief: false,
          wrap_up: false,
          tasks_touched: [],
        }
      );

      const result = runLinter(tmpDir);
      const findings = result.findings.filter((f) => f.rule === "empty-daily-page");

      expect(findings.length).toBe(0);
    });

    it("does not flag daily pages with task wikilinks", () => {
      createTestWorkspace(tmpDir);

      writePageFile(
        path.join(tmpDir, "wiki/tasks"),
        "task-1.md",
        {
          title: "Task 1",
          type: "task",
          status: "to-do",
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        }
      );

      writePageFile(
        path.join(tmpDir, "wiki/daily"),
        "2026-05-08.md",
        {
          title: "2026-05-08",
          type: "daily",
          created: new Date().toISOString(),
          morning_brief: "2026-05-08",
          tasks_touched: [],
        },
        "## Work log\n\n[[wiki/tasks/task-1]]\n"
      );

      const result = runLinter(tmpDir);
      const findings = result.findings.filter((f) => f.rule === "empty-daily-page");

      expect(findings.length).toBe(0);
    });
  });
});
