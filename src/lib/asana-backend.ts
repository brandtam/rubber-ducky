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
import type { AsanaClient, AsanaTask, AsanaStory } from "./asana-client.js";

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
  statusMapping?: Record<string, Status>
): Status {
  if (completed) return "done";
  if (!sectionName) return "to-do";

  const normalized = sectionName.toLowerCase().replace(/\s+/g, "-");

  // Check custom mapping first (case-insensitive)
  if (statusMapping) {
    for (const [key, value] of Object.entries(statusMapping)) {
      if (key.toLowerCase().replace(/\s+/g, "-") === normalized) {
        return value;
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
export function extractTaskGid(ref: string): string {
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
 * Classify a task ref string as either a GID-style reference (numeric or
 * Asana URL) or an Asana custom ID (e.g. "TIK-4647") produced by an ID
 * custom field. Custom IDs require a separate API endpoint scoped to the
 * workspace.
 */
export type TaskRef =
  | { kind: "gid"; gid: string }
  | { kind: "custom_id"; customId: string };

// Matches Asana custom IDs: alphabetic prefix, hyphen, digits. Deliberately
// narrow so plain GIDs (all digits) and URLs (contain slashes/"asana.com")
// do not collide. Examples that match: TIK-4647, ECOMM-123, Bug-9.
const CUSTOM_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

export function parseTaskRef(ref: string): TaskRef {
  if (ref.includes("asana.com")) {
    return { kind: "gid", gid: extractTaskGid(ref) };
  }
  if (CUSTOM_ID_PATTERN.test(ref)) {
    return { kind: "custom_id", customId: ref };
  }
  // Plain GID (or anything else — the Asana API will surface a clear error)
  return { kind: "gid", gid: ref };
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
 * Convert a raw Asana task + stories into a TaskPage.
 * When resolvedRef is provided (e.g., from identifier_field), it overrides the GID as ref.
 */
export function asanaTaskToPage(
  task: AsanaTask,
  stories: AsanaStory[],
  statusMapping?: Record<string, Status>,
  resolvedRef?: string | null
): TaskPage {
  const sectionName = task.memberships?.[0]?.section?.name;
  const status = mapAsanaToStatus(task.completed, sectionName, statusMapping);
  const now = new Date().toISOString();

  const comments = stories
    .filter((s) => s.type === "comment" && s.text)
    .map((s) => `**${s.created_by?.name ?? "Unknown"}** \u2014 ${s.created_at}:\n${s.text}`);

  return {
    title: task.name ?? "Untitled",
    ref: resolvedRef ?? task.gid,
    source: "asana",
    status,
    priority: null,
    assignee: task.assignee?.name ?? null,
    tags: (task.tags ?? []).filter((t) => t?.name).map((t) => t.name),
    created: task.created_at ?? now,
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
  client: AsanaClient;
  workspaceId?: string;
  statusMapping?: Record<string, Status>;
}

/**
 * Create an Asana backend instance.
 * Supports: ingest, pull, push, comment.
 *
 * Uses the Asana REST API client for all interactions.
 * Inject `client` for testing with mocked responses.
 */
export function createAsanaBackend(options: AsanaBackendOptions): Backend {
  const { client, workspaceId, statusMapping } = options;

  return {
    name: "asana",
    capabilities: ["ingest", "pull", "push", "comment"],

    async ingest(ref: string): Promise<TaskPage> {
      // Single task ingest (bulk ingest via project:/section: is handled
      // by the ingest orchestration layer in asana-ingest.ts)
      const taskGid = extractTaskGid(ref);
      const task = await client.getTask(taskGid);
      const stories = await client.getStories(taskGid);

      return asanaTaskToPage(task, stories, statusMapping);
    },

    async pull(taskPage: TaskPage): Promise<PullResult> {
      const taskGid = resolveTaskGid(taskPage);
      if (!taskGid) {
        throw new Error(
          "Cannot pull: task page has no Asana reference (asana_ref or ref)"
        );
      }

      const task = await client.getTask(taskGid);
      const stories = await client.getStories(taskGid);

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

      const result = await client.createTask(params);

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

      await client.createStory(taskGid, text);

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
