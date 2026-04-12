import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  slugify,
  generateDailyPage,
  generateTaskPage,
  generateProjectPage,
  createPage,
} from "../lib/page.js";
import { parseFrontmatter, validateFrontmatter } from "../lib/frontmatter.js";

describe("slugify", () => {
  it("converts a simple title to lowercase kebab-case", () => {
    expect(slugify("Fix login bug")).toBe("fix-login-bug");
  });

  it("handles special characters", () => {
    expect(slugify("Hello, World! (test)")).toBe("hello-world-test");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("handles slashes", () => {
    expect(slugify("Q2/Q3 Migration")).toBe("q2-q3-migration");
  });

  it("handles numbers", () => {
    expect(slugify("Issue #42")).toBe("issue-42");
  });

  it("handles unicode characters", () => {
    expect(slugify("café résumé")).toBe("caf-r-sum");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });
});

describe("generateDailyPage", () => {
  it("generates a daily page for today by default", () => {
    const result = generateDailyPage();
    const today = new Date().toISOString().split("T")[0];

    expect(result.filename).toBe(`${today}.md`);
    expect(result.directory).toBe("wiki/daily");
  });

  it("generates a daily page for a specific date", () => {
    const result = generateDailyPage("2024-03-15");

    expect(result.filename).toBe("2024-03-15.md");
    expect(result.directory).toBe("wiki/daily");
  });

  it("has valid frontmatter with required fields", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);

    expect(parsed).not.toBeNull();
    expect(parsed!.data.title).toBe("2024-03-15");
    expect(parsed!.data.type).toBe("daily");
    expect(parsed!.data.created).toBeDefined();
  });

  it("includes all daily frontmatter fields", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data).toHaveProperty("title");
    expect(parsed!.data).toHaveProperty("type");
    expect(parsed!.data).toHaveProperty("created");
    expect(parsed!.data).toHaveProperty("updated");
    expect(parsed!.data).toHaveProperty("active_task");
    expect(parsed!.data).toHaveProperty("morning_brief");
    expect(parsed!.data).toHaveProperty("wrap_up");
    expect(parsed!.data).toHaveProperty("tasks_touched");
  });

  it("has wrap_up defaulting to false", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.wrap_up).toBe(false);
  });

  it("passes frontmatter validation for daily type", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "daily");

    expect(errors).toEqual([]);
  });

  it("includes all body sections", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Focus");
    expect(parsed!.body).toContain("## Work log");
    expect(parsed!.body).toContain("## Completed today");
    expect(parsed!.body).toContain("## Carried over");
    expect(parsed!.body).toContain("## Notes & context");
    expect(parsed!.body).toContain("## Blockers");
  });
});

describe("generateTaskPage", () => {
  it("generates a task page with slugified filename", () => {
    const result = generateTaskPage("Fix login bug");

    expect(result.filename).toBe("fix-login-bug.md");
    expect(result.directory).toBe("wiki/tasks");
  });

  it("has valid frontmatter with required fields", () => {
    const result = generateTaskPage("Fix login bug");
    const parsed = parseFrontmatter(result.content);

    expect(parsed).not.toBeNull();
    expect(parsed!.data.title).toBe("Fix login bug");
    expect(parsed!.data.type).toBe("task");
    expect(parsed!.data.status).toBe("backlog");
    expect(parsed!.data.created).toBeDefined();
  });

  it("includes all task frontmatter fields", () => {
    const result = generateTaskPage("Fix login bug");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data).toHaveProperty("title");
    expect(parsed!.data).toHaveProperty("type");
    expect(parsed!.data).toHaveProperty("ref");
    expect(parsed!.data).toHaveProperty("source");
    expect(parsed!.data).toHaveProperty("status");
    expect(parsed!.data).toHaveProperty("priority");
    expect(parsed!.data).toHaveProperty("assignee");
    expect(parsed!.data).toHaveProperty("tags");
    expect(parsed!.data).toHaveProperty("created");
    expect(parsed!.data).toHaveProperty("updated");
    expect(parsed!.data).toHaveProperty("closed");
    expect(parsed!.data).toHaveProperty("pushed");
    expect(parsed!.data).toHaveProperty("due");
    expect(parsed!.data).toHaveProperty("jira_ref");
    expect(parsed!.data).toHaveProperty("asana_ref");
    expect(parsed!.data).toHaveProperty("gh_ref");
    expect(parsed!.data).toHaveProperty("comment_count");
  });

  it("passes frontmatter validation for task type", () => {
    const result = generateTaskPage("Fix login bug");
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "task");

    expect(errors).toEqual([]);
  });

  it("populates source and ref from options", () => {
    const result = generateTaskPage("Fix login bug", {
      source: "jira",
      ref: "PROJ-123",
    });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.source).toBe("jira");
    expect(parsed!.data.ref).toBe("PROJ-123");
  });

  it("includes all body sections", () => {
    const result = generateTaskPage("Fix login bug");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Description");
    expect(parsed!.body).toContain("## Context");
    expect(parsed!.body).toContain("## Comments");
    expect(parsed!.body).toContain("## Activity log");
    expect(parsed!.body).toContain("## See also");
  });
});

describe("generateProjectPage", () => {
  it("generates a project page with slugified filename", () => {
    const result = generateProjectPage("Q2 Migration");

    expect(result.filename).toBe("q2-migration.md");
    expect(result.directory).toBe("wiki/projects");
  });

  it("has valid frontmatter with required fields", () => {
    const result = generateProjectPage("Q2 Migration");
    const parsed = parseFrontmatter(result.content);

    expect(parsed).not.toBeNull();
    expect(parsed!.data.title).toBe("Q2 Migration");
    expect(parsed!.data.type).toBe("project");
    expect(parsed!.data.created).toBeDefined();
  });

  it("passes frontmatter validation for project type", () => {
    const result = generateProjectPage("Q2 Migration");
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "project");

    expect(errors).toEqual([]);
  });

  it("includes body sections for grouping tasks", () => {
    const result = generateProjectPage("Q2 Migration");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Description");
    expect(parsed!.body).toContain("## Tasks");
    expect(parsed!.body).toContain("## Notes");
  });
});

describe("createPage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-page-test-"));
    // Create workspace structure
    fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });
    // Create workspace.md so it's a valid workspace
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a daily page file on disk", () => {
    const result = createPage(tmpDir, "daily");
    const today = new Date().toISOString().split("T")[0];

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "daily", `${today}.md`));
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("creates a daily page for a specific date", () => {
    const result = createPage(tmpDir, "daily", { date: "2024-03-15" });

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "daily", "2024-03-15.md"));
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("creates a task page file on disk", () => {
    const result = createPage(tmpDir, "task", { title: "Fix login bug" });

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"));
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("creates a project page file on disk", () => {
    const result = createPage(tmpDir, "project", { title: "Q2 Migration" });

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "projects", "q2-migration.md"));
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("prevents duplicate page creation", () => {
    createPage(tmpDir, "daily", { date: "2024-03-15" });

    expect(() => {
      createPage(tmpDir, "daily", { date: "2024-03-15" });
    }).toThrow(/already exists/);
  });

  it("prevents duplicate task page creation", () => {
    createPage(tmpDir, "task", { title: "Fix login bug" });

    expect(() => {
      createPage(tmpDir, "task", { title: "Fix login bug" });
    }).toThrow(/already exists/);
  });

  it("written daily page content matches generated template", () => {
    const result = createPage(tmpDir, "daily", { date: "2024-03-15" });
    const content = fs.readFileSync(result.filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    expect(parsed!.data.type).toBe("daily");
    expect(parsed!.data.title).toBe("2024-03-15");
    expect(parsed!.body).toContain("## Focus");
  });

  it("written task page populates source and ref", () => {
    const result = createPage(tmpDir, "task", {
      title: "Fix login bug",
      source: "jira",
      ref: "PROJ-123",
    });
    const content = fs.readFileSync(result.filePath, "utf-8");
    const parsed = parseFrontmatter(content);

    expect(parsed!.data.source).toBe("jira");
    expect(parsed!.data.ref).toBe("PROJ-123");
  });
});
