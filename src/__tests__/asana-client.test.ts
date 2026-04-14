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
    it("throws when ASANA_ACCESS_TOKEN is not set", () => {
      expect(() =>
        createAsanaClient({ token: undefined as unknown as string })
      ).toThrow("ASANA_ACCESS_TOKEN");
    });

    it("throws when ASANA_ACCESS_TOKEN is empty string", () => {
      expect(() => createAsanaClient({ token: "" })).toThrow(
        "ASANA_ACCESS_TOKEN"
      );
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
});
