import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  slugify,
  generateTaskPage,
  generateProjectPage,
  generateMeetingPage,
  generateSpikePage,
  generateWeeklyPage,
  generateRepoPage,
  createPage,
} from "../lib/page.js";
import { generateDailyPage } from "../lib/daily.js";
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
    expect(parsed!.data).toHaveProperty("projects_touched");
    expect(parsed!.data).toHaveProperty("meetings_touched");
    expect(parsed!.data).toHaveProperty("spikes_touched");
  });

  it("has projects_touched defaulting to empty array", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.projects_touched).toEqual([]);
  });

  it("has meetings_touched and spikes_touched defaulting to empty arrays", () => {
    const result = generateDailyPage("2024-03-15");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.meetings_touched).toEqual([]);
    expect(parsed!.data.spikes_touched).toEqual([]);
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
    expect(parsed!.data).toHaveProperty("project");
    expect(parsed!.data).toHaveProperty("comment_count");
  });

  it("project defaults to null", () => {
    const result = generateTaskPage("Fix login bug");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.project).toBeNull();
  });

  it("populates project from options", () => {
    const result = generateTaskPage("Fix login bug", {
      project: "storefront",
    });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.project).toBe("storefront");
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

  it("rejects invalid project status", () => {
    const result = generateProjectPage("Q2 Migration");
    const parsed = parseFrontmatter(result.content);
    const data = { ...parsed!.data, status: "in-progress" };
    const errors = validateFrontmatter(data, "project");

    expect(errors.some((e) => e.field === "status")).toBe(true);
  });

  it("accepts all valid project statuses", () => {
    const result = generateProjectPage("Q2 Migration");
    const parsed = parseFrontmatter(result.content);

    for (const status of ["backlog", "active", "completed", "archived"]) {
      const data = { ...parsed!.data, status };
      const errors = validateFrontmatter(data, "project");
      expect(errors).toEqual([]);
    }
  });

  it("includes body sections for grouping tasks", () => {
    const result = generateProjectPage("Q2 Migration");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Description");
    expect(parsed!.body).toContain("## Tasks");
    expect(parsed!.body).toContain("## Notes");
  });
});

describe("generateMeetingPage", () => {
  it("generates a meeting page with date-prefixed slugified filename", () => {
    const result = generateMeetingPage("Q2 kickoff", { date: "2026-05-08" });

    expect(result.filename).toBe("2026-05-08-q2-kickoff.md");
    expect(result.directory).toBe("wiki/meetings");
  });

  it("has all expected meeting frontmatter fields", () => {
    const result = generateMeetingPage("Q2 kickoff", {
      date: "2026-05-08",
      start: "09:00",
      end: "10:00",
      attendees: ["Ringo", "George"],
      project: "storefront",
    });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.title).toBe("Q2 kickoff");
    expect(parsed!.data.type).toBe("meeting");
    expect(parsed!.data.date).toBe("2026-05-08");
    expect(parsed!.data.start).toBe("09:00");
    expect(parsed!.data.end).toBe("10:00");
    expect(parsed!.data.attendees).toEqual(["Ringo", "George"]);
    expect(parsed!.data.project).toBe("storefront");
  });

  it("passes frontmatter validation for meeting type", () => {
    const result = generateMeetingPage("Q2 kickoff", { date: "2026-05-08" });
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "meeting");

    expect(errors).toEqual([]);
  });

  it("includes meeting body sections", () => {
    const result = generateMeetingPage("Q2 kickoff", { date: "2026-05-08" });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Agenda");
    expect(parsed!.body).toContain("## Notes");
    expect(parsed!.body).toContain("## Decisions");
    expect(parsed!.body).toContain("## Action items");
  });

  it("defaults attendees to empty array", () => {
    const result = generateMeetingPage("Standup", { date: "2026-05-08" });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.attendees).toEqual([]);
  });
});

describe("generateSpikePage", () => {
  it("generates a spike page with slugified filename", () => {
    const result = generateSpikePage("Evaluate Klaviyo");

    expect(result.filename).toBe("evaluate-klaviyo.md");
    expect(result.directory).toBe("wiki/spikes");
  });

  it("has all expected spike frontmatter fields", () => {
    const result = generateSpikePage("Evaluate Klaviyo", {
      project: "app-audit",
      vendor: "Klaviyo",
    });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.title).toBe("Evaluate Klaviyo");
    expect(parsed!.data.type).toBe("spike");
    expect(parsed!.data.status).toBe("open");
    expect(parsed!.data.verdict).toBeNull();
    expect(parsed!.data.vendor).toBe("Klaviyo");
    expect(parsed!.data.project).toBe("app-audit");
  });

  it("passes frontmatter validation when status is open", () => {
    const result = generateSpikePage("Evaluate Klaviyo");
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "spike");

    expect(errors).toEqual([]);
  });

  it("rejects closed spike with no verdict", () => {
    const result = generateSpikePage("Evaluate Klaviyo");
    const parsed = parseFrontmatter(result.content);
    const data = { ...parsed!.data, status: "closed" };
    const errors = validateFrontmatter(data, "spike");

    expect(errors.some((e) => e.field === "verdict")).toBe(true);
  });

  it("accepts closed spike with verdict", () => {
    const result = generateSpikePage("Evaluate Klaviyo");
    const parsed = parseFrontmatter(result.content);
    const data = {
      ...parsed!.data,
      status: "closed",
      verdict: "Not worth it; cost-prohibitive at our scale",
    };
    const errors = validateFrontmatter(data, "spike");

    expect(errors).toEqual([]);
  });

  it("rejects invalid spike status", () => {
    const result = generateSpikePage("Evaluate Klaviyo");
    const parsed = parseFrontmatter(result.content);
    const data = { ...parsed!.data, status: "in-progress" };
    const errors = validateFrontmatter(data, "spike");

    expect(errors.some((e) => e.field === "status")).toBe(true);
  });

  it("includes spike body sections including Verdict", () => {
    const result = generateSpikePage("Evaluate Klaviyo");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Question");
    expect(parsed!.body).toContain("## Approach");
    expect(parsed!.body).toContain("## Findings");
    expect(parsed!.body).toContain("## Verdict");
  });
});

describe("generateWeeklyPage", () => {
  it("defaults period_end to today and filename to the same date", () => {
    const today = new Date().toISOString().split("T")[0];
    const result = generateWeeklyPage();

    expect(result.filename).toBe(`${today}.md`);
    expect(result.directory).toBe("wiki/weekly");
  });

  it("uses --date as period_end and filename when no explicit period_end is set", () => {
    const result = generateWeeklyPage({ date: "2026-05-15" });

    expect(result.filename).toBe("2026-05-15.md");
    const parsed = parseFrontmatter(result.content);
    expect(parsed!.data.period_end).toBe("2026-05-15");
  });

  it("derives period_start as 7 days before period_end when not provided", () => {
    const result = generateWeeklyPage({ periodEnd: "2026-05-15" });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.period_end).toBe("2026-05-15");
    expect(parsed!.data.period_start).toBe("2026-05-08");
  });

  it("respects explicit period_start", () => {
    const result = generateWeeklyPage({
      periodStart: "2026-05-01",
      periodEnd: "2026-05-15",
    });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.period_start).toBe("2026-05-01");
    expect(parsed!.data.period_end).toBe("2026-05-15");
  });

  it("passes frontmatter validation", () => {
    const result = generateWeeklyPage({ periodEnd: "2026-05-15" });
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "weekly");

    expect(errors).toEqual([]);
  });

  it("includes the standard summary body sections", () => {
    const result = generateWeeklyPage({ periodEnd: "2026-05-15" });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Completed & In Review since last summary");
    expect(parsed!.body).toContain("### Theme — Completed");
    expect(parsed!.body).toContain("### Admin — Completed");
    expect(parsed!.body).toContain("## In Progress and Upcoming");
  });
});

describe("generateRepoPage", () => {
  it("generates a repo page with slugified filename", () => {
    const result = generateRepoPage("storefront-web");

    expect(result.filename).toBe("storefront-web.md");
    expect(result.directory).toBe("wiki/repos");
  });

  it("defaults changelog_path to CHANGELOG.md and default_branch to main", () => {
    const result = generateRepoPage("storefront-web", { repo: "acme/storefront-web" });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.type).toBe("repo");
    expect(parsed!.data.repo).toBe("acme/storefront-web");
    expect(parsed!.data.changelog_path).toBe("CHANGELOG.md");
    expect(parsed!.data.default_branch).toBe("main");
    expect(parsed!.data.release_reference_pattern).toBeNull();
  });

  it("respects explicit changelog_path, reference pattern, and branch", () => {
    const result = generateRepoPage("storefront-web", {
      repo: "acme/storefront-web",
      changelogPath: "docs/CHANGES.md",
      releaseReferencePattern: "WEB-\\d+",
      defaultBranch: "develop",
    });
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.data.changelog_path).toBe("docs/CHANGES.md");
    expect(parsed!.data.release_reference_pattern).toBe("WEB-\\d+");
    expect(parsed!.data.default_branch).toBe("develop");
  });

  it("passes frontmatter validation with only the required fields", () => {
    const result = generateRepoPage("storefront-web");
    const parsed = parseFrontmatter(result.content);
    const errors = validateFrontmatter(parsed!.data, "repo");

    expect(errors).toEqual([]);
  });

  it("includes Description and Releases body sections", () => {
    const result = generateRepoPage("storefront-web");
    const parsed = parseFrontmatter(result.content);

    expect(parsed!.body).toContain("## Description");
    expect(parsed!.body).toContain("## Releases");
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
      "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\n---\n"
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

  it("creates a weekly summary page file on disk", () => {
    const result = createPage(tmpDir, "weekly", { periodEnd: "2026-05-15" });

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "weekly", "2026-05-15.md"));
    expect(result.pageType).toBe("weekly");
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it("creates a repo page file on disk", () => {
    const result = createPage(tmpDir, "repo", {
      title: "storefront-web",
      repo: "acme/storefront-web",
    });

    expect(result.filePath).toBe(path.join(tmpDir, "wiki", "repos", "storefront-web.md"));
    expect(result.pageType).toBe("repo");
    expect(fs.existsSync(result.filePath)).toBe(true);
    const parsed = parseFrontmatter(fs.readFileSync(result.filePath, "utf-8"));
    expect(parsed!.data.repo).toBe("acme/storefront-web");
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
