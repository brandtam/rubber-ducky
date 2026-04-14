import { describe, it, expect } from "vitest";
import {
  createAsanaClient,
  type AsanaClientOptions,
  type AsanaClient,
} from "../lib/asana-client.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown }
): FetchFn {
  return async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    } as Response;
  };
}

describe("AsanaClient", () => {
  describe("auth", () => {
    it("throws on request when ASANA_ACCESS_TOKEN is not set", async () => {
      const client = createAsanaClient({ token: undefined as unknown as string });
      await expect(client.getMe()).rejects.toThrow("ASANA_ACCESS_TOKEN");
    });

    it("throws on request when ASANA_ACCESS_TOKEN is empty string", async () => {
      const client = createAsanaClient({ token: "" });
      await expect(client.getMe()).rejects.toThrow("ASANA_ACCESS_TOKEN");
    });

    it("sends Bearer token in Authorization header", async () => {
      let capturedHeaders: HeadersInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedHeaders = init?.headers;
        return { status: 200, body: { data: { gid: "me", name: "Test" } } };
      });

      const client = createAsanaClient({ token: "xoxp-test-token", fetch });
      await client.getMe();

      expect(capturedHeaders).toBeDefined();
      expect((capturedHeaders as Record<string, string>)["Authorization"]).toBe(
        "Bearer xoxp-test-token"
      );
    });
  });

  describe("getMe", () => {
    it("returns authenticated user info", async () => {
      const fetch = mockFetch((url) => {
        if (url.includes("/users/me")) {
          return {
            status: 200,
            body: {
              data: {
                gid: "12345",
                name: "Test User",
                email: "test@example.com",
              },
            },
          };
        }
        return { status: 404, body: {} };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const result = await client.getMe();

      expect(result.gid).toBe("12345");
      expect(result.name).toBe("Test User");
      expect(result.email).toBe("test@example.com");
    });

    it("throws on 401 unauthorized", async () => {
      const fetch = mockFetch(() => ({
        status: 401,
        body: { errors: [{ message: "Not Authorized" }] },
      }));

      const client = createAsanaClient({ token: "bad-token", fetch });
      await expect(client.getMe()).rejects.toThrow("401");
    });
  });

  describe("getTask", () => {
    it("fetches a task by GID with full opt_fields", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: {
              gid: "1234567890",
              name: "Fix login bug",
              notes: "The login form crashes",
              completed: false,
              completed_at: null,
              assignee: { name: "Alice", gid: "111" },
              due_on: "2024-02-15",
              memberships: [
                { section: { name: "In Progress", gid: "s1" } },
              ],
              tags: [{ name: "bug" }],
              permalink_url: "https://app.asana.com/0/project/1234567890",
              custom_fields: [],
            },
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const task = await client.getTask("1234567890");

      expect(task.gid).toBe("1234567890");
      expect(task.name).toBe("Fix login bug");
      expect(task.notes).toBe("The login form crashes");
      expect(task.assignee?.name).toBe("Alice");
      expect(capturedUrl).toContain("/tasks/1234567890");
      expect(capturedUrl).toContain("opt_fields=");
    });

    it("throws on 404 not found", async () => {
      const fetch = mockFetch(() => ({
        status: 404,
        body: { errors: [{ message: "task: Unknown object" }] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      await expect(client.getTask("nonexistent")).rejects.toThrow("404");
    });
  });

  describe("getStories", () => {
    it("fetches stories for a task GID", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              {
                gid: "s1",
                type: "comment",
                text: "I can reproduce this",
                created_by: { name: "Bob", gid: "222" },
                created_at: "2024-01-15T10:00:00.000Z",
              },
              {
                gid: "s2",
                type: "system",
                text: "Bob moved this task",
                created_by: { name: "Bob", gid: "222" },
                created_at: "2024-01-15T11:00:00.000Z",
              },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const stories = await client.getStories("1234567890");

      expect(stories).toHaveLength(2);
      expect(stories[0].type).toBe("comment");
      expect(stories[0].text).toBe("I can reproduce this");
      expect(stories[0].created_by.name).toBe("Bob");
      expect(capturedUrl).toContain("/tasks/1234567890/stories");
    });

    it("returns empty array when task has no stories", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const stories = await client.getStories("999");
      expect(stories).toEqual([]);
    });
  });

  describe("createTask", () => {
    it("creates a task via POST /tasks", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          status: 201,
          body: {
            data: {
              gid: "9999",
              name: "New task",
              permalink_url: "https://app.asana.com/0/project/9999",
            },
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const result = await client.createTask({
        workspace: "ws123",
        name: "New task",
        notes: "Task description",
        completed: false,
        due_on: "2024-03-15",
      });

      expect(capturedUrl).toContain("/tasks");
      expect(capturedInit?.method).toBe("POST");
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.data.name).toBe("New task");
      expect(body.data.notes).toBe("Task description");
      expect(body.data.workspace).toBe("ws123");
      expect(body.data.completed).toBe(false);
      expect(body.data.due_on).toBe("2024-03-15");
      expect(result.gid).toBe("9999");
      expect(result.permalink_url).toBe(
        "https://app.asana.com/0/project/9999"
      );
    });

    it("throws on API error", async () => {
      const fetch = mockFetch(() => ({
        status: 400,
        body: { errors: [{ message: "Invalid request" }] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      await expect(
        client.createTask({ name: "Bad task" })
      ).rejects.toThrow("400");
    });
  });

  describe("createStory", () => {
    it("creates a story via POST /tasks/{gid}/stories", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          status: 201,
          body: {
            data: {
              gid: "story456",
              text: "Great work!",
            },
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const result = await client.createStory("1234567890", "Great work!");

      expect(capturedUrl).toContain("/tasks/1234567890/stories");
      expect(capturedInit?.method).toBe("POST");
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.data.text).toBe("Great work!");
      expect(result.gid).toBe("story456");
    });

    it("throws on API error", async () => {
      const fetch = mockFetch(() => ({
        status: 404,
        body: { errors: [{ message: "task: Unknown object" }] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      await expect(
        client.createStory("nonexistent", "comment")
      ).rejects.toThrow("404");
    });
  });
});
