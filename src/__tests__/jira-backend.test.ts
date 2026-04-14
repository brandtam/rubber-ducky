import { describe, it, expect } from "vitest";
import {
  assertCapability,
  type TaskPage,
} from "../lib/backend.js";
import {
  createJiraBackend,
  mapJiraStatusToStatus,
  mapStatusToJiraTransition,
  checkJiraConnectivityRest,
  DEFAULT_STATUS_MAP,
} from "../lib/jira-backend.js";
import type { JiraClient } from "../lib/jira-client.js";

function makeTaskPage(overrides?: Partial<TaskPage>): TaskPage {
  return {
    title: "Test task",
    ref: "PROJ-123",
    source: "jira",
    status: "to-do",
    priority: null,
    assignee: null,
    tags: [],
    created: "2024-01-01T00:00:00.000Z",
    updated: "2024-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: "https://myorg.atlassian.net/browse/PROJ-123",
    asana_ref: null,
    gh_ref: null,
    comment_count: 0,
    description: "",
    comments: [],
    ...overrides,
  };
}

function makeMockClient(overrides?: Partial<JiraClient>): JiraClient {
  return {
    getMyself: async () => ({ displayName: "Test User", emailAddress: "test@example.com" }),
    getIssue: async () => {
      throw new Error("getIssue not mocked");
    },
    getComments: async () => [],
    searchIssues: async () => ({ issues: [] }),
    createIssue: async () => {
      throw new Error("createIssue not mocked");
    },
    addComment: async () => {
      throw new Error("addComment not mocked");
    },
    getTransitions: async () => [],
    transitionIssue: async () => {
      throw new Error("transitionIssue not mocked");
    },
    ...overrides,
  };
}

describe("Jira backend", () => {
  describe("status mapping", () => {
    it("maps 'To Do' to to-do", () => {
      expect(mapJiraStatusToStatus("To Do")).toBe("to-do");
    });

    it("maps 'In Progress' to in-progress", () => {
      expect(mapJiraStatusToStatus("In Progress")).toBe("in-progress");
    });

    it("maps 'Done' to done", () => {
      expect(mapJiraStatusToStatus("Done")).toBe("done");
    });

    it("maps 'In Review' to in-review", () => {
      expect(mapJiraStatusToStatus("In Review")).toBe("in-review");
    });

    it("maps 'Blocked' to blocked", () => {
      expect(mapJiraStatusToStatus("Blocked")).toBe("blocked");
    });

    it("maps 'Backlog' to backlog", () => {
      expect(mapJiraStatusToStatus("Backlog")).toBe("backlog");
    });

    it("maps 'Waiting' to pending", () => {
      expect(mapJiraStatusToStatus("Waiting")).toBe("pending");
    });

    it("maps 'Deferred' to deferred", () => {
      expect(mapJiraStatusToStatus("Deferred")).toBe("deferred");
    });

    it("maps case-insensitively", () => {
      expect(mapJiraStatusToStatus("in progress")).toBe("in-progress");
      expect(mapJiraStatusToStatus("IN REVIEW")).toBe("in-review");
      expect(mapJiraStatusToStatus("TO DO")).toBe("to-do");
    });

    it("maps unknown status to backlog", () => {
      expect(mapJiraStatusToStatus("Custom Status")).toBe("backlog");
    });

    it("supports custom status map overrides", () => {
      const customMap = { ...DEFAULT_STATUS_MAP, "qa review": "in-review" as const };
      expect(mapJiraStatusToStatus("QA Review", customMap)).toBe("in-review");
    });

    it("maps done status to Done transition", () => {
      expect(mapStatusToJiraTransition("done")).toBe("Done");
    });

    it("maps in-progress to In Progress transition", () => {
      expect(mapStatusToJiraTransition("in-progress")).toBe("In Progress");
    });

    it("maps to-do to To Do transition", () => {
      expect(mapStatusToJiraTransition("to-do")).toBe("To Do");
    });

    it("maps backlog to Backlog transition", () => {
      expect(mapStatusToJiraTransition("backlog")).toBe("Backlog");
    });

    it("maps in-review to In Review transition", () => {
      expect(mapStatusToJiraTransition("in-review")).toBe("In Review");
    });

    it("maps blocked to Blocked transition", () => {
      expect(mapStatusToJiraTransition("blocked")).toBe("Blocked");
    });

    it("maps pending to Waiting transition", () => {
      expect(mapStatusToJiraTransition("pending")).toBe("Waiting");
    });

    it("maps deferred to Deferred transition", () => {
      expect(mapStatusToJiraTransition("deferred")).toBe("Deferred");
    });
  });

  describe("capabilities", () => {
    it("supports all five capabilities", () => {
      const backend = createJiraBackend({
        client: makeMockClient(),
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(backend.capabilities).toContain("ingest");
      expect(backend.capabilities).toContain("pull");
      expect(backend.capabilities).toContain("push");
      expect(backend.capabilities).toContain("comment");
      expect(backend.capabilities).toContain("transition");
    });

    it("passes assertCapability for all operations", () => {
      const backend = createJiraBackend({
        client: makeMockClient(),
        serverUrl: "https://myorg.atlassian.net",
      });

      expect(() => assertCapability(backend, "ingest")).not.toThrow();
      expect(() => assertCapability(backend, "pull")).not.toThrow();
      expect(() => assertCapability(backend, "push")).not.toThrow();
      expect(() => assertCapability(backend, "comment")).not.toThrow();
      expect(() => assertCapability(backend, "transition")).not.toThrow();
    });
  });

  describe("ingest", () => {
    it("ingests a Jira issue into a TaskPage", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
          key: "PROJ-42",
          fields: {
            summary: "Fix the login bug",
            description: "The login form crashes on submit",
            status: { name: "In Progress" },
            priority: { name: "High" },
            assignee: { displayName: "Alice Smith" },
            labels: ["bug", "frontend"],
            created: "2024-01-15T10:00:00.000+0000",
            updated: "2024-01-16T12:00:00.000+0000",
            resolutiondate: null,
            duedate: "2024-02-01",
            attachment: [],
          },
        }),
        getComments: async () => [
          {
            id: "10001",
            body: "I can reproduce this",
            author: { displayName: "Bob Jones" },
            created: "2024-01-15T11:00:00.000+0000",
          },
        ],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const page = await backend.ingest("PROJ-42");

      expect(page.title).toBe("Fix the login bug");
      expect(page.ref).toBe("PROJ-42");
      expect(page.source).toBe("jira");
      expect(page.status).toBe("in-progress");
      expect(page.priority).toBe("High");
      expect(page.assignee).toBe("Alice Smith");
      expect(page.jira_ref).toBe("https://myorg.atlassian.net/browse/PROJ-42");
      expect(page.description).toBe("The login form crashes on submit");
      expect(page.tags).toEqual(["bug", "frontend"]);
      expect(page.due).toBe("2024-02-01");
      expect(page.comments).toHaveLength(1);
      expect(page.comments[0]).toContain("Bob Jones");
      expect(page.comments[0]).toContain("I can reproduce this");
      expect(page.comment_count).toBe(1);
    });

    it("handles null description gracefully", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
          key: "PROJ-1",
          fields: {
            summary: "No description issue",
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
        getComments: async () => [],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const page = await backend.ingest("PROJ-1");

      expect(page.description).toBe("");
      expect(page.priority).toBeNull();
      expect(page.assignee).toBeNull();
    });

    it("sets closed timestamp for resolved issues", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
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
        getComments: async () => [],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const page = await backend.ingest("PROJ-5");

      expect(page.status).toBe("done");
      expect(page.closed).toBe("2024-01-10T00:00:00.000+0000");
    });

    it("formats multiple comments correctly", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
          key: "PROJ-7",
          fields: {
            summary: "Commented issue",
            description: "Main body",
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
        getComments: async () => [
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

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const page = await backend.ingest("PROJ-7");

      expect(page.comments).toHaveLength(2);
      expect(page.comment_count).toBe(2);
      expect(page.comments[0]).toContain("Alice");
      expect(page.comments[1]).toContain("Bob");
    });
  });

  describe("pull", () => {
    it("detects status changes", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
          key: "PROJ-123",
          fields: {
            summary: "Test task",
            description: "Updated description",
            status: { name: "In Progress" },
            priority: { name: "High" },
            assignee: { displayName: "Alice" },
            labels: ["bug"],
            created: "2024-01-01T00:00:00.000+0000",
            updated: "2024-01-02T00:00:00.000+0000",
            resolutiondate: null,
            duedate: null,
            attachment: [],
          },
        }),
        getComments: async () => [],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ status: "to-do" });
      const result = await backend.pull(taskPage);

      expect(result.updated).toBe(true);
      expect(result.changes).toContain("status: to-do -> in-progress");
    });

    it("detects no changes when up to date", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
          key: "PROJ-123",
          fields: {
            summary: "Test task",
            description: "",
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
        getComments: async () => [],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({
        status: "to-do",
        description: "",
        comments: [],
        comment_count: 0,
      });
      const result = await backend.pull(taskPage);

      expect(result.updated).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it("detects new comments", async () => {
      const client = makeMockClient({
        getIssue: async () => ({
          key: "PROJ-123",
          fields: {
            summary: "Test task",
            description: "",
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
        getComments: async () => [
          {
            id: "10001",
            body: "Old comment",
            author: { displayName: "Alice" },
            created: "2024-01-01T00:00:00.000+0000",
          },
          {
            id: "10002",
            body: "New comment",
            author: { displayName: "Bob" },
            created: "2024-01-02T00:00:00.000+0000",
          },
        ],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ comment_count: 1 });
      const result = await backend.pull(taskPage);

      expect(result.updated).toBe(true);
      expect(result.changes).toContain("comments: 1 new");
    });

    it("throws when no jira_ref available", async () => {
      const backend = createJiraBackend({
        client: makeMockClient(),
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ jira_ref: null, ref: null });

      await expect(backend.pull(taskPage)).rejects.toThrow(
        "Cannot pull: task page has no Jira reference"
      );
    });
  });

  describe("push", () => {
    it("creates a Jira issue from a TaskPage", async () => {
      const client = makeMockClient({
        createIssue: async () => ({
          key: "PROJ-99",
          id: "12345",
          self: "https://myorg.atlassian.net/rest/api/3/issue/12345",
        }),
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
        projectKey: "PROJ",
      });
      const taskPage = makeTaskPage({
        title: "New feature",
        description: "Build this thing",
        tags: ["enhancement"],
      });

      const result = await backend.push(taskPage);

      expect(result.success).toBe(true);
      expect(result.ref).toBe("PROJ-99");
      expect(result.url).toBe("https://myorg.atlassian.net/browse/PROJ-99");
    });

    it("includes labels in push payload", async () => {
      let capturedFields: Record<string, unknown> | undefined;
      const client = makeMockClient({
        createIssue: async (fields) => {
          capturedFields = fields;
          return {
            key: "PROJ-100",
            id: "12346",
            self: "https://myorg.atlassian.net/rest/api/3/issue/12346",
          };
        },
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
        projectKey: "PROJ",
      });
      const taskPage = makeTaskPage({ tags: ["bug", "urgent"] });

      await backend.push(taskPage);

      expect(capturedFields).toBeDefined();
      expect(capturedFields!.labels).toEqual(["bug", "urgent"]);
    });

    it("throws when no project key configured", async () => {
      const backend = createJiraBackend({
        client: makeMockClient(),
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage();

      await expect(backend.push(taskPage)).rejects.toThrow(
        "Cannot push: no Jira project key configured"
      );
    });
  });

  describe("comment", () => {
    it("adds a comment to a Jira issue via jira_ref", async () => {
      const capturedCalls: { issueKey: string; text: string }[] = [];
      const client = makeMockClient({
        addComment: async (issueKey, text) => {
          capturedCalls.push({ issueKey, text });
          return { id: "10001" };
        },
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({
        jira_ref: "https://myorg.atlassian.net/browse/PROJ-42",
        ref: "PROJ-42",
      });

      const result = await backend.comment(taskPage, "Great work!");

      expect(result.success).toBe(true);
      expect(result.commentUrl).toContain("PROJ-42");
      expect(capturedCalls[0].issueKey).toBe("PROJ-42");
      expect(capturedCalls[0].text).toBe("Great work!");
    });

    it("uses ref when jira_ref is not set", async () => {
      const capturedCalls: { issueKey: string; text: string }[] = [];
      const client = makeMockClient({
        addComment: async (issueKey, text) => {
          capturedCalls.push({ issueKey, text });
          return { id: "10002" };
        },
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ jira_ref: null, ref: "PROJ-42" });

      const result = await backend.comment(taskPage, "A comment");

      expect(result.success).toBe(true);
      expect(capturedCalls[0].issueKey).toBe("PROJ-42");
    });

    it("throws when no reference is available", async () => {
      const backend = createJiraBackend({
        client: makeMockClient(),
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ ref: null, jira_ref: null });

      await expect(backend.comment(taskPage, "oops")).rejects.toThrow(
        "Cannot comment: task page has no Jira reference"
      );
    });
  });

  describe("transition", () => {
    it("transitions a Jira issue status", async () => {
      const capturedCalls: { issueKey: string; transitionId: string }[] = [];
      const client = makeMockClient({
        getTransitions: async () => [
          { id: "21", name: "In Progress" },
          { id: "31", name: "Done" },
        ],
        transitionIssue: async (issueKey, transitionId) => {
          capturedCalls.push({ issueKey, transitionId });
        },
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ status: "to-do", ref: "PROJ-123" });

      const result = await backend.transition(taskPage, "in-progress");

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe("to-do");
      expect(result.newStatus).toBe("in-progress");
      expect(capturedCalls[0].issueKey).toBe("PROJ-123");
      expect(capturedCalls[0].transitionId).toBe("21");
    });

    it("throws when no reference is available", async () => {
      const backend = createJiraBackend({
        client: makeMockClient(),
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ ref: null, jira_ref: null });

      await expect(backend.transition(taskPage, "done")).rejects.toThrow(
        "Cannot transition: task page has no Jira reference"
      );
    });

    it("throws when target transition not found", async () => {
      const client = makeMockClient({
        getTransitions: async () => [
          { id: "21", name: "In Progress" },
        ],
      });

      const backend = createJiraBackend({
        client,
        serverUrl: "https://myorg.atlassian.net",
      });
      const taskPage = makeTaskPage({ status: "to-do" });

      await expect(backend.transition(taskPage, "done")).rejects.toThrow(
        /transition.*not available/i
      );
    });
  });

  describe("checkJiraConnectivityRest", () => {
    it("returns authenticated when REST API responds", async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ displayName: "Alice Smith", emailAddress: "alice@myorg.com" }),
        text: async () => JSON.stringify({ displayName: "Alice Smith" }),
      }) as Response;

      const result = await checkJiraConnectivityRest({
        serverUrl: "https://myorg.atlassian.net",
        email: "alice@myorg.com",
        apiToken: "test-token",
        fetch: mockFetch,
      });

      expect(result.authenticated).toBe(true);
      expect(result.user).toBe("Alice Smith");
    });

    it("returns not authenticated when email is missing", async () => {
      const result = await checkJiraConnectivityRest({
        serverUrl: "https://myorg.atlassian.net",
        email: "",
        apiToken: "test-token",
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("JIRA_EMAIL");
    });

    it("returns not authenticated when apiToken is missing", async () => {
      const result = await checkJiraConnectivityRest({
        serverUrl: "https://myorg.atlassian.net",
        email: "alice@myorg.com",
        apiToken: "",
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("JIRA_API_TOKEN");
    });

    it("returns not authenticated when serverUrl is missing", async () => {
      const result = await checkJiraConnectivityRest({
        serverUrl: "",
        email: "alice@myorg.com",
        apiToken: "test-token",
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("server_url");
    });

    it("returns not authenticated when REST API fails", async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized" }),
        text: async () => '{"message":"Unauthorized"}',
      }) as Response;

      const result = await checkJiraConnectivityRest({
        serverUrl: "https://myorg.atlassian.net",
        email: "alice@myorg.com",
        apiToken: "bad-token",
        fetch: mockFetch,
      });

      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("Jira REST API check failed");
    });
  });
});
