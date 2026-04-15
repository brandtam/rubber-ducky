import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "../lib/frontmatter.js";
import {
  ingestJiraIssue,
  ingestJiraProject,
  type IngestJiraOptions,
  type IngestJiraProjectOptions,
  type IngestResult,
} from "../lib/jira-ingest.js";
import type { JiraClient, JiraIssue, JiraComment } from "../lib/jira-client.js";

function makeMockIssue(overrides?: Partial<JiraIssue>): JiraIssue {
  return {
    key: "ECOMM-4643",
    fields: {
      summary: "Fix checkout flow",
      description: "The checkout crashes on submit",
      status: { name: "In Progress" },
      priority: { name: "High" },
      assignee: { displayName: "Alice Smith" },
      labels: ["bug", "checkout"],
      created: "2024-01-15T10:00:00.000+0000",
      updated: "2024-01-16T12:00:00.000+0000",
      resolutiondate: null,
      duedate: "2024-02-01",
      attachment: [],
    },
    ...overrides,
  } as JiraIssue;
}

function makeMockComments(comments?: JiraComment[]): JiraComment[] {
  return comments ?? [
    {
      id: "10001",
      body: "I can reproduce this",
      author: { displayName: "Bob Jones" },
      created: "2024-01-15T11:00:00.000+0000",
    },
  ];
}

function makeMockClient(overrides?: {
  issue?: JiraIssue;
  comments?: JiraComment[];
  searchIssues?: JiraIssue[];
}): JiraClient {
  const issue = overrides?.issue ?? makeMockIssue();
  const comments = overrides?.comments ?? makeMockComments();
  const searchIssues = overrides?.searchIssues ?? [issue];

  return {
    getMyself: async () => ({ displayName: "Test User", emailAddress: "test@example.com" }),
    getIssue: async () => issue,
    getComments: async () => comments,
    searchIssues: async () => ({ issues: searchIssues }),
  } as JiraClient;
}

function setupWorkspace(tmpDir: string): void {
  fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "workspace.md"),
    "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
  );
}

describe("ingestJiraIssue", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-jira-ingest-test-"));
    setupWorkspace(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("single issue ingest", () => {
    it("creates a task page with full frontmatter from an issue key", async () => {
      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.filePath).toContain("wiki/tasks/");

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      expect(parsed).not.toBeNull();

      const fm = parsed!.data;
      expect(fm.title).toBe("Fix checkout flow");
      expect(fm.type).toBe("task");
      expect(fm.ref).toBe("ECOMM-4643");
      expect(fm.source).toBe("jira");
      expect(fm.status).toBe("in-progress");
      expect(fm.priority).toBe("High");
      expect(fm.assignee).toBe("Alice Smith");
      expect(fm.due).toBe("2024-02-01");
      expect(fm.jira_ref).toBe("https://myorg.atlassian.net/browse/ECOMM-4643");
      expect(fm.tags).toEqual(["bug", "checkout"]);
      expect(fm.comment_count).toBe(1);
      expect(fm.jira_status_raw).toBe("In Progress");
      expect(fm.jira_needed).toBeUndefined();
    });

    it("creates a task page with full body sections", async () => {
      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const body = parsed!.body;

      // Description section (backend-scoped)
      expect(body).toContain("## Jira description");
      expect(body).toContain("The checkout crashes on submit");

      // Comments section with attribution (backend-scoped)
      expect(body).toContain("## Jira comments");
      expect(body).toContain("**Bob Jones**");
      expect(body).toContain("2024-01-15T11:00:00.000+0000");
      expect(body).toContain("I can reproduce this");

      // Activity log
      expect(body).toContain("## Activity log");
      expect(body).toContain("Ingested from Jira");
      expect(body).toContain("ECOMM-4643");

      // See also
      expect(body).toContain("## See also");
    });

    it("handles issue with no assignee, priority, due date, or labels", async () => {
      const client = makeMockClient({
        issue: makeMockIssue({
          key: "PROJ-1",
          fields: {
            summary: "Simple issue",
            description: null,
            status: { name: "To Do" },
            priority: null,
            assignee: null,
            labels: [],
            created: "2024-01-01T00:00:00.000+0000",
            updated: "2024-01-01T00:00:00.000+0000",
            resolutiondate: null,
            duedate: null,
            attachment: [],
          },
        }),
        comments: [],
      });

      const result = await ingestJiraIssue({
        client,
        ref: "PROJ-1",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const fm = parsed!.data;

      expect(fm.assignee).toBeNull();
      expect(fm.priority).toBeNull();
      expect(fm.due).toBeNull();
      expect(fm.tags).toEqual([]);
      expect(fm.status).toBe("to-do");
      expect(fm.comment_count).toBe(0);
    });

    it("sets closed timestamp for resolved issues", async () => {
      const client = makeMockClient({
        issue: makeMockIssue({
          key: "PROJ-5",
          fields: {
            summary: "Done task",
            description: "Finished",
            status: { name: "Done" },
            priority: { name: "Medium" },
            assignee: null,
            labels: [],
            created: "2024-01-01T00:00:00.000+0000",
            updated: "2024-01-10T00:00:00.000+0000",
            resolutiondate: "2024-01-10T00:00:00.000+0000",
            duedate: null,
            attachment: [],
          },
        }),
        comments: [],
      });

      const result = await ingestJiraIssue({
        client,
        ref: "PROJ-5",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);

      expect(parsed!.data.status).toBe("done");
      expect(parsed!.data.closed).toBe("2024-01-10T00:00:00.000+0000");
    });

    it("formats multiple comments with attribution", async () => {
      const client = makeMockClient({
        comments: [
          {
            id: "10001",
            body: "First comment",
            author: { displayName: "Alice" },
            created: "2024-01-10T10:00:00.000+0000",
          },
          {
            id: "10002",
            body: "Second comment",
            author: { displayName: "Bob" },
            created: "2024-01-11T11:00:00.000+0000",
          },
        ],
      });

      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const body = parsed!.body;

      expect(parsed!.data.comment_count).toBe(2);
      expect(body).toContain("**Alice**");
      expect(body).toContain("**Bob**");
      expect(body).toContain("First comment");
      expect(body).toContain("Second comment");
    });

    it("uses issue key as filename slug", async () => {
      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(result.filePath).toContain("ECOMM-4643.md");
    });

    it("translates status via workspace status-mapping config", async () => {
      // Seed a status-mapping.md that maps Jira "In Progress" → "in-review"
      fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "wiki", "status-mapping.md"),
        [
          "---",
          "type: config",
          "---",
          "",
          "## Jira → wiki",
          "",
          "- `In Progress` → `in-review`",
        ].join("\n")
      );

      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const fm = parsed!.data;

      // Canonical status overridden by status-mapping config
      expect(fm.status).toBe("in-review");
      // Raw status preserved
      expect(fm.jira_status_raw).toBe("In Progress");
    });
  });

  describe("dedup", () => {
    it("skips when jira_ref already exists in wiki/tasks", async () => {
      const existingContent = [
        "---",
        "title: Existing task",
        "type: task",
        "ref: ECOMM-4643",
        "source: jira",
        "status: in-progress",
        "jira_ref: https://myorg.atlassian.net/browse/ECOMM-4643",
        "created: 2024-01-01T00:00:00.000Z",
        "comment_count: 0",
        "---",
        "## Description",
      ].join("\n");

      fs.writeFileSync(
        path.join(tmpDir, "wiki", "tasks", "existing-task.md"),
        existingContent
      );

      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("already ingested");
      expect(result.existingFile).toContain("existing-task.md");
    });

    it("does not skip when jira_ref does not match", async () => {
      const existingContent = [
        "---",
        "title: Different task",
        "type: task",
        "ref: ECOMM-9999",
        "source: jira",
        "status: to-do",
        "jira_ref: https://myorg.atlassian.net/browse/ECOMM-9999",
        "created: 2024-01-01T00:00:00.000Z",
        "comment_count: 0",
        "---",
        "## Description",
      ].join("\n");

      fs.writeFileSync(
        path.join(tmpDir, "wiki", "tasks", "different-task.md"),
        existingContent
      );

      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(result.skipped).toBe(false);
      expect(result.success).toBe(true);
    });
  });

  describe("index and log", () => {
    it("rebuilds wiki index after ingest", async () => {
      const client = makeMockClient();
      await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const indexPath = path.join(tmpDir, "wiki", "index.md");
      expect(fs.existsSync(indexPath)).toBe(true);

      const index = fs.readFileSync(indexPath, "utf-8");
      expect(index).toContain("Fix checkout flow");
    });

    it("appends to wiki log after ingest", async () => {
      const client = makeMockClient();
      await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      const logPath = path.join(tmpDir, "wiki", "log.md");
      expect(fs.existsSync(logPath)).toBe(true);

      const log = fs.readFileSync(logPath, "utf-8");
      expect(log).toContain("Ingested Jira issue");
      expect(log).toContain("ECOMM-4643");
    });
  });

  describe("structured output", () => {
    it("returns complete result for successful ingest", async () => {
      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.filePath).toBeDefined();
      expect(result.taskPage).toBeDefined();
      expect(result.taskPage!.title).toBe("Fix checkout flow");
      expect(result.taskPage!.ref).toBe("ECOMM-4643");
      expect(result.taskPage!.source).toBe("jira");
    });

    it("returns skip result for dedup", async () => {
      const existingContent = [
        "---",
        "title: Existing task",
        "type: task",
        "ref: ECOMM-4643",
        "source: jira",
        "status: in-progress",
        "jira_ref: https://myorg.atlassian.net/browse/ECOMM-4643",
        "created: 2024-01-01T00:00:00.000Z",
        "comment_count: 0",
        "---",
      ].join("\n");

      fs.writeFileSync(
        path.join(tmpDir, "wiki", "tasks", "existing-task.md"),
        existingContent
      );

      const client = makeMockClient();
      const result = await ingestJiraIssue({
        client,
        ref: "ECOMM-4643",
        workspaceRoot: tmpDir,
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBeDefined();
      expect(result.existingFile).toBeDefined();
    });
  });
});

describe("ingestJiraProject", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-jira-bulk-test-"));
    setupWorkspace(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests all issues from a project", async () => {
    const issues = [
      makeMockIssue({ key: "ECOMM-1", fields: { ...makeMockIssue().fields, summary: "First issue" } }),
      makeMockIssue({ key: "ECOMM-2", fields: { ...makeMockIssue().fields, summary: "Second issue" } }),
    ];

    let getIssueCalls: string[] = [];
    const client: JiraClient = {
      getMyself: async () => ({ displayName: "Test User", emailAddress: "test@example.com" }),
      getIssue: async (key) => {
        getIssueCalls.push(key);
        return issues.find((i) => i.key === key)!;
      },
      getComments: async () => [],
      searchIssues: async () => ({ issues }),
    } as JiraClient;

    const results = await ingestJiraProject({
      client,
      projectKey: "ECOMM",
      workspaceRoot: tmpDir,
      serverUrl: "https://myorg.atlassian.net",
    });

    expect(results.results).toHaveLength(2);
    expect(results.ingested).toBe(2);
    expect(results.skipped).toBe(0);
    expect(results.results[0].success).toBe(true);
    expect(results.results[1].success).toBe(true);
    expect(results.results[0].taskPage?.title).toBe("First issue");
    expect(results.results[1].taskPage?.title).toBe("Second issue");
  });

  it("applies --mine filter via JQL", async () => {
    let capturedJql = "";
    const client: JiraClient = {
      getMyself: async () => ({ displayName: "Test User", emailAddress: "test@example.com" }),
      getIssue: async () => makeMockIssue(),
      getComments: async () => [],
      searchIssues: async (jql) => {
        capturedJql = jql;
        return { issues: [makeMockIssue()] };
      },
    } as JiraClient;

    await ingestJiraProject({
      client,
      projectKey: "ECOMM",
      workspaceRoot: tmpDir,
      serverUrl: "https://myorg.atlassian.net",
      scope: "mine",
    });

    expect(capturedJql).toContain("assignee = currentUser()");
  });

  it("skips already-ingested issues during bulk ingest", async () => {
    // Create an existing task page
    const existingContent = [
      "---",
      "title: Existing task",
      "type: task",
      "ref: ECOMM-4643",
      "source: jira",
      "status: in-progress",
      "jira_ref: https://myorg.atlassian.net/browse/ECOMM-4643",
      "created: 2024-01-01T00:00:00.000Z",
      "comment_count: 0",
      "---",
      "## Description",
    ].join("\n");

    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "existing-task.md"),
      existingContent
    );

    const client = makeMockClient();
    const results = await ingestJiraProject({
      client,
      projectKey: "ECOMM",
      workspaceRoot: tmpDir,
      serverUrl: "https://myorg.atlassian.net",
    });

    expect(results.results).toHaveLength(1);
    expect(results.ingested).toBe(0);
    expect(results.skipped).toBe(1);
    expect(results.results[0].skipped).toBe(true);
    expect(results.results[0].reason).toContain("already ingested");
  });
});
