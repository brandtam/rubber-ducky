import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "../lib/frontmatter.js";
import {
  ingestAsanaTask,
  ingestAsanaBulk,
  resolveScope,
  parseAsanaRef,
  type IngestAsanaOptions,
  type IngestResult,
  type BulkIngestResult,
} from "../lib/asana-ingest.js";
import type { AsanaClient } from "../lib/asana-client.js";
import type { IngestScope } from "../lib/workspace.js";

function makeTask(overrides?: Record<string, unknown>) {
  return {
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
    ...overrides,
  };
}

function makeMockClient(overrides?: {
  task?: Record<string, unknown>;
  stories?: Record<string, unknown>[];
  attachments?: Record<string, unknown>[];
  downloadData?: Buffer;
  projectTasks?: Record<string, unknown>[];
  sectionTasks?: Record<string, unknown>[];
  me?: Record<string, unknown>;
  /** Map of custom_id → task override for getTaskByCustomId. */
  customIdTasks?: Record<string, Record<string, unknown>>;
  /** Custom IDs that should simulate a 404. */
  customIdNotFound?: string[];
}): AsanaClient {
  const task = makeTask(overrides?.task);

  const stories = overrides?.stories ?? [
    {
      gid: "s1",
      type: "comment",
      text: "I can reproduce this",
      created_by: { name: "Bob", gid: "222" },
      created_at: "2024-01-15T10:00:00.000Z",
    },
  ];

  const attachments = overrides?.attachments ?? [];
  const downloadData = overrides?.downloadData ?? Buffer.from("file-content");

  const taskMap = new Map<string, Record<string, unknown>>();
  taskMap.set(task.gid as string, task);
  if (overrides?.projectTasks) {
    for (const t of overrides.projectTasks) {
      taskMap.set(t.gid as string, t);
    }
  }
  if (overrides?.sectionTasks) {
    for (const t of overrides.sectionTasks) {
      taskMap.set(t.gid as string, t);
    }
  }

  const customIdMap = new Map<string, Record<string, unknown>>();
  for (const [customId, taskData] of Object.entries(overrides?.customIdTasks ?? {})) {
    customIdMap.set(customId, taskData);
  }
  const customIdNotFound = new Set(overrides?.customIdNotFound ?? []);

  return {
    getMe: async () => ({
      gid: "me-gid",
      name: "Test User",
      email: "test@example.com",
      ...overrides?.me,
    }),
    getTask: async (gid: string) => taskMap.get(gid) ?? task,
    getTaskByCustomId: async (_workspaceGid: string, customId: string) => {
      if (customIdNotFound.has(customId)) {
        throw new Error(`Asana API 404: no task for custom_id ${customId}`);
      }
      const found = customIdMap.get(customId);
      if (!found) {
        throw new Error(`Asana API 404: no task for custom_id ${customId}`);
      }
      return found;
    },
    getStories: async () => stories,
    getAttachments: async () => attachments,
    downloadFile: async () => downloadData,
    getTasksForProject: async () => overrides?.projectTasks ?? [],
    getTasksForSection: async () => overrides?.sectionTasks ?? [],
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
      expect(fm.ref).toBe("fix-the-login-bug");
      expect(fm.source).toBe("asana");
      expect(fm.status).toBe("in-progress");
      expect(fm.assignee).toBe("Alice");
      expect(fm.due).toBe("2024-02-15");
      expect(fm.asana_ref).toBe("https://app.asana.com/0/project/1234567890");
      expect(fm.tags).toEqual(["bug", "urgent"]);
      expect(fm.comment_count).toBe(1);
      expect(fm.asana_status_raw).toBe("In Progress");
      expect(fm.jira_needed).toBeNull();
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

      // Description section with verbatim notes (backend-scoped)
      expect(body).toContain("## Asana description");
      expect(body).toContain("The login form crashes on submit");

      // Comments section with attribution (backend-scoped)
      expect(body).toContain("## Asana comments");
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
        getAttachments: async () => [],
        downloadFile: async () => Buffer.from(""),
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

    it("translates status via workspace status-mapping config", async () => {
      // Seed a status-mapping.md that maps Asana "In Progress" → "in-review"
      fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "wiki", "status-mapping.md"),
        [
          "---",
          "type: config",
          "---",
          "",
          "## Asana → wiki",
          "",
          "- `In Progress` → `in-review`",
        ].join("\n")
      );

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
      const fm = parsed!.data;

      // Canonical status overridden by status-mapping config
      expect(fm.status).toBe("in-review");
      // Raw status preserved
      expect(fm.asana_status_raw).toBe("In Progress");
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
      expect(log).toContain("fix-the-login-bug");
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
      expect(result.taskPage!.ref).toBe("fix-the-login-bug");
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

  describe("identifier_field", () => {
    it("uses custom field display_value as ref and filename when identifier_field matches", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "ECOMM", display_value: "ECOMM-4643" },
          ],
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ECOMM",
      });

      expect(result.success).toBe(true);
      expect(result.taskPage!.ref).toBe("ECOMM-4643");
      expect(result.filePath).toContain("ECOMM-4643.md");
    });

    it("matches identifier_field case-insensitively", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "Ecomm Number", display_value: "ECOMM-100" },
          ],
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ecomm number",
      });

      expect(result.taskPage!.ref).toBe("ECOMM-100");
      expect(result.filePath).toContain("ECOMM-100.md");
    });

    it("falls back to GID when custom field is not present", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "Other Field", display_value: "xyz" },
          ],
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ECOMM",
      });

      expect(result.taskPage!.ref).toBe("1234567890");
      // Falls back to GID-based filename (centralized in naming module)
      expect(result.filePath).toContain("1234567890.md");
    });

    it("falls back to GID when display_value is null", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "ECOMM", display_value: null },
          ],
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ECOMM",
      });

      expect(result.taskPage!.ref).toBe("1234567890");
      // Falls back to GID-based filename (centralized in naming module)
      expect(result.filePath).toContain("1234567890.md");
    });

    it("falls back to GID when display_value is empty string", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "ECOMM", display_value: "" },
          ],
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ECOMM",
      });

      expect(result.taskPage!.ref).toBe("1234567890");
    });

    it("preserves asana_ref as permalink URL regardless of identifier_field", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "ECOMM", display_value: "ECOMM-4643" },
          ],
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ECOMM",
      });

      expect(result.taskPage!.asana_ref).toBe(
        "https://app.asana.com/0/project/1234567890"
      );
    });
  });

  describe("attachments", () => {
    it("downloads attachments to raw/assets/<ref>/", async () => {
      const client = makeMockClient({
        attachments: [
          {
            gid: "a1",
            name: "screenshot.png",
            download_url: "https://s3.amazonaws.com/asana/screenshot.png",
            resource_subtype: "asana",
          },
        ],
        downloadData: Buffer.from("png-data"),
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      // Asset dir follows the naming scheme (title-based when no identifier)
      const assetPath = path.join(
        tmpDir,
        "raw",
        "assets",
        "fix-the-login-bug",
        "screenshot.png"
      );
      expect(fs.existsSync(assetPath)).toBe(true);
      expect(fs.readFileSync(assetPath, "utf-8")).toBe("png-data");
    });

    it("embeds image attachments with ![alt](path) syntax", async () => {
      const client = makeMockClient({
        attachments: [
          {
            gid: "a1",
            name: "screenshot.png",
            download_url: "https://s3.amazonaws.com/asana/screenshot.png",
            resource_subtype: "asana",
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
      expect(content).toContain("## Attachments");
      expect(content).toContain(
        "![screenshot.png](../../raw/assets/fix-the-login-bug/screenshot.png)"
      );
    });

    it("links non-image attachments with [name](path) syntax", async () => {
      const client = makeMockClient({
        attachments: [
          {
            gid: "a1",
            name: "spec.pdf",
            download_url: "https://s3.amazonaws.com/asana/spec.pdf",
            resource_subtype: "asana",
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
      expect(content).toContain("## Attachments");
      expect(content).toContain(
        "[spec.pdf](../../raw/assets/fix-the-login-bug/spec.pdf)"
      );
      // Should NOT use image embed syntax
      expect(content).not.toContain("![spec.pdf]");
    });

    it("uses resolved identifier for asset directory", async () => {
      const client = makeMockClient({
        task: {
          custom_fields: [
            { gid: "cf1", name: "ECOMM", display_value: "ECOMM-4643" },
          ],
        },
        attachments: [
          {
            gid: "a1",
            name: "mockup.jpg",
            download_url: "https://s3.amazonaws.com/asana/mockup.jpg",
            resource_subtype: "asana",
          },
        ],
        downloadData: Buffer.from("jpg-data"),
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        identifierField: "ECOMM",
      });

      const assetPath = path.join(
        tmpDir,
        "raw",
        "assets",
        "ECOMM-4643",
        "mockup.jpg"
      );
      expect(fs.existsSync(assetPath)).toBe(true);
      // Page references should use the identifier-based path
      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      expect(content).toContain("raw/assets/ECOMM-4643/mockup.jpg");
    });

    it("includes attachment count in result", async () => {
      const client = makeMockClient({
        attachments: [
          {
            gid: "a1",
            name: "file1.png",
            download_url: "https://s3.amazonaws.com/asana/file1.png",
            resource_subtype: "asana",
          },
          {
            gid: "a2",
            name: "file2.pdf",
            download_url: "https://s3.amazonaws.com/asana/file2.pdf",
            resource_subtype: "asana",
          },
        ],
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      expect(result.attachmentCount).toBe(2);
    });

    it("skips attachments with null download_url", async () => {
      const client = makeMockClient({
        attachments: [
          {
            gid: "a1",
            name: "external-link.txt",
            download_url: null,
            resource_subtype: "external",
          },
        ],
      });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      const assetDir = path.join(tmpDir, "raw", "assets", "fix-the-login-bug");
      // Asset directory should not be created for non-downloadable attachments
      expect(fs.existsSync(assetDir)).toBe(false);
      expect(result.attachmentCount).toBe(1);
    });

    it("handles task with no attachments gracefully", async () => {
      const client = makeMockClient({ attachments: [] });

      const result = await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
      });

      expect(result.attachmentCount).toBe(0);
      const content = fs.readFileSync(
        path.join(tmpDir, result.filePath!),
        "utf-8"
      );
      // No Attachments section when there are no attachments
      expect(content).not.toContain("## Attachments");
    });
  });

  describe("custom ID resolution", () => {
    it("resolves a custom ID ref via getTaskByCustomId", async () => {
      const client = makeMockClient({
        customIdTasks: {
          "TIK-4647": makeTask({
            gid: "1234567890",
            name: "Fix the login bug",
          }),
        },
      });

      const result = await ingestAsanaTask({
        client,
        ref: "TIK-4647",
        workspaceRoot: tmpDir,
        workspaceGid: "ws-42",
      });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      const content = fs.readFileSync(path.join(tmpDir, result.filePath!), "utf-8");
      const parsed = parseFrontmatter(content);
      expect(parsed!.data.title).toBe("Fix the login bug");
    });

    it("throws a clear error when workspaceGid is missing for a custom ID ref", async () => {
      const client = makeMockClient();

      await expect(
        ingestAsanaTask({
          client,
          ref: "TIK-4647",
          workspaceRoot: tmpDir,
          // workspaceGid deliberately omitted
        }),
      ).rejects.toThrow(/workspace_id is not configured/);
    });

    it("surfaces Asana's 404 when the custom ID does not exist", async () => {
      const client = makeMockClient({
        customIdNotFound: ["MISSING-999"],
      });

      await expect(
        ingestAsanaTask({
          client,
          ref: "MISSING-999",
          workspaceRoot: tmpDir,
          workspaceGid: "ws-42",
        }),
      ).rejects.toThrow(/404/);
    });

    it("still uses getTask (not getTaskByCustomId) for numeric GIDs", async () => {
      let customIdCalls = 0;
      let getTaskCalls = 0;
      const client = {
        ...makeMockClient(),
        getTask: async (gid: string) => {
          getTaskCalls++;
          return makeTask({ gid });
        },
        getTaskByCustomId: async () => {
          customIdCalls++;
          throw new Error("should not have been called");
        },
      } as AsanaClient;

      await ingestAsanaTask({
        client,
        ref: "1234567890",
        workspaceRoot: tmpDir,
        workspaceGid: "ws-42",
      });

      expect(getTaskCalls).toBe(1);
      expect(customIdCalls).toBe(0);
    });
  });
});

describe("parseAsanaRef", () => {
  it("parses project:<gid> format", () => {
    const result = parseAsanaRef("project:12345");
    expect(result).toEqual({ type: "project", gid: "12345" });
  });

  it("parses section:<gid> format", () => {
    const result = parseAsanaRef("section:67890");
    expect(result).toEqual({ type: "section", gid: "67890" });
  });

  it("parses plain GID as task", () => {
    const result = parseAsanaRef("1234567890");
    expect(result).toEqual({ type: "task", gid: "1234567890" });
  });

  it("parses Asana URL as task", () => {
    const result = parseAsanaRef("https://app.asana.com/0/111111/1234567890");
    expect(result).toEqual({ type: "task", gid: "1234567890" });
  });
});

describe("resolveScope", () => {
  it("returns 'mine' when no flags and no config", () => {
    expect(resolveScope({})).toBe("mine");
  });

  it("returns 'mine' when --mine flag is set", () => {
    expect(resolveScope({ mine: true })).toBe("mine");
  });

  it("returns 'all' when --all flag is set", () => {
    expect(resolveScope({ all: true })).toBe("all");
  });

  it("CLI flag overrides config: --all overrides config mine", () => {
    expect(resolveScope({ all: true, configScope: "mine" })).toBe("all");
  });

  it("CLI flag overrides config: --mine overrides config all", () => {
    expect(resolveScope({ mine: true, configScope: "all" })).toBe("mine");
  });

  it("uses config scope when no flags", () => {
    expect(resolveScope({ configScope: "mine" })).toBe("mine");
  });

  it("config 'ask' defaults to 'mine' at CLI level", () => {
    expect(resolveScope({ configScope: "ask" })).toBe("mine");
  });
});

describe("ingestAsanaBulk", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-bulk-test-"));
    setupWorkspace(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("project bulk ingest", () => {
    it("ingests all tasks from a project", async () => {
      const tasks = [
        makeTask({ gid: "t1", name: "Task One", permalink_url: "https://app.asana.com/0/p/t1" }),
        makeTask({ gid: "t2", name: "Task Two", permalink_url: "https://app.asana.com/0/p/t2" }),
      ];

      const client = makeMockClient({ projectTasks: tasks });
      const result = await ingestAsanaBulk({
        client,
        ref: "project:proj123",
        workspaceRoot: tmpDir,
      });

      expect(result.ingested).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].skipped).toBe(false);
      expect(result.results[1].success).toBe(true);
    });

    it("skips already-ingested tasks during bulk ingest", async () => {
      // Create existing task
      const existingContent = [
        "---",
        "title: Task One",
        "type: task",
        "ref: t1",
        "source: asana",
        "status: to-do",
        "asana_ref: https://app.asana.com/0/p/t1",
        "created: 2024-01-01T00:00:00.000Z",
        "comment_count: 0",
        "---",
      ].join("\n");
      fs.writeFileSync(
        path.join(tmpDir, "wiki", "tasks", "task-one.md"),
        existingContent
      );

      const tasks = [
        makeTask({ gid: "t1", name: "Task One", permalink_url: "https://app.asana.com/0/p/t1" }),
        makeTask({ gid: "t2", name: "Task Two", permalink_url: "https://app.asana.com/0/p/t2" }),
      ];

      const client = makeMockClient({ projectTasks: tasks });
      const result = await ingestAsanaBulk({
        client,
        ref: "project:proj123",
        workspaceRoot: tmpDir,
      });

      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.results[0].skipped).toBe(true);
      expect(result.results[1].skipped).toBe(false);
    });

    it("returns zero counts for empty project", async () => {
      const client = makeMockClient({ projectTasks: [] });
      const result = await ingestAsanaBulk({
        client,
        ref: "project:empty-proj",
        workspaceRoot: tmpDir,
      });

      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  describe("section bulk ingest", () => {
    it("ingests all tasks from a section", async () => {
      const tasks = [
        makeTask({ gid: "s1", name: "Section Task", permalink_url: "https://app.asana.com/0/p/s1" }),
      ];

      const client = makeMockClient({ sectionTasks: tasks });
      const result = await ingestAsanaBulk({
        client,
        ref: "section:sec456",
        workspaceRoot: tmpDir,
      });

      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.results).toHaveLength(1);
    });
  });

  describe("default project", () => {
    it("uses project_gid from config when no ref provided", async () => {
      const tasks = [
        makeTask({ gid: "d1", name: "Default Project Task", permalink_url: "https://app.asana.com/0/p/d1" }),
      ];

      const client = makeMockClient({ projectTasks: tasks });
      const result = await ingestAsanaBulk({
        client,
        workspaceRoot: tmpDir,
        defaultProjectGid: "default-proj",
      });

      expect(result.ingested).toBe(1);
      expect(result.results[0].taskPage?.title).toBe("Default Project Task");
    });

    it("errors when no ref and no default project configured", async () => {
      const client = makeMockClient();
      await expect(
        ingestAsanaBulk({
          client,
          workspaceRoot: tmpDir,
        })
      ).rejects.toThrow(/no ref.*no default project/i);
    });
  });

  describe("scope filtering", () => {
    it("passes assignee GID and workspace GID for mine scope", async () => {
      let capturedOpts: unknown;
      const client = {
        getMe: async () => ({ gid: "me-gid", name: "Test User", email: "test@example.com" }),
        getTask: async (gid: string) => makeTask({ gid }),
        getStories: async () => [],
        getTasksForProject: async (_gid: string, opts?: unknown) => {
          capturedOpts = opts;
          return [];
        },
        getTasksForSection: async () => [],
      } as AsanaClient;

      await ingestAsanaBulk({
        client,
        ref: "project:proj123",
        workspaceRoot: tmpDir,
        scope: "mine",
        workspaceGid: "ws-123",
      });

      expect(capturedOpts).toEqual({ assigneeGid: "me-gid", workspaceGid: "ws-123" });
    });

    it("passes assignee GID and workspace GID for mine scope on section path", async () => {
      let capturedOpts: unknown;
      const client = {
        getMe: async () => ({ gid: "me-gid", name: "Test User", email: "test@example.com" }),
        getTask: async (gid: string) => makeTask({ gid }),
        getStories: async () => [],
        getTasksForProject: async () => [],
        getTasksForSection: async (_gid: string, opts?: unknown) => {
          capturedOpts = opts;
          return [];
        },
      } as AsanaClient;

      await ingestAsanaBulk({
        client,
        ref: "section:sec456",
        workspaceRoot: tmpDir,
        scope: "mine",
        workspaceGid: "ws-123",
      });

      expect(capturedOpts).toEqual({ assigneeGid: "me-gid", workspaceGid: "ws-123" });
    });

    it("does not pass assignee GID for all scope", async () => {
      let capturedOpts: unknown;
      const client = {
        getMe: async () => ({ gid: "me-gid", name: "Test User", email: "test@example.com" }),
        getTask: async (gid: string) => makeTask({ gid }),
        getStories: async () => [],
        getTasksForProject: async (_gid: string, opts?: unknown) => {
          capturedOpts = opts;
          return [];
        },
        getTasksForSection: async () => [],
      } as AsanaClient;

      await ingestAsanaBulk({
        client,
        ref: "project:proj123",
        workspaceRoot: tmpDir,
        scope: "all",
      });

      expect(capturedOpts).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Merged-page in-place re-ingest (issue #89)
// ---------------------------------------------------------------------------

describe("Asana ingest on merged pages", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-asana-merged-test-"));
    setupWorkspace(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Seed a merged page at wiki/tasks/ECOMM-4643 (WEB-297).md */
  function seedMergedPage(): string {
    const content = [
      "---",
      "title: Fix checkout flow",
      "type: task",
      "ref: ECOMM-4643",
      "source: asana",
      "status: in-progress",
      "priority: High",
      "assignee: Alice Smith",
      "tags:",
      "  - bug",
      "created: 2024-01-15T10:00:00.000Z",
      "updated: 2024-01-16T12:00:00.000Z",
      "closed: null",
      "pushed: null",
      "due: null",
      "jira_ref: https://myorg.atlassian.net/browse/WEB-297",
      "asana_ref: https://app.asana.com/0/project/1234567890",
      "gh_ref: null",
      "jira_needed: yes",
      "comment_count: 3",
      "asana_status_raw: In Progress",
      "jira_status_raw: To Do",
      "---",
      "## Asana description",
      "",
      "Old Asana description content",
      "",
      "## Jira description",
      "",
      "Original Jira description content",
      "",
      "## Asana comments",
      "",
      "**OldAsanaUser** (2024-01-10T10:00:00.000Z)",
      "",
      "Old Asana comment",
      "",
      "## Jira comments",
      "",
      "**JiraUser** (2024-01-12T10:00:00.000Z)",
      "",
      "Jira comment text",
      "",
      "## Activity log",
      "",
      "- 2024-01-15T10:00:00.000Z — Ingested from Asana (ECOMM-4643)",
      "- 2024-01-16T10:00:00.000Z — Merged ECOMM-4643 + WEB-297",
      "",
      "## See also",
      "",
    ].join("\n");

    const filename = "ECOMM-4643 (WEB-297).md";
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", filename),
      content
    );
    return filename;
  }

  function makeMergedAsanaClient(): AsanaClient {
    const task = makeTask({
      gid: "1234567890",
      name: "Fix checkout flow",
      notes: "Updated Asana description from re-ingest",
      memberships: [{ section: { name: "Done", gid: "s1" } }],
      permalink_url: "https://app.asana.com/0/project/1234567890",
      custom_fields: [
        { name: "Ticket ID", display_value: "ECOMM-4643" },
      ],
    });

    const stories = [
      {
        gid: "s2",
        type: "comment",
        text: "New Asana comment from re-ingest",
        created_by: { name: "NewAsanaUser", gid: "333" },
        created_at: "2024-01-20T10:00:00.000Z",
      },
    ];

    return {
      getMe: async () => ({ gid: "me-gid", name: "Test User", email: "test@example.com" }),
      getTask: async () => task,
      getTaskByCustomId: async () => task,
      getStories: async () => stories,
      getAttachments: async () => [],
      downloadFile: async () => Buffer.from(""),
      getTasksForProject: async () => [task],
      getTasksForSection: async () => [],
    } as AsanaClient;
  }

  it("updates Asana sections in place on a merged page", async () => {
    seedMergedPage();

    const client = makeMergedAsanaClient();
    const result = await ingestAsanaTask({
      client,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.filePath).toContain("ECOMM-4643 (WEB-297).md");

    const content = fs.readFileSync(
      path.join(tmpDir, result.filePath!),
      "utf-8"
    );
    const parsed = parseFrontmatter(content);
    const body = parsed!.body;

    // Asana sections updated
    expect(body).toContain("## Asana description");
    expect(body).toContain("Updated Asana description from re-ingest");
    expect(body).not.toContain("Old Asana description content");

    expect(body).toContain("## Asana comments");
    expect(body).toContain("**NewAsanaUser**");
    expect(body).toContain("New Asana comment from re-ingest");
    expect(body).not.toContain("Old Asana comment");
  });

  it("preserves Jira sections untouched", async () => {
    seedMergedPage();

    const client = makeMergedAsanaClient();
    const result = await ingestAsanaTask({
      client,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    const content = fs.readFileSync(
      path.join(tmpDir, result.filePath!),
      "utf-8"
    );
    const parsed = parseFrontmatter(content);
    const body = parsed!.body;

    // Jira sections untouched
    expect(body).toContain("## Jira description");
    expect(body).toContain("Original Jira description content");
    expect(body).toContain("## Jira comments");
    expect(body).toContain("**JiraUser**");
    expect(body).toContain("Jira comment text");
  });

  it("updates asana_status_raw in frontmatter", async () => {
    seedMergedPage();

    const client = makeMergedAsanaClient();
    const result = await ingestAsanaTask({
      client,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    const content = fs.readFileSync(
      path.join(tmpDir, result.filePath!),
      "utf-8"
    );
    const parsed = parseFrontmatter(content);

    expect(parsed!.data.asana_status_raw).toBe("Done");
  });

  it("preserves Jira frontmatter fields", async () => {
    seedMergedPage();

    const client = makeMergedAsanaClient();
    const result = await ingestAsanaTask({
      client,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    const content = fs.readFileSync(
      path.join(tmpDir, result.filePath!),
      "utf-8"
    );
    const parsed = parseFrontmatter(content);
    const fm = parsed!.data;

    // Jira-side frontmatter preserved
    expect(fm.jira_ref).toBe("https://myorg.atlassian.net/browse/WEB-297");
    expect(fm.jira_status_raw).toBe("To Do");
    expect(fm.jira_needed).toBe("yes");
    expect(fm.source).toBe("asana");
    expect(fm.ref).toBe("ECOMM-4643");
  });

  it("never creates a standalone ECOMM-4643.md file", async () => {
    seedMergedPage();

    const client = makeMergedAsanaClient();
    await ingestAsanaTask({
      client,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    const standaloneExists = fs.existsSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-4643.md")
    );
    expect(standaloneExists).toBe(false);
  });

  it("appends re-ingest entry to activity log", async () => {
    seedMergedPage();

    const client = makeMergedAsanaClient();
    const result = await ingestAsanaTask({
      client,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    const content = fs.readFileSync(
      path.join(tmpDir, result.filePath!),
      "utf-8"
    );

    // Original activity log preserved
    expect(content).toContain("Ingested from Asana (ECOMM-4643)");
    expect(content).toContain("Merged ECOMM-4643 + WEB-297");
    // New re-ingest entry appended
    expect(content).toContain("Re-ingested Asana side (ECOMM-4643)");
  });

  it("bulk ingest updates merged pages in place", async () => {
    seedMergedPage();

    const task = makeTask({
      gid: "1234567890",
      name: "Fix checkout flow",
      notes: "Bulk-updated Asana description",
      memberships: [{ section: { name: "Done", gid: "s1" } }],
      permalink_url: "https://app.asana.com/0/project/1234567890",
      custom_fields: [
        { name: "Ticket ID", display_value: "ECOMM-4643" },
      ],
    });

    const client = {
      getMe: async () => ({ gid: "me-gid", name: "Test User", email: "test@example.com" }),
      getTask: async () => task,
      getTaskByCustomId: async () => task,
      getStories: async () => [],
      getAttachments: async () => [],
      downloadFile: async () => Buffer.from(""),
      getTasksForProject: async () => [task],
      getTasksForSection: async () => [],
    } as AsanaClient;

    const results = await ingestAsanaBulk({
      client,
      ref: "project:proj123",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    expect(results.ingested).toBe(1);
    expect(results.skipped).toBe(0);
    expect(results.results[0].success).toBe(true);
    expect(results.results[0].skipped).toBe(false);
    expect(results.results[0].filePath).toContain("ECOMM-4643 (WEB-297).md");

    // Verify the merged page was updated
    const content = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-4643 (WEB-297).md"),
      "utf-8"
    );
    expect(content).toContain("Bulk-updated Asana description");
    // No orphan
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-4643.md"))
    ).toBe(false);
  });
});
