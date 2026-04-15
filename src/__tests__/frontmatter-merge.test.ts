import { describe, it, expect } from "vitest";
import {
  mergeFrontmatter,
  type MergeConflict,
} from "../lib/frontmatter-merge.js";
import type { TaskPage } from "../lib/backend.js";

function makeTaskPage(overrides?: Partial<TaskPage>): TaskPage {
  return {
    title: "Test task",
    ref: null,
    source: null,
    status: "backlog",
    priority: null,
    assignee: null,
    tags: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: null,
    asana_ref: null,
    gh_ref: null,
    jira_needed: null,
    asana_status_raw: null,
    jira_status_raw: null,
    comment_count: 0,
    description: "",
    comments: [],
    ...overrides,
  };
}

describe("mergeFrontmatter", () => {
  it("produces merged frontmatter with source: asana and asana ref as primary", () => {
    const asana = makeTaskPage({
      title: "Implement dark mode",
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      status: "in-progress",
      asana_status_raw: "In Progress",
    });
    const jira = makeTaskPage({
      title: "Implement dark mode",
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      status: "in-progress",
      jira_status_raw: "In Progress",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.source).toBe("asana");
    expect(result.merged.ref).toBe("https://app.asana.com/0/proj/123");
    expect(result.merged.asana_ref).toBe("https://app.asana.com/0/proj/123");
    expect(result.merged.jira_ref).toBe("https://jira.example.com/browse/WEB-297");
    expect(result.merged.jira_needed).toBe("yes");
  });

  it("preserves both raw status values regardless of conflict", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      asana_status_raw: "In Progress",
      status: "in-progress",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      jira_status_raw: "Done",
      status: "done",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.asana_status_raw).toBe("In Progress");
    expect(result.merged.jira_status_raw).toBe("Done");
  });

  it("detects conflict when working status differs", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      status: "in-progress",
      asana_status_raw: "In Progress",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      status: "done",
      jira_status_raw: "Done",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
    const statusConflict = result.conflicts.find((c) => c.field === "status");
    expect(statusConflict).toBeDefined();
    expect(statusConflict!.asanaValue).toBe("in-progress");
    expect(statusConflict!.jiraValue).toBe("done");
  });

  it("detects conflict when priority differs", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      priority: "high",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      priority: "low",
    });

    const result = mergeFrontmatter(asana, jira);

    const conflict = result.conflicts.find((c) => c.field === "priority");
    expect(conflict).toBeDefined();
    expect(conflict!.asanaValue).toBe("high");
    expect(conflict!.jiraValue).toBe("low");
  });

  it("detects conflict when assignee differs", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      assignee: "Alice",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      assignee: "Bob",
    });

    const result = mergeFrontmatter(asana, jira);

    const conflict = result.conflicts.find((c) => c.field === "assignee");
    expect(conflict).toBeDefined();
  });

  it("no conflict when values agree", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      status: "in-progress",
      priority: "high",
      assignee: "Alice",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      status: "in-progress",
      priority: "high",
      assignee: "Alice",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.status).toBe("in-progress");
  });

  it("handles one-sided fields (only Asana has priority)", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      priority: "high",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      priority: null,
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.priority).toBe("high");
  });

  it("handles one-sided fields (only Jira has assignee)", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      assignee: null,
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      assignee: "Bob",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.conflicts).toEqual([]);
    expect(result.merged.assignee).toBe("Bob");
  });

  it("merges tags as a union", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      tags: ["frontend", "p1"],
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      tags: ["p1", "dark-mode"],
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.tags).toContain("frontend");
    expect(result.merged.tags).toContain("p1");
    expect(result.merged.tags).toContain("dark-mode");
    // No duplicates
    expect(result.merged.tags.filter((t) => t === "p1")).toHaveLength(1);
  });

  it("uses Asana title by default", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      title: "Asana Title",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      title: "Jira Title",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.title).toBe("Asana Title");
  });

  it("sums comment counts", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      comment_count: 3,
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      comment_count: 2,
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.comment_count).toBe(5);
  });

  it("uses the earlier created date", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      created: "2026-01-01T00:00:00.000Z",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      created: "2025-12-15T00:00:00.000Z",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.created).toBe("2025-12-15T00:00:00.000Z");
  });

  it("uses the later updated date", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      updated: "2026-04-01T00:00:00.000Z",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      updated: "2026-04-10T00:00:00.000Z",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.updated).toBe("2026-04-10T00:00:00.000Z");
  });

  it("applies resolution overrides when provided", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      status: "in-progress",
      priority: "high",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      status: "done",
      priority: "low",
    });

    const result = mergeFrontmatter(asana, jira, {
      status: "done",
      priority: "high",
    });

    // Conflicts should be empty because resolutions were provided
    expect(result.conflicts).toEqual([]);
    expect(result.merged.status).toBe("done");
    expect(result.merged.priority).toBe("high");
  });

  it("detects due date conflict", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      due: "2026-05-01",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      due: "2026-06-01",
    });

    const result = mergeFrontmatter(asana, jira);

    const conflict = result.conflicts.find((c) => c.field === "due");
    expect(conflict).toBeDefined();
  });

  it("preserves gh_ref from Asana page when present", () => {
    const asana = makeTaskPage({
      source: "asana",
      ref: "https://app.asana.com/0/proj/123",
      asana_ref: "https://app.asana.com/0/proj/123",
      gh_ref: "https://github.com/owner/repo/issues/5",
    });
    const jira = makeTaskPage({
      source: "jira",
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
    });

    const result = mergeFrontmatter(asana, jira);

    expect(result.merged.gh_ref).toBe("https://github.com/owner/repo/issues/5");
  });
});
