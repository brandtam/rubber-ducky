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
  checkAsanaConnectivity,
  checkAsanaConnectivityRest,
  type McpCall,
} from "../lib/asana-backend.js";

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
    comment_count: 0,
    description: "",
    comments: [],
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
      const backend = createAsanaBackend({ mcp: () => ({}) });
      expect(backend.capabilities).toContain("ingest");
      expect(backend.capabilities).toContain("pull");
      expect(backend.capabilities).toContain("push");
      expect(backend.capabilities).toContain("comment");
    });

    it("does not support transition", () => {
      const backend = createAsanaBackend({ mcp: () => ({}) });
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
      };

      const mockStories = [
        {
          type: "comment",
          text: "I can reproduce this",
          created_by: { name: "Bob" },
          created_at: "2024-01-15T10:00:00Z",
        },
      ];

      const mcp: McpCall = (tool, params) => {
        if (tool === "asana_get_task") {
          return mockTask;
        }
        if (tool === "asana_get_task_stories") {
          return mockStories;
        }
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
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
      };

      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
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
      };

      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
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
      };

      const mockStories = [
        {
          type: "comment",
          text: "First comment",
          created_by: { name: "Alice" },
          created_at: "2024-01-10T10:00:00Z",
        },
        {
          type: "system",
          text: "Alice moved this task",
          created_by: { name: "Alice" },
          created_at: "2024-01-10T11:00:00Z",
        },
        {
          type: "comment",
          text: "Second comment",
          created_by: { name: "Bob" },
          created_at: "2024-01-11T11:00:00Z",
        },
      ];

      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return mockStories;
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
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
      };

      const calls: { tool: string; params: Record<string, unknown> }[] = [];
      const mcp: McpCall = (tool, params) => {
        calls.push({ tool, params });
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
      await backend.ingest("https://app.asana.com/0/project/1234567890");

      // Should extract the task GID from the URL
      expect(calls[0].params.task_gid).toBe("1234567890");
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
      };

      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const statusMapping = { "Sprint 42": "in-progress" };
      const backend = createAsanaBackend({ mcp, statusMapping });
      const page = await backend.ingest("888");

      expect(page.status).toBe("in-progress");
    });
  });

  describe("bulk ingest", () => {
    it("ingests all tasks from an Asana project", async () => {
      const mockProjectTasks = [
        {
          gid: "101",
          name: "Task 1",
          notes: "Description 1",
          completed: false,
          completed_at: null,
          assignee: null,
          due_on: null,
          memberships: [],
          tags: [],
          permalink_url: "https://app.asana.com/0/project/101",
        },
        {
          gid: "102",
          name: "Task 2",
          notes: "Description 2",
          completed: true,
          completed_at: "2024-01-20T00:00:00Z",
          assignee: { name: "Alice", gid: "111" },
          due_on: null,
          memberships: [],
          tags: [],
          permalink_url: "https://app.asana.com/0/project/102",
        },
      ];

      const mcp: McpCall = (tool, params) => {
        if (tool === "asana_get_tasks_for_project") return mockProjectTasks;
        if (tool === "asana_get_task") {
          return mockProjectTasks.find(
            (t) => t.gid === (params as { task_gid: string }).task_gid
          );
        }
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
      // Bulk ingest uses the ref format "project:PROJECT_GID"
      const page = await backend.ingest("project:9876");

      // Bulk ingest returns a special TaskPage with bulk results
      expect(page.title).toContain("project:9876");
      expect(page.description).toContain("Task 1");
      expect(page.description).toContain("Task 2");
    });

    it("ingests all tasks from an Asana section", async () => {
      const mockSectionTasks = [
        {
          gid: "201",
          name: "Section Task 1",
          notes: "Section desc 1",
          completed: false,
          completed_at: null,
          assignee: null,
          due_on: null,
          memberships: [],
          tags: [],
          permalink_url: "https://app.asana.com/0/project/201",
        },
      ];

      const mcp: McpCall = (tool, params) => {
        if (tool === "asana_get_tasks_for_section") return mockSectionTasks;
        if (tool === "asana_get_task") {
          return mockSectionTasks.find(
            (t) => t.gid === (params as { task_gid: string }).task_gid
          );
        }
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
      const page = await backend.ingest("section:5555");

      expect(page.title).toContain("section:5555");
      expect(page.description).toContain("Section Task 1");
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
      };

      const mockStories = [
        {
          type: "comment",
          text: "New comment",
          created_by: { name: "Dave" },
          created_at: "2024-02-01T10:00:00Z",
        },
      ];

      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return mockStories;
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
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
      };

      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_task") return mockTask;
        if (tool === "asana_get_task_stories") return [];
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
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
      const backend = createAsanaBackend({ mcp: () => ({}) });
      const taskPage = makeTaskPage({ asana_ref: null, ref: null });

      await expect(backend.pull(taskPage)).rejects.toThrow(
        "Cannot pull: task page has no Asana reference"
      );
    });
  });

  describe("push", () => {
    it("creates a new Asana task from a wiki task page", async () => {
      const calls: { tool: string; params: Record<string, unknown> }[] = [];
      const mcp: McpCall = (tool, params) => {
        calls.push({ tool, params });
        if (tool === "asana_create_task") {
          return {
            gid: "9999",
            permalink_url: "https://app.asana.com/0/project/9999",
          };
        }
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp, workspaceId: "ws123" });
      const taskPage = makeTaskPage({
        title: "New feature",
        description: "Build this thing",
        tags: ["feature"],
      });

      const result = await backend.push(taskPage);

      expect(result.success).toBe(true);
      expect(result.ref).toBe("9999");
      expect(result.url).toBe("https://app.asana.com/0/project/9999");
      expect(calls[0].tool).toBe("asana_create_task");
      expect(calls[0].params.name).toBe("New feature");
      expect(calls[0].params.notes).toBe("Build this thing");
    });

    it("sets completed=true when pushing a done task", async () => {
      const calls: { tool: string; params: Record<string, unknown> }[] = [];
      const mcp: McpCall = (tool, params) => {
        calls.push({ tool, params });
        if (tool === "asana_create_task") {
          return {
            gid: "8888",
            permalink_url: "https://app.asana.com/0/project/8888",
          };
        }
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp, workspaceId: "ws123" });
      const taskPage = makeTaskPage({
        title: "Completed task",
        status: "done",
      });

      await backend.push(taskPage);

      expect(calls[0].params.completed).toBe(true);
    });

    it("includes due date and assignee when available", async () => {
      const calls: { tool: string; params: Record<string, unknown> }[] = [];
      const mcp: McpCall = (tool, params) => {
        calls.push({ tool, params });
        if (tool === "asana_create_task") {
          return {
            gid: "7777",
            permalink_url: "https://app.asana.com/0/project/7777",
          };
        }
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp, workspaceId: "ws123" });
      const taskPage = makeTaskPage({
        title: "Due task",
        due: "2024-03-15",
      });

      await backend.push(taskPage);

      expect(calls[0].params.due_on).toBe("2024-03-15");
    });
  });

  describe("comment", () => {
    it("adds a story to an Asana task via asana_ref", async () => {
      const calls: { tool: string; params: Record<string, unknown> }[] = [];
      const mcp: McpCall = (tool, params) => {
        calls.push({ tool, params });
        if (tool === "asana_create_task_story") {
          return {
            gid: "story123",
            text: "Great work!",
          };
        }
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
      const taskPage = makeTaskPage({
        ref: "1234567890",
        asana_ref: "https://app.asana.com/0/project/1234567890",
      });

      const result = await backend.comment(taskPage, "Great work!");

      expect(result.success).toBe(true);
      expect(calls[0].tool).toBe("asana_create_task_story");
      expect(calls[0].params.task_gid).toBe("1234567890");
      expect(calls[0].params.text).toBe("Great work!");
    });

    it("uses ref when asana_ref is not set", async () => {
      const calls: { tool: string; params: Record<string, unknown> }[] = [];
      const mcp: McpCall = (tool, params) => {
        calls.push({ tool, params });
        if (tool === "asana_create_task_story") return { gid: "s1", text: "" };
        throw new Error(`unexpected tool: ${tool}`);
      };

      const backend = createAsanaBackend({ mcp });
      const taskPage = makeTaskPage({ ref: "5555", asana_ref: null });

      await backend.comment(taskPage, "A comment");

      expect(calls[0].params.task_gid).toBe("5555");
    });

    it("throws when no reference is available", async () => {
      const backend = createAsanaBackend({ mcp: () => ({}) });
      const taskPage = makeTaskPage({ ref: null, asana_ref: null });

      await expect(backend.comment(taskPage, "oops")).rejects.toThrow(
        "Cannot comment: task page has no Asana reference"
      );
    });
  });

  describe("unsupported operations", () => {
    it("throws clear error for transition", async () => {
      const backend = createAsanaBackend({ mcp: () => ({}) });
      await expect(
        backend.transition(makeTaskPage(), "done")
      ).rejects.toThrow('Backend "asana" does not support "transition"');
    });
  });

  describe("checkAsanaConnectivity (MCP, legacy)", () => {
    it("returns authenticated when MCP server responds", () => {
      const mcp: McpCall = (tool) => {
        if (tool === "asana_get_me") {
          return { name: "Test User", email: "test@example.com" };
        }
        throw new Error(`unexpected tool: ${tool}`);
      };
      const result = checkAsanaConnectivity(mcp);
      expect(result.authenticated).toBe(true);
      expect(result.user).toBe("Test User");
    });

    it("returns not authenticated when MCP server fails", () => {
      const mcp: McpCall = () => {
        throw new Error("MCP server not running");
      };
      const result = checkAsanaConnectivity(mcp);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Asana MCP");
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
      { mcp: () => ({}) }
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
