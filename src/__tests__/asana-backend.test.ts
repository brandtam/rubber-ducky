import { describe, it, expect } from "vitest";
import {
  assertCapability,
  getBackend,
  checkConnectivity,
  type TaskPage,
} from "../lib/backend.js";
import {
  createAsanaBackend,
  mapAsanaToStatus,
  mapStatusToAsanaCompleted,
  checkAsanaConnectivityRest,
  parseTaskRef,
} from "../lib/asana-backend.js";
import type { AsanaClient } from "../lib/asana-client.js";

function makeTaskPage(overrides?: Partial<TaskPage>): TaskPage {
  return {
    title: "Test task",
    ref: "1234567890",
    source: "asana",
    status: "to-do",
    priority: null,
    assignee: null,
    tags: [],
    created: "2024-01-01T00:00:00.000Z",
    updated: "2024-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: null,
    asana_ref: "https://app.asana.com/0/project/1234567890",
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

function makeMockClient(overrides?: Partial<AsanaClient>): AsanaClient {
  return {
    getMe: async () => ({ gid: "me", name: "Test User", email: "test@example.com" }),
    getTask: async () => {
      throw new Error("getTask not mocked");
    },
    getStories: async () => [],
    createTask: async () => {
      throw new Error("createTask not mocked");
    },
    createStory: async () => {
      throw new Error("createStory not mocked");
    },
    ...overrides,
  };
}

describe("Asana backend", () => {
  describe("status mapping", () => {
    it("maps completed task to done", () => {
      expect(mapAsanaToStatus(true)).toBe("done");
    });

    it("maps incomplete task with no section to to-do", () => {
      expect(mapAsanaToStatus(false)).toBe("to-do");
    });

    it("maps section name to matching status", () => {
      expect(mapAsanaToStatus(false, "In Progress")).toBe("in-progress");
      expect(mapAsanaToStatus(false, "Backlog")).toBe("backlog");
      expect(mapAsanaToStatus(false, "Blocked")).toBe("blocked");
      expect(mapAsanaToStatus(false, "In Review")).toBe("in-review");
      expect(mapAsanaToStatus(false, "Pending")).toBe("pending");
      expect(mapAsanaToStatus(false, "To Do")).toBe("to-do");
      expect(mapAsanaToStatus(false, "Deferred")).toBe("deferred");
    });

    it("maps section names case-insensitively", () => {
      expect(mapAsanaToStatus(false, "IN PROGRESS")).toBe("in-progress");
      expect(mapAsanaToStatus(false, "in progress")).toBe("in-progress");
      expect(mapAsanaToStatus(false, "BACKLOG")).toBe("backlog");
    });

    it("normalizes hyphens and spaces in section names", () => {
      expect(mapAsanaToStatus(false, "in-progress")).toBe("in-progress");
      expect(mapAsanaToStatus(false, "In-Review")).toBe("in-review");
    });

    it("falls back to to-do for unrecognized section names", () => {
      expect(mapAsanaToStatus(false, "Sprint 42")).toBe("to-do");
      expect(mapAsanaToStatus(false, "My Custom Section")).toBe("to-do");
    });

    it("completed overrides section name", () => {
      expect(mapAsanaToStatus(true, "In Progress")).toBe("done");
      expect(mapAsanaToStatus(true, "Backlog")).toBe("done");
    });

    it("uses custom status mapping when provided", () => {
      const mapping = { "Sprint 42": "in-progress", "Icebox": "deferred" };
      expect(mapAsanaToStatus(false, "Sprint 42", mapping)).toBe("in-progress");
      expect(mapAsanaToStatus(false, "Icebox", mapping)).toBe("deferred");
    });

    it("custom mapping is case-insensitive", () => {
      const mapping = { "Sprint 42": "in-progress" };
      expect(mapAsanaToStatus(false, "sprint 42", mapping)).toBe("in-progress");
    });

    it("maps done status to completed=true", () => {
      expect(mapStatusToAsanaCompleted("done")).toBe(true);
    });

    it("maps non-done statuses to completed=false", () => {
      expect(mapStatusToAsanaCompleted("to-do")).toBe(false);
      expect(mapStatusToAsanaCompleted("in-progress")).toBe(false);
      expect(mapStatusToAsanaCompleted("backlog")).toBe(false);
      expect(mapStatusToAsanaCompleted("blocked")).toBe(false);
      expect(mapStatusToAsanaCompleted("in-review")).toBe(false);
    });
  });

  describe("capabilities", () => {
    it("supports ingest, pull, push, and comment", () => {
      const backend = createAsanaBackend({ client: makeMockClient() });
      expect(backend.capabilities).toContain("ingest");
      expect(backend.capabilities).toContain("pull");
      expect(backend.capabilities).toContain("push");
      expect(backend.capabilities).toContain("comment");
    });

    it("does not support transition", () => {
      const backend = createAsanaBackend({ client: makeMockClient() });
      expect(backend.capabilities).not.toContain("transition");
      expect(() => assertCapability(backend, "transition")).toThrow(
        'Backend "asana" does not support "transition"'
      );
    });
  });

  describe("ingest", () => {
    it("ingests an Asana task into a TaskPage", async () => {
      const mockTask = {
        gid: "1234567890",
        name: "Fix the login bug",
        notes: "The login form crashes on submit",
        completed: false,
        completed_at: null,
        assignee: { name: "Alice", gid: "111" },
        due_on: "2024-02-15",
        memberships: [
          { section: { name: "In Progress", gid: "section1" } },
        ],
        tags: [{ name: "bug" }, { name: "urgent" }],
        permalink_url: "https://app.asana.com/0/project/1234567890",
        custom_fields: [],
      };

      const mockStories = [
        {
          gid: "s1",
          type: "comment",
          text: "I can reproduce this",
          created_by: { name: "Bob", gid: "222" },
          created_at: "2024-01-15T10:00:00Z",
        },
      ];

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => mockStories,
      });

      const backend = createAsanaBackend({ client });
      const page = await backend.ingest("1234567890");

      expect(page.title).toBe("Fix the login bug");
      expect(page.ref).toBe("1234567890");
      expect(page.source).toBe("asana");
      expect(page.status).toBe("in-progress");
      expect(page.assignee).toBe("Alice");
      expect(page.due).toBe("2024-02-15");
      expect(page.asana_ref).toBe(
        "https://app.asana.com/0/project/1234567890"
      );
      expect(page.description).toBe("The login form crashes on submit");
      expect(page.tags).toEqual(["bug", "urgent"]);
      expect(page.comments).toHaveLength(1);
      expect(page.comments[0]).toContain("Bob");
      expect(page.comments[0]).toContain("I can reproduce this");
      expect(page.comment_count).toBe(1);
    });

    it("handles task with no assignee, no due date, no tags", async () => {
      const mockTask = {
        gid: "999",
        name: "Simple task",
        notes: "",
        completed: false,
        completed_at: null,
        assignee: null,
        due_on: null,
        memberships: [],
        tags: [],
        permalink_url: "https://app.asana.com/0/project/999",
        custom_fields: [],
      };

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => [],
      });

      const backend = createAsanaBackend({ client });
      const page = await backend.ingest("999");

      expect(page.title).toBe("Simple task");
      expect(page.assignee).toBeNull();
      expect(page.due).toBeNull();
      expect(page.tags).toEqual([]);
      expect(page.description).toBe("");
      expect(page.status).toBe("to-do");
    });

    it("sets closed timestamp for completed tasks", async () => {
      const mockTask = {
        gid: "555",
        name: "Done task",
        notes: "Finished",
        completed: true,
        completed_at: "2024-01-20T15:30:00.000Z",
        assignee: null,
        due_on: null,
        memberships: [],
        tags: [],
        permalink_url: "https://app.asana.com/0/project/555",
        custom_fields: [],
      };

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => [],
      });

      const backend = createAsanaBackend({ client });
      const page = await backend.ingest("555");

      expect(page.status).toBe("done");
      expect(page.closed).toBe("2024-01-20T15:30:00.000Z");
    });

    it("formats multiple comments correctly", async () => {
      const mockTask = {
        gid: "777",
        name: "Commented task",
        notes: "Main body",
        completed: false,
        completed_at: null,
        assignee: null,
        due_on: null,
        memberships: [],
        tags: [],
        permalink_url: "https://app.asana.com/0/project/777",
        custom_fields: [],
      };

      const mockStories = [
        {
          gid: "s1",
          type: "comment",
          text: "First comment",
          created_by: { name: "Alice", gid: "111" },
          created_at: "2024-01-10T10:00:00Z",
        },
        {
          gid: "s2",
          type: "system",
          text: "Alice moved this task",
          created_by: { name: "Alice", gid: "111" },
          created_at: "2024-01-10T11:00:00Z",
        },
        {
          gid: "s3",
          type: "comment",
          text: "Second comment",
          created_by: { name: "Bob", gid: "222" },
          created_at: "2024-01-11T11:00:00Z",
        },
      ];

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => mockStories,
      });

      const backend = createAsanaBackend({ client });
      const page = await backend.ingest("777");

      // Only comment-type stories, not system stories
      expect(page.comments).toHaveLength(2);
      expect(page.comment_count).toBe(2);
      expect(page.comments[0]).toContain("Alice");
      expect(page.comments[1]).toContain("Bob");
    });

    it("extracts task ID from Asana URL", async () => {
      const mockTask = {
        gid: "1234567890",
        name: "URL task",
        notes: "",
        completed: false,
        completed_at: null,
        assignee: null,
        due_on: null,
        memberships: [],
        tags: [],
        permalink_url: "https://app.asana.com/0/project/1234567890",
        custom_fields: [],
      };

      const capturedGids: string[] = [];
      const client = makeMockClient({
        getTask: async (gid) => {
          capturedGids.push(gid);
          return mockTask;
        },
        getStories: async () => [],
      });

      const backend = createAsanaBackend({ client });
      await backend.ingest("https://app.asana.com/0/project/1234567890");

      // Should extract the task GID from the URL
      expect(capturedGids[0]).toBe("1234567890");
    });

    it("uses custom status mapping during ingest", async () => {
      const mockTask = {
        gid: "888",
        name: "Custom status task",
        notes: "",
        completed: false,
        completed_at: null,
        assignee: null,
        due_on: null,
        memberships: [
          { section: { name: "Sprint 42", gid: "s1" } },
        ],
        tags: [],
        permalink_url: "https://app.asana.com/0/project/888",
        custom_fields: [],
      };

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => [],
      });

      const statusMapping = { "Sprint 42": "in-progress" };
      const backend = createAsanaBackend({ client, statusMapping });
      const page = await backend.ingest("888");

      expect(page.status).toBe("in-progress");
    });
  });

  describe("pull", () => {
    it("updates wiki task page from latest Asana state", async () => {
      const mockTask = {
        gid: "1234567890",
        name: "Updated task title",
        notes: "Updated description",
        completed: false,
        completed_at: null,
        assignee: { name: "Charlie", gid: "222" },
        due_on: "2024-03-01",
        memberships: [
          { section: { name: "In Review", gid: "s2" } },
        ],
        tags: [{ name: "feature" }],
        permalink_url: "https://app.asana.com/0/project/1234567890",
        custom_fields: [],
      };

      const mockStories = [
        {
          gid: "s1",
          type: "comment",
          text: "New comment",
          created_by: { name: "Dave", gid: "333" },
          created_at: "2024-02-01T10:00:00Z",
        },
      ];

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => mockStories,
      });

      const backend = createAsanaBackend({ client });
      const taskPage = makeTaskPage({
        asana_ref: "https://app.asana.com/0/project/1234567890",
        ref: "1234567890",
        status: "to-do",
        assignee: null,
        comments: [],
        comment_count: 0,
      });

      const result = await backend.pull(taskPage);

      expect(result.updated).toBe(true);
      expect(result.changes).toContain("status: to-do → in-review");
      expect(result.changes).toContain("assignee: null → Charlie");
    });

    it("returns no changes when task is up to date", async () => {
      const mockTask = {
        gid: "1234567890",
        name: "Test task",
        notes: "",
        completed: false,
        completed_at: null,
        assignee: null,
        due_on: null,
        memberships: [],
        tags: [],
        permalink_url: "https://app.asana.com/0/project/1234567890",
        custom_fields: [],
      };

      const client = makeMockClient({
        getTask: async () => mockTask,
        getStories: async () => [],
      });

      const backend = createAsanaBackend({ client });
      const taskPage = makeTaskPage({
        asana_ref: "https://app.asana.com/0/project/1234567890",
        ref: "1234567890",
        status: "to-do",
        assignee: null,
        comment_count: 0,
      });

      const result = await backend.pull(taskPage);

      expect(result.updated).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it("throws when task page has no asana_ref", async () => {
      const backend = createAsanaBackend({ client: makeMockClient() });
      const taskPage = makeTaskPage({ asana_ref: null, ref: null });

      await expect(backend.pull(taskPage)).rejects.toThrow(
        "Cannot pull: task page has no Asana reference"
      );
    });
  });

  describe("push", () => {
    it("creates a new Asana task from a wiki task page", async () => {
      const capturedParams: Record<string, unknown>[] = [];
      const client = makeMockClient({
        createTask: async (params) => {
          capturedParams.push(params);
          return {
            gid: "9999",
            permalink_url: "https://app.asana.com/0/project/9999",
          };
        },
      });

      const backend = createAsanaBackend({ client, workspaceId: "ws123" });
      const taskPage = makeTaskPage({
        title: "New feature",
        description: "Build this thing",
        tags: ["feature"],
      });

      const result = await backend.push(taskPage);

      expect(result.success).toBe(true);
      expect(result.ref).toBe("9999");
      expect(result.url).toBe("https://app.asana.com/0/project/9999");
      expect(capturedParams[0].name).toBe("New feature");
      expect(capturedParams[0].notes).toBe("Build this thing");
      expect(capturedParams[0].workspace).toBe("ws123");
    });

    it("sets completed=true when pushing a done task", async () => {
      const capturedParams: Record<string, unknown>[] = [];
      const client = makeMockClient({
        createTask: async (params) => {
          capturedParams.push(params);
          return {
            gid: "8888",
            permalink_url: "https://app.asana.com/0/project/8888",
          };
        },
      });

      const backend = createAsanaBackend({ client, workspaceId: "ws123" });
      const taskPage = makeTaskPage({
        title: "Completed task",
        status: "done",
      });

      await backend.push(taskPage);

      expect(capturedParams[0].completed).toBe(true);
    });

    it("includes due date when available", async () => {
      const capturedParams: Record<string, unknown>[] = [];
      const client = makeMockClient({
        createTask: async (params) => {
          capturedParams.push(params);
          return {
            gid: "7777",
            permalink_url: "https://app.asana.com/0/project/7777",
          };
        },
      });

      const backend = createAsanaBackend({ client, workspaceId: "ws123" });
      const taskPage = makeTaskPage({
        title: "Due task",
        due: "2024-03-15",
      });

      await backend.push(taskPage);

      expect(capturedParams[0].due_on).toBe("2024-03-15");
    });
  });

  describe("comment", () => {
    it("adds a story to an Asana task via asana_ref", async () => {
      const capturedCalls: { taskGid: string; text: string }[] = [];
      const client = makeMockClient({
        createStory: async (taskGid, text) => {
          capturedCalls.push({ taskGid, text });
          return { gid: "story123", text: "Great work!" };
        },
      });

      const backend = createAsanaBackend({ client });
      const taskPage = makeTaskPage({
        ref: "1234567890",
        asana_ref: "https://app.asana.com/0/project/1234567890",
      });

      const result = await backend.comment(taskPage, "Great work!");

      expect(result.success).toBe(true);
      expect(capturedCalls[0].taskGid).toBe("1234567890");
      expect(capturedCalls[0].text).toBe("Great work!");
    });

    it("uses ref when asana_ref is not set", async () => {
      const capturedCalls: { taskGid: string; text: string }[] = [];
      const client = makeMockClient({
        createStory: async (taskGid, text) => {
          capturedCalls.push({ taskGid, text });
          return { gid: "s1" };
        },
      });

      const backend = createAsanaBackend({ client });
      const taskPage = makeTaskPage({ ref: "5555", asana_ref: null });

      await backend.comment(taskPage, "A comment");

      expect(capturedCalls[0].taskGid).toBe("5555");
    });

    it("throws when no reference is available", async () => {
      const backend = createAsanaBackend({ client: makeMockClient() });
      const taskPage = makeTaskPage({ ref: null, asana_ref: null });

      await expect(backend.comment(taskPage, "oops")).rejects.toThrow(
        "Cannot comment: task page has no Asana reference"
      );
    });
  });

  describe("unsupported operations", () => {
    it("throws clear error for transition", async () => {
      const backend = createAsanaBackend({ client: makeMockClient() });
      await expect(
        backend.transition(makeTaskPage(), "done")
      ).rejects.toThrow('Backend "asana" does not support "transition"');
    });
  });

  describe("checkAsanaConnectivityRest", () => {
    it("returns authenticated when REST API responds", async () => {
      const fetch = async (url: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: { gid: "12345", name: "Test User", email: "test@example.com" },
        }),
        text: async () => "",
      }) as Response;

      const result = await checkAsanaConnectivityRest({ token: "test-token", fetch });
      expect(result.authenticated).toBe(true);
      expect(result.user).toBe("Test User");
    });

    it("returns not authenticated when token is missing", async () => {
      const result = await checkAsanaConnectivityRest({ token: undefined });
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("ASANA_ACCESS_TOKEN");
    });

    it("returns not authenticated when REST API fails", async () => {
      const fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ errors: [{ message: "Not Authorized" }] }),
        text: async () => '{"errors":[{"message":"Not Authorized"}]}',
      }) as Response;

      const result = await checkAsanaConnectivityRest({ token: "bad-token", fetch });
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain("Asana REST API check failed");
    });
  });
});

describe("Backend factory — Asana", () => {
  it("getBackend returns an Asana backend for asana config", () => {
    const backend = getBackend(
      { type: "asana", mcp_server: "asana" },
      { token: "test-token" }
    );
    expect(backend.name).toBe("asana");
    expect(backend.capabilities).toContain("ingest");
    expect(backend.capabilities).toContain("pull");
    expect(backend.capabilities).toContain("push");
    expect(backend.capabilities).toContain("comment");
  });

  it("checkConnectivity delegates to Asana REST for asana config", async () => {
    const fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: { gid: "12345", name: "User", email: "u@e.com" },
      }),
      text: async () => "",
    }) as Response;

    const result = await checkConnectivity(
      { type: "asana", mcp_server: "asana" },
      { token: "test-token", fetch }
    );
    expect(result.authenticated).toBe(true);
    expect(result.user).toBe("User");
  });
});

describe("parseTaskRef", () => {
  it("classifies a numeric GID as kind: gid", () => {
    expect(parseTaskRef("1234567890")).toEqual({
      kind: "gid",
      gid: "1234567890",
    });
  });

  it("classifies an Asana URL as kind: gid and extracts the GID", () => {
    expect(
      parseTaskRef("https://app.asana.com/0/project/1234567890"),
    ).toEqual({ kind: "gid", gid: "1234567890" });
  });

  it("classifies PREFIX-NUMBER as a custom ID", () => {
    expect(parseTaskRef("TIK-4647")).toEqual({
      kind: "custom_id",
      customId: "TIK-4647",
    });
    expect(parseTaskRef("ECOMM-123")).toEqual({
      kind: "custom_id",
      customId: "ECOMM-123",
    });
  });

  it("is case-insensitive on the prefix letters", () => {
    expect(parseTaskRef("bug-9")).toEqual({
      kind: "custom_id",
      customId: "bug-9",
    });
  });

  it("does not treat all-numeric strings as custom IDs", () => {
    expect(parseTaskRef("1234567890")).toEqual({
      kind: "gid",
      gid: "1234567890",
    });
  });

  it("does not treat URLs as custom IDs even if their path contains a hyphen", () => {
    const result = parseTaskRef(
      "https://app.asana.com/0/1234567890/9876543210",
    );
    expect(result.kind).toBe("gid");
  });
});
