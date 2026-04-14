import type {
  Backend,
  TaskPage,
  PullResult,
  PushResult,
  CommentResult,
  TransitionResult,
  Status,
  ConnectivityResult,
} from "./backend.js";
import { VALID_STATUSES } from "./backend.js";

/**
 * Type for an injectable MCP call function.
 * The real implementation calls the Asana MCP server;
 * tests inject a mock.
 */
export type McpCall = (
  tool: string,
  params: Record<string, unknown>
) => unknown;

interface AsanaTask {
  gid: string;
  name: string;
  notes: string;
  completed: boolean;
  completed_at: string | null;
  assignee: { name: string; gid: string } | null;
  due_on: string | null;
  memberships: { section: { name: string; gid: string } }[];
  tags: { name: string }[];
  permalink_url: string;
}

interface AsanaStory {
  type: string;
  text: string;
  created_by: { name: string };
  created_at: string;
}

/**
 * Map an Asana task's completion state and section name to the controlled vocabulary status.
 *
 * Completed tasks always map to "done". For incomplete tasks, the first section
 * membership is matched against the controlled vocabulary (case-insensitive,
 * space/hyphen normalized). Custom mapping overrides default section matching.
 */
export function mapAsanaToStatus(
  completed: boolean,
  sectionName?: string,
  statusMapping?: Record<string, string>
): Status {
  if (completed) return "done";
  if (!sectionName) return "to-do";

  const normalized = sectionName.toLowerCase().replace(/\s+/g, "-");

  // Check custom mapping first (case-insensitive)
  if (statusMapping) {
    for (const [key, value] of Object.entries(statusMapping)) {
      if (key.toLowerCase().replace(/\s+/g, "-") === normalized) {
        return value as Status;
      }
    }
  }

  // Match against known statuses
  if (VALID_STATUSES.includes(normalized as Status)) {
    return normalized as Status;
  }

  return "to-do";
}

/**
 * Map a controlled vocabulary status to Asana's completed flag.
 * Asana uses a simple completed boolean — "done" means completed.
 */
export function mapStatusToAsanaCompleted(status: Status): boolean {
  return status === "done";
}

/**
 * Extract an Asana task GID from a reference string.
 * Accepts plain GIDs or full Asana URLs.
 */
function extractTaskGid(ref: string): string {
  // URL format: https://app.asana.com/0/PROJECT_GID/TASK_GID
  // The task GID is the last numeric segment in the path
  if (ref.includes("asana.com")) {
    const match = ref.match(/\/(\d+)\s*$/);
    if (match) return match[1];
  }

  // Plain GID
  return ref;
}

/**
 * Extract a task GID from an asana_ref URL or ref field.
 */
function resolveTaskGid(taskPage: TaskPage): string | null {
  if (taskPage.asana_ref) {
    const urlMatch = taskPage.asana_ref.match(/\/(\d+)\s*$/);
    if (urlMatch) return urlMatch[1];
  }
  return taskPage.ref;
}

/**
 * Convert a raw Asana task object to a TaskPage.
 */
function asanaTaskToPage(
  task: AsanaTask,
  stories: AsanaStory[],
  statusMapping?: Record<string, string>
): TaskPage {
  const sectionName = task.memberships?.[0]?.section?.name;
  const status = mapAsanaToStatus(task.completed, sectionName, statusMapping);
  const now = new Date().toISOString();

  const comments = stories
    .filter((s) => s.type === "comment")
    .map((s) => `**${s.created_by.name}** (${s.created_at}):\n${s.text}`);

  return {
    title: task.name,
    ref: task.gid,
    source: "asana",
    status,
    priority: null,
    assignee: task.assignee?.name ?? null,
    tags: task.tags.map((t) => t.name),
    created: now,
    updated: now,
    closed: task.completed ? (task.completed_at ?? now) : null,
    pushed: null,
    due: task.due_on ?? null,
    jira_ref: null,
    asana_ref: task.permalink_url,
    gh_ref: null,
    comment_count: comments.length,
    description: task.notes ?? "",
    comments,
  };
}

export interface AsanaBackendOptions {
  mcp: McpCall;
  workspaceId?: string;
  statusMapping?: Record<string, string>;
}

/**
 * Create an Asana backend instance.
 * Supports: ingest, pull, push, comment.
 *
 * Uses the Asana MCP server for all API interactions.
 * Inject `mcp` for testing with mocked MCP responses.
 */
export function createAsanaBackend(options: AsanaBackendOptions): Backend {
  const { mcp, workspaceId, statusMapping } = options;

  return {
    name: "asana",
    capabilities: ["ingest", "pull", "push", "comment"],

    async ingest(ref: string): Promise<TaskPage> {
      // Bulk ingest: "project:GID" or "section:GID"
      if (ref.startsWith("project:")) {
        const projectGid = ref.replace("project:", "");
        const tasks = mcp("asana_get_tasks_for_project", {
          project_gid: projectGid,
        }) as AsanaTask[];

        const pages: TaskPage[] = [];
        for (const task of tasks) {
          const fullTask = mcp("asana_get_task", {
            task_gid: task.gid,
          }) as AsanaTask;
          const stories = (mcp("asana_get_task_stories", {
            task_gid: task.gid,
          }) ?? []) as AsanaStory[];
          pages.push(asanaTaskToPage(fullTask, stories, statusMapping));
        }

        // Return a summary TaskPage for bulk operations
        const taskList = pages
          .map((p) => `- ${p.title} (${p.ref}) [${p.status}]`)
          .join("\n");

        return {
          title: `Bulk ingest: ${ref}`,
          ref,
          source: "asana",
          status: "to-do",
          priority: null,
          assignee: null,
          tags: [],
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          closed: null,
          pushed: null,
          due: null,
          jira_ref: null,
          asana_ref: null,
          gh_ref: null,
          comment_count: 0,
          description: `Ingested ${pages.length} tasks:\n${taskList}`,
          comments: [],
        };
      }

      if (ref.startsWith("section:")) {
        const sectionGid = ref.replace("section:", "");
        const tasks = mcp("asana_get_tasks_for_section", {
          section_gid: sectionGid,
        }) as AsanaTask[];

        const pages: TaskPage[] = [];
        for (const task of tasks) {
          const fullTask = mcp("asana_get_task", {
            task_gid: task.gid,
          }) as AsanaTask;
          const stories = (mcp("asana_get_task_stories", {
            task_gid: task.gid,
          }) ?? []) as AsanaStory[];
          pages.push(asanaTaskToPage(fullTask, stories, statusMapping));
        }

        const taskList = pages
          .map((p) => `- ${p.title} (${p.ref}) [${p.status}]`)
          .join("\n");

        return {
          title: `Bulk ingest: ${ref}`,
          ref,
          source: "asana",
          status: "to-do",
          priority: null,
          assignee: null,
          tags: [],
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          closed: null,
          pushed: null,
          due: null,
          jira_ref: null,
          asana_ref: null,
          gh_ref: null,
          comment_count: 0,
          description: `Ingested ${pages.length} tasks:\n${taskList}`,
          comments: [],
        };
      }

      // Single task ingest
      const taskGid = extractTaskGid(ref);
      const task = mcp("asana_get_task", { task_gid: taskGid }) as AsanaTask;
      const stories = (mcp("asana_get_task_stories", {
        task_gid: taskGid,
      }) ?? []) as AsanaStory[];

      return asanaTaskToPage(task, stories, statusMapping);
    },

    async pull(taskPage: TaskPage): Promise<PullResult> {
      const taskGid = resolveTaskGid(taskPage);
      if (!taskGid) {
        throw new Error(
          "Cannot pull: task page has no Asana reference (asana_ref or ref)"
        );
      }

      const task = mcp("asana_get_task", { task_gid: taskGid }) as AsanaTask;
      const stories = (mcp("asana_get_task_stories", {
        task_gid: taskGid,
      }) ?? []) as AsanaStory[];

      const fresh = asanaTaskToPage(task, stories, statusMapping);
      const changes: string[] = [];

      if (fresh.status !== taskPage.status) {
        changes.push(`status: ${taskPage.status} → ${fresh.status}`);
      }
      if (fresh.assignee !== taskPage.assignee) {
        changes.push(
          `assignee: ${taskPage.assignee ?? "null"} → ${fresh.assignee ?? "null"}`
        );
      }
      if (fresh.due !== taskPage.due) {
        changes.push(
          `due: ${taskPage.due ?? "null"} → ${fresh.due ?? "null"}`
        );
      }
      if (fresh.comment_count !== taskPage.comment_count) {
        changes.push(
          `comments: ${taskPage.comment_count} → ${fresh.comment_count}`
        );
      }
      if (fresh.description !== taskPage.description) {
        changes.push("description: updated");
      }

      return {
        updated: changes.length > 0,
        changes,
      };
    },

    async push(taskPage: TaskPage): Promise<PushResult> {
      const params: Record<string, unknown> = {
        name: taskPage.title,
        notes: taskPage.description,
        completed: mapStatusToAsanaCompleted(taskPage.status),
      };

      if (workspaceId) {
        params.workspace = workspaceId;
      }
      if (taskPage.due) {
        params.due_on = taskPage.due;
      }

      const result = mcp("asana_create_task", params) as {
        gid: string;
        permalink_url: string;
      };

      return {
        success: true,
        ref: result.gid,
        url: result.permalink_url,
      };
    },

    async comment(taskPage: TaskPage, text: string): Promise<CommentResult> {
      const taskGid = resolveTaskGid(taskPage);
      if (!taskGid) {
        throw new Error(
          "Cannot comment: task page has no Asana reference (asana_ref or ref)"
        );
      }

      mcp("asana_create_task_story", {
        task_gid: taskGid,
        text,
      });

      return {
        success: true,
        commentUrl: taskPage.asana_ref ?? taskGid,
      };
    },

    async transition(
      _taskPage: TaskPage,
      _status: Status
    ): Promise<TransitionResult> {
      throw new Error('Backend "asana" does not support "transition"');
    },
  };
}

/**
 * Check Asana MCP server connectivity.
 * Calls asana_get_me to verify authentication.
 * @deprecated Use checkAsanaConnectivityRest for REST-based checks.
 */
export function checkAsanaConnectivity(mcp?: McpCall): ConnectivityResult {
  if (!mcp) {
    return {
      authenticated: false,
      error:
        "Asana MCP server is not configured. Ensure the Asana MCP server is running. See references/backend-setup.md for setup instructions.",
    };
  }

  try {
    const result = mcp("asana_get_me", {}) as {
      name?: string;
      email?: string;
    };
    return { authenticated: true, user: result.name };
  } catch {
    return {
      authenticated: false,
      error:
        "Asana MCP server is not responding. Ensure the Asana MCP server is running and authenticated. See references/backend-setup.md for setup instructions.",
    };
  }
}

/**
 * Check Asana connectivity via REST API.
 * Calls GET /users/me with Bearer token from ASANA_ACCESS_TOKEN.
 */
export async function checkAsanaConnectivityRest(
  options?: { token?: string; fetch?: (url: string, init?: RequestInit) => Promise<Response> }
): Promise<ConnectivityResult> {
  const token = options?.token ?? process.env.ASANA_ACCESS_TOKEN;

  if (!token) {
    return {
      authenticated: false,
      error:
        "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for setup instructions.",
    };
  }

  try {
    const { createAsanaClient } = await import("./asana-client.js");
    const client = createAsanaClient({ token, fetch: options?.fetch });
    const user = await client.getMe();
    return { authenticated: true, user: user.name };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      authenticated: false,
      error: `Asana REST API check failed: ${message}. Verify your ASANA_ACCESS_TOKEN is valid. See references/backend-setup.md for setup instructions.`,
    };
  }
}
