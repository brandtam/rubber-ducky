import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "../lib/frontmatter.js";
import {
  ingestAsanaTask,
  type IngestAsanaOptions,
  type IngestResult,
} from "../lib/asana-ingest.js";
import type { AsanaClient } from "../lib/asana-client.js";

function makeMockClient(overrides?: {
  task?: Record<string, unknown>;
  stories?: Record<string, unknown>[];
}): AsanaClient {
  const task = {
    gid: "1234567890",
    name: "Fix the login bug",
    notes: "The login form crashes on submit",
    completed: false,
    completed_at: null,
    assignee: { name: "Alice", gid: "111" },
    due_on: "2024-02-15",
    memberships: [{ section: { name: "In Progress", gid: "s1" } }],
    tags: [{ name: "bug" }, { name: "urgent" }],
    permalink_url: "https://app.asana.com/0/project/1234567890",
    custom_fields: [],
    ...overrides?.task,
  };

  const stories = overrides?.stories ?? [
    {
      gid: "s1",
      type: "comment",
      text: "I can reproduce this",
      created_by: { name: "Bob", gid: "222" },
      created_at: "2024-01-15T10:00:00.000Z",
    },
  ];

  return {
    getMe: async () => ({ gid: "me", name: "Test User", email: "test@example.com" }),
    getTask: async () => task,
    getStories: async () => stories,
  } as AsanaClient;
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

describe("ingestAsanaTask", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-ingest-test-"));
    setupWorkspace(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("single task ingest", () => {
    it("creates a task page with full frontmatter from a GID", async () => {
      const client = makeMockClient();
      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
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
      expect(fm.title).toBe("Fix the login bug");
      expect(fm.type).toBe("task");
      expect(fm.ref).toBe("1234567890");
      expect(fm.source).toBe("asana");
      expect(fm.status).toBe("in-progress");
      expect(fm.assignee).toBe("Alice");
      expect(fm.due).toBe("2024-02-15");
      expect(fm.asana_ref).toBe("https://app.asana.com/0/project/1234567890");
      expect(fm.tags).toEqual(["bug", "urgent"]);
      expect(fm.comment_count).toBe(1);
    });

    it("creates a task page with full body sections", async () => {
      const client = makeMockClient();
      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const body = parsed!.body;

      // Description section with verbatim notes
      expect(body).toContain("## Description");
      expect(body).toContain("The login form crashes on submit");

      // Comments section with attribution
      expect(body).toContain("## Comments");
      expect(body).toContain("**Bob**");
      expect(body).toContain("2024-01-15T10:00:00.000Z");
      expect(body).toContain("I can reproduce this");

      // Activity log with timestamped ingest entry
      expect(body).toContain("## Activity log");
      expect(body).toContain("Ingested from Asana");

      // See also section
      expect(body).toContain("## See also");
    });

    it("extracts GID from Asana URL", async () => {
      let capturedGid = "";
      const client: AsanaClient = {
        getMe: async () => ({ gid: "me", name: "Test User", email: "test@example.com" }),
        getTask: async (gid) => {
          capturedGid = gid;
          return {
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
        },
        getStories: async () => [],
      };

      await ingestAsanaTask({
        client,
        ref: "https://app.asana.com/0/111111/1234567890",
        workspaceRoot: tmpDir,
      });

      expect(capturedGid).toBe("1234567890");
    });

    it("handles task with no assignee, due date, or tags", async () => {
      const client = makeMockClient({
        task: {
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
        },
        stories: [],
      });

      const result = await ingestAsanaTask({
        client,
        ref: "999",
        workspaceRoot: tmpDir,
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const fm = parsed!.data;

      expect(fm.assignee).toBeNull();
      expect(fm.due).toBeNull();
      expect(fm.tags).toEqual([]);
      expect(fm.status).toBe("to-do");
      expect(fm.comment_count).toBe(0);
    });

    it("sets closed timestamp for completed tasks", async () => {
      const client = makeMockClient({
        task: {
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
        },
        stories: [],
      });

      const result = await ingestAsanaTask({
        client,
        ref: "555",
        workspaceRoot: tmpDir,
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);

      expect(parsed!.data.status).toBe("done");
      expect(parsed!.data.closed).toBe("2024-01-20T15:30:00.000Z");
    });

    it("formats multiple comments with attribution", async () => {
      const client = makeMockClient({
        stories: [
          {
            gid: "s1",
            type: "comment",
            text: "First comment",
            created_by: { name: "Alice", gid: "111" },
            created_at: "2024-01-10T10:00:00.000Z",
          },
          {
            gid: "s2",
            type: "system",
            text: "Alice moved this task",
            created_by: { name: "Alice", gid: "111" },
            created_at: "2024-01-10T11:00:00.000Z",
          },
          {
            gid: "s3",
            type: "comment",
            text: "Second comment",
            created_by: { name: "Bob", gid: "222" },
            created_at: "2024-01-11T11:00:00.000Z",
          },
        ],
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      const parsed = parseFrontmatter(content);
      const body = parsed!.body;

      // Only comment-type stories, not system stories
      expect(parsed!.data.comment_count).toBe(2);
      expect(body).toContain("**Alice**");
      expect(body).toContain("**Bob**");
      expect(body).toContain("First comment");
      expect(body).toContain("Second comment");
      // System story should not appear
      expect(body).not.toContain("Alice moved this task");
    });
  });

  describe("dedup", () => {
    it("skips when asana_ref already exists in wiki/tasks", async () => {
      // Create an existing task page with the same asana_ref
      const existingContent = [
        "---",
        "title: Existing task",
        "type: task",
        "ref: '1234567890'",
        "source: asana",
        "status: in-progress",
        "asana_ref: https://app.asana.com/0/project/1234567890",
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
      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toContain("already ingested");
      expect(result.existingFile).toContain("existing-task.md");
    });

    it("does not skip when asana_ref does not match", async () => {
      const existingContent = [
        "---",
        "title: Different task",
        "type: task",
        "ref: '9999999999'",
        "source: asana",
        "status: to-do",
        "asana_ref: https://app.asana.com/0/project/9999999999",
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
      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      expect(result.skipped).toBe(false);
      expect(result.success).toBe(true);
    });
  });

  describe("index and log", () => {
    it("rebuilds wiki index after ingest", async () => {
      const client = makeMockClient();
      await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      const indexPath = path.join(tmpDir, "wiki", "index.md");
      expect(fs.existsSync(indexPath)).toBe(true);

      const index = fs.readFileSync(indexPath, "utf-8");
      expect(index).toContain("Fix the login bug");
    });

    it("appends to wiki log after ingest", async () => {
      const client = makeMockClient();
      await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      const logPath = path.join(tmpDir, "wiki", "log.md");
      expect(fs.existsSync(logPath)).toBe(true);

      const log = fs.readFileSync(logPath, "utf-8");
      expect(log).toContain("Ingested Asana task");
      expect(log).toContain("1234567890");
    });
  });

  describe("structured output", () => {
    it("returns complete result for successful ingest", async () => {
      const client = makeMockClient();
      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.filePath).toBeDefined();
      expect(result.taskPage).toBeDefined();
      expect(result.taskPage!.title).toBe("Fix the login bug");
      expect(result.taskPage!.ref).toBe("1234567890");
      expect(result.taskPage!.source).toBe("asana");
    });

    it("returns skip result for dedup", async () => {
      const existingContent = [
        "---",
        "title: Existing task",
        "type: task",
        "ref: '1234567890'",
        "source: asana",
        "status: in-progress",
        "asana_ref: https://app.asana.com/0/project/1234567890",
        "created: 2024-01-01T00:00:00.000Z",
        "comment_count: 0",
        "---",
      ].join("\n");

      fs.writeFileSync(
        path.join(tmpDir, "wiki", "tasks", "existing-task.md"),
        existingContent
      );

      const client = makeMockClient();
      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.reason).toBeDefined();
      expect(result.existingFile).toBeDefined();
    });
  });
});
