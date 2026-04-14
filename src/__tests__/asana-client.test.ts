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

  describe("getTaskByCustomId", () => {
    it("fetches a task by custom ID scoped to a workspace", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: {
              gid: "1234567890",
              name: "Fix login bug",
              notes: "",
              completed: false,
              completed_at: null,
              assignee: null,
              due_on: null,
              memberships: [],
              tags: [],
              permalink_url: "https://app.asana.com/0/project/1234567890",
              custom_fields: [],
            },
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const task = await client.getTaskByCustomId("ws-42", "TIK-4647");

      expect(task.gid).toBe("1234567890");
      expect(capturedUrl).toContain("/workspaces/ws-42/tasks/custom_id/TIK-4647");
      expect(capturedUrl).toContain("opt_fields=");
    });

    it("URL-encodes custom IDs that contain special characters", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return { status: 200, body: { data: { gid: "1", name: "x", notes: "", completed: false, completed_at: null, assignee: null, due_on: null, memberships: [], tags: [], permalink_url: "", custom_fields: [] } } };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      await client.getTaskByCustomId("ws", "TIK/4647");

      expect(capturedUrl).toContain("TIK%2F4647");
    });

    it("throws on 404 when no task has the given custom ID", async () => {
      const fetch = mockFetch(() => ({
        status: 404,
        body: { errors: [{ message: "Not Found" }] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      await expect(
        client.getTaskByCustomId("ws-42", "DOES-NOT-EXIST")
      ).rejects.toThrow("404");
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

  describe("getTasksForProject", () => {
    it("fetches tasks for a project GID", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              {
                gid: "t1",
                name: "Task 1",
                notes: "",
                completed: false,
                completed_at: null,
                assignee: null,
                due_on: null,
                memberships: [],
                tags: [],
                permalink_url: "https://app.asana.com/0/proj/t1",
                custom_fields: [],
              },
              {
                gid: "t2",
                name: "Task 2",
                notes: "",
                completed: true,
                completed_at: "2024-01-20T00:00:00.000Z",
                assignee: { name: "Alice", gid: "111" },
                due_on: null,
                memberships: [],
                tags: [],
                permalink_url: "https://app.asana.com/0/proj/t2",
                custom_fields: [],
              },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const tasks = await client.getTasksForProject("proj123");

      expect(tasks).toHaveLength(2);
      expect(tasks[0].gid).toBe("t1");
      expect(tasks[1].gid).toBe("t2");
      expect(capturedUrl).toContain("/projects/proj123/tasks");
      expect(capturedUrl).toContain("opt_fields=");
    });

    it("uses workspace search endpoint when assigneeGid is present", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return { status: 200, body: { data: [] } };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      await client.getTasksForProject("proj123", {
        assigneeGid: "me123",
        workspaceGid: "ws456",
      });

      expect(capturedUrl).toContain("/workspaces/ws456/tasks/search");
      expect(capturedUrl).toContain("projects.any=proj123");
      expect(capturedUrl).toContain("assignee.any=me123");
      expect(capturedUrl).not.toContain("/projects/proj123/tasks");
    });

    it("throws when assigneeGid is present but workspaceGid is missing", async () => {
      const fetch = mockFetch(() => ({ status: 200, body: { data: [] } }));
      const client = createAsanaClient({ token: "test-token", fetch });

      await expect(
        client.getTasksForProject("proj123", { assigneeGid: "me123" })
      ).rejects.toThrow(/workspaceGid/i);
    });

    it("returns empty array when project has no tasks", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const tasks = await client.getTasksForProject("proj-empty");
      expect(tasks).toEqual([]);
    });
  });

  describe("getTasksForSection", () => {
    it("fetches tasks for a section GID", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              {
                gid: "t1",
                name: "Section Task",
                notes: "In a section",
                completed: false,
                completed_at: null,
                assignee: null,
                due_on: null,
                memberships: [],
                tags: [],
                permalink_url: "https://app.asana.com/0/proj/t1",
                custom_fields: [],
              },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const tasks = await client.getTasksForSection("sec456");

      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe("Section Task");
      expect(capturedUrl).toContain("/sections/sec456/tasks");
      expect(capturedUrl).toContain("opt_fields=");
    });

    it("uses workspace search endpoint when assigneeGid is present", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return { status: 200, body: { data: [] } };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      await client.getTasksForSection("sec456", {
        assigneeGid: "me123",
        workspaceGid: "ws789",
      });

      expect(capturedUrl).toContain("/workspaces/ws789/tasks/search");
      expect(capturedUrl).toContain("sections.any=sec456");
      expect(capturedUrl).toContain("assignee.any=me123");
      expect(capturedUrl).not.toContain("/sections/sec456/tasks");
    });

    it("returns empty array when section has no tasks", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const tasks = await client.getTasksForSection("sec-empty");
      expect(tasks).toEqual([]);
    });
  });

  describe("getAttachments", () => {
    it("fetches attachments for a task GID with opt_fields", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              {
                gid: "a1",
                name: "screenshot.png",
                download_url: "https://s3.amazonaws.com/asana/screenshot.png",
                resource_subtype: "asana",
              },
              {
                gid: "a2",
                name: "spec.pdf",
                download_url: "https://s3.amazonaws.com/asana/spec.pdf",
                resource_subtype: "asana",
              },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const attachments = await client.getAttachments("1234567890");

      expect(attachments).toHaveLength(2);
      expect(attachments[0].name).toBe("screenshot.png");
      expect(attachments[0].download_url).toBe(
        "https://s3.amazonaws.com/asana/screenshot.png"
      );
      expect(attachments[1].name).toBe("spec.pdf");
      expect(capturedUrl).toContain("/tasks/1234567890/attachments");
      expect(capturedUrl).toContain("opt_fields=");
    });

    it("returns empty array when task has no attachments", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const attachments = await client.getAttachments("999");
      expect(attachments).toEqual([]);
    });
  });

  describe("downloadFile", () => {
    it("downloads a file and returns a Buffer", async () => {
      const fileContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
      const fetch = async (url: string) => {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => fileContent.buffer,
        } as unknown as Response;
      };

      const client = createAsanaClient({ token: "test-token", fetch });
      const result = await client.downloadFile(
        "https://s3.amazonaws.com/asana/screenshot.png"
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result[0]).toBe(0x89);
      expect(result.length).toBe(4);
    });

    it("throws on download failure", async () => {
      const fetch = async () => {
        return {
          ok: false,
          status: 403,
          text: async () => "Forbidden",
        } as unknown as Response;
      };

      const client = createAsanaClient({ token: "test-token", fetch });
      await expect(
        client.downloadFile("https://s3.amazonaws.com/asana/expired.png")
      ).rejects.toThrow("403");
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

  describe("getWorkspaces", () => {
    it("fetches all workspaces for the authenticated user", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              { gid: "ws1", name: "My Company" },
              { gid: "ws2", name: "Personal" },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const workspaces = await client.getWorkspaces();

      expect(workspaces).toHaveLength(2);
      expect(workspaces[0].gid).toBe("ws1");
      expect(workspaces[0].name).toBe("My Company");
      expect(workspaces[1].gid).toBe("ws2");
      expect(capturedUrl).toContain("/workspaces");
    });

    it("returns empty array when user has no workspaces", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const workspaces = await client.getWorkspaces();
      expect(workspaces).toEqual([]);
    });
  });

  describe("getProjects", () => {
    it("fetches projects for a workspace GID", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              { gid: "p1", name: "Website Redesign" },
              { gid: "p2", name: "Mobile App" },
              { gid: "p3", name: "API v2" },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const projects = await client.getProjects("ws1");

      expect(projects).toHaveLength(3);
      expect(projects[0].gid).toBe("p1");
      expect(projects[0].name).toBe("Website Redesign");
      expect(capturedUrl).toContain("/workspaces/ws1/projects");
    });

    it("returns empty array when workspace has no projects", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const projects = await client.getProjects("ws-empty");
      expect(projects).toEqual([]);
    });
  });

  describe("getCustomFieldSettings", () => {
    it("fetches custom field settings for a project GID", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            data: [
              {
                gid: "cfs1",
                custom_field: { gid: "cf1", name: "ECOMM", resource_subtype: "text", id_prefix: "ECOMM" },
              },
              {
                gid: "cfs2",
                custom_field: { gid: "cf2", name: "Priority Override", resource_subtype: "enum", id_prefix: null },
              },
            ],
          },
        };
      });

      const client = createAsanaClient({ token: "test-token", fetch });
      const settings = await client.getCustomFieldSettings("p1");

      expect(settings).toHaveLength(2);
      expect(settings[0].custom_field.gid).toBe("cf1");
      expect(settings[0].custom_field.name).toBe("ECOMM");
      expect(settings[0].custom_field.id_prefix).toBe("ECOMM");
      expect(capturedUrl).toContain("/projects/p1/custom_field_settings");
      expect(capturedUrl).toContain("custom_field.id_prefix");
    });

    it("returns empty array when project has no custom fields", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { data: [] },
      }));

      const client = createAsanaClient({ token: "test-token", fetch });
      const settings = await client.getCustomFieldSettings("p-empty");
      expect(settings).toEqual([]);
    });
  });
});
