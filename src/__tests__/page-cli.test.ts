import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { runCli, runCliFail } from "./harness.js";

describe("page CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-page-cli-"));
    // Create a workspace
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("page create daily", () => {
    it("creates a daily page for today and returns JSON", () => {
      const output = runCli(["--json", "page", "create", "daily"], tmpDir);
      const result = JSON.parse(output);
      const today = new Date().toISOString().split("T")[0];

      expect(result.success).toBe(true);
      expect(result.pageType).toBe("daily");
      expect(result.created).toBe(true);
      expect(result.relativePath).toBe(`wiki/daily/${today}.md`);
      expect(
        fs.existsSync(path.join(tmpDir, "wiki", "daily", `${today}.md`))
      ).toBe(true);
    });

    it("creates a daily page for a specific date", () => {
      const output = runCli(
        ["--json", "page", "create", "daily", "2024-03-15"],
        tmpDir
      );
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.relativePath).toBe("wiki/daily/2024-03-15.md");
      expect(
        fs.existsSync(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"))
      ).toBe(true);
    });

    it("daily page has correct frontmatter schema", () => {
      runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "daily", "2024-03-15.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.title).toBe("2024-03-15");
      expect(fm.type).toBe("daily");
      expect(fm.created).toBeDefined();
      expect(fm.morning_brief).toBe(false);
      expect(fm.tasks_touched).toEqual([]);
      expect(fm.projects_touched).toEqual([]);
    });

    it("daily page has correct body sections", () => {
      runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "daily", "2024-03-15.md"),
        "utf-8"
      );

      expect(content).toContain("## Focus");
      expect(content).toContain("## Work log");
      expect(content).toContain("## Completed today");
      expect(content).toContain("## Carried over");
      expect(content).toContain("## Notes & context");
      expect(content).toContain("## Blockers");
    });

    it("rejects duplicate daily page", () => {
      runCli(["--json", "page", "create", "daily", "2024-03-15"], tmpDir);

      const { stdout, status } = runCliFail(
        ["--json", "page", "create", "daily", "2024-03-15"],
        tmpDir
      );
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout || "{}");
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/already exists/i);
    });
  });

  describe("page create task", () => {
    it("creates a task page and returns JSON", () => {
      const output = runCli(
        ["--json", "page", "create", "task", "Fix login bug"],
        tmpDir
      );
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.pageType).toBe("task");
      expect(result.relativePath).toBe("wiki/tasks/fix-login-bug.md");
      expect(
        fs.existsSync(path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"))
      ).toBe(true);
    });

    it("task page has correct frontmatter schema", () => {
      runCli(["--json", "page", "create", "task", "Fix login bug"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.title).toBe("Fix login bug");
      expect(fm.type).toBe("task");
      expect(fm.status).toBe("backlog");
      expect(fm.tags).toEqual([]);
      expect(fm.comment_count).toBe(0);
    });

    it("populates source and ref flags", () => {
      runCli(
        [
          "--json",
          "page",
          "create",
          "task",
          "Fix login bug",
          "--source",
          "jira",
          "--ref",
          "PROJ-123",
        ],
        tmpDir
      );

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.source).toBe("jira");
      expect(fm.ref).toBe("PROJ-123");
    });

    it("populates project flag", () => {
      runCli(
        [
          "--json",
          "page",
          "create",
          "task",
          "Fix login bug",
          "--project",
          "storefront",
        ],
        tmpDir
      );

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.project).toBe("storefront");
    });

    it("project defaults to null when --project not given", () => {
      runCli(["--json", "page", "create", "task", "Fix login bug"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.project).toBeNull();
    });

    it("task page has correct body sections", () => {
      runCli(["--json", "page", "create", "task", "Fix login bug"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"),
        "utf-8"
      );

      expect(content).toContain("## Description");
      expect(content).toContain("## Context");
      expect(content).toContain("## Comments");
      expect(content).toContain("## Activity log");
      expect(content).toContain("## See also");
    });

    it("handles special characters in title for filename", () => {
      const output = runCli(
        ["--json", "page", "create", "task", "Hello, World! (test)"],
        tmpDir
      );
      const result = JSON.parse(output);

      expect(result.relativePath).toBe("wiki/tasks/hello-world-test.md");
    });
  });

  describe("page create project", () => {
    it("creates a project page and returns JSON", () => {
      const output = runCli(
        ["--json", "page", "create", "project", "Q2 Migration"],
        tmpDir
      );
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.pageType).toBe("project");
      expect(result.relativePath).toBe("wiki/projects/q2-migration.md");
      expect(
        fs.existsSync(
          path.join(tmpDir, "wiki", "projects", "q2-migration.md")
        )
      ).toBe(true);
    });

    it("project page has correct frontmatter", () => {
      runCli(["--json", "page", "create", "project", "Q2 Migration"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "projects", "q2-migration.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.title).toBe("Q2 Migration");
      expect(fm.type).toBe("project");
      expect(fm.created).toBeDefined();
    });

    it("project page has correct body sections", () => {
      runCli(["--json", "page", "create", "project", "Q2 Migration"], tmpDir);

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "projects", "q2-migration.md"),
        "utf-8"
      );

      expect(content).toContain("## Description");
      expect(content).toContain("## Tasks");
      expect(content).toContain("## Notes");
    });
  });

  describe("page create meeting", () => {
    it("creates a meeting page with date-prefixed filename", () => {
      const output = runCli(
        [
          "--json",
          "page",
          "create",
          "meeting",
          "Q2 kickoff",
          "--date",
          "2026-05-08",
          "--start",
          "09:00",
          "--end",
          "10:00",
          "--attendees",
          "Ringo, George",
          "--project",
          "storefront",
        ],
        tmpDir
      );
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.pageType).toBe("meeting");
      expect(result.relativePath).toBe(
        "wiki/meetings/2026-05-08-q2-kickoff.md"
      );
    });

    it("meeting page has expected frontmatter", () => {
      runCli(
        [
          "--json",
          "page",
          "create",
          "meeting",
          "Q2 kickoff",
          "--date",
          "2026-05-08",
          "--start",
          "09:00",
          "--end",
          "10:00",
          "--attendees",
          "Ringo, George",
          "--project",
          "storefront",
        ],
        tmpDir
      );

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "meetings", "2026-05-08-q2-kickoff.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.type).toBe("meeting");
      expect(fm.date).toBe("2026-05-08");
      expect(fm.start).toBe("09:00");
      expect(fm.end).toBe("10:00");
      expect(fm.attendees).toEqual(["Ringo", "George"]);
      expect(fm.project).toBe("storefront");
    });

    it("appends the meeting path to the meeting-date's daily page meetings_touched", () => {
      runCli(
        [
          "--json",
          "page",
          "create",
          "meeting",
          "Q2 kickoff",
          "--date",
          "2026-05-08",
        ],
        tmpDir
      );

      const dailyPath = path.join(tmpDir, "wiki", "daily", "2026-05-08.md");
      const dailyContent = fs.readFileSync(dailyPath, "utf-8");
      const fm = parseYaml(dailyContent.match(/^---\n([\s\S]*?)\n---/)![1]);

      expect(fm.meetings_touched).toEqual([
        "wiki/meetings/2026-05-08-q2-kickoff.md",
      ]);
    });

    it("creates the daily page for the meeting date if missing", () => {
      const dailyPath = path.join(tmpDir, "wiki", "daily", "2024-01-15.md");
      expect(fs.existsSync(dailyPath)).toBe(false);

      runCli(
        [
          "--json",
          "page",
          "create",
          "meeting",
          "Backdated note",
          "--date",
          "2024-01-15",
        ],
        tmpDir
      );

      expect(fs.existsSync(dailyPath)).toBe(true);
      const fm = parseYaml(
        fs.readFileSync(dailyPath, "utf-8").match(/^---\n([\s\S]*?)\n---/)![1]
      );
      expect(fm.meetings_touched).toEqual([
        "wiki/meetings/2024-01-15-backdated-note.md",
      ]);
    });
  });

  describe("page create spike", () => {
    it("creates a spike page", () => {
      const output = runCli(
        [
          "--json",
          "page",
          "create",
          "spike",
          "Evaluate Klaviyo",
          "--project",
          "app-audit",
          "--vendor",
          "Klaviyo",
        ],
        tmpDir
      );
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.pageType).toBe("spike");
      expect(result.relativePath).toBe("wiki/spikes/evaluate-klaviyo.md");
    });

    it("spike page has expected frontmatter", () => {
      runCli(
        [
          "--json",
          "page",
          "create",
          "spike",
          "Evaluate Klaviyo",
          "--project",
          "app-audit",
          "--vendor",
          "Klaviyo",
        ],
        tmpDir
      );

      const content = fs.readFileSync(
        path.join(tmpDir, "wiki", "spikes", "evaluate-klaviyo.md"),
        "utf-8"
      );
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const fm = parseYaml(match![1]);

      expect(fm.type).toBe("spike");
      expect(fm.status).toBe("open");
      expect(fm.verdict).toBeNull();
      expect(fm.vendor).toBe("Klaviyo");
      expect(fm.project).toBe("app-audit");
    });

    it("appends the spike path to today's daily page spikes_touched", () => {
      runCli(
        [
          "--json",
          "page",
          "create",
          "spike",
          "Evaluate Klaviyo",
        ],
        tmpDir
      );

      const today = new Date().toISOString().split("T")[0];
      const dailyPath = path.join(tmpDir, "wiki", "daily", `${today}.md`);
      const fm = parseYaml(
        fs.readFileSync(dailyPath, "utf-8").match(/^---\n([\s\S]*?)\n---/)![1]
      );

      expect(fm.spikes_touched).toEqual([
        "wiki/spikes/evaluate-klaviyo.md",
      ]);
      expect(fm.meetings_touched).toEqual([]);
    });
  });
});
