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
import type { JiraClient, JiraIssue, JiraComment } from "./jira-client.js";

/**
 * Default mapping from Jira status names (lowercased) to controlled vocabulary statuses.
 * Configurable per project via workspace.md status_map.
 */
export const DEFAULT_STATUS_MAP: Record<string, Status> = {
  "backlog": "backlog",
  "to do": "to-do",
  "open": "to-do",
  "in progress": "in-progress",
  "in review": "in-review",
  "review": "in-review",
  "waiting": "pending",
  "pending": "pending",
  "on hold": "pending",
  "blocked": "blocked",
  "done": "done",
  "closed": "done",
  "resolved": "done",
  "deferred": "deferred",
  "won't do": "deferred",
};

/**
 * Reverse mapping: controlled vocabulary status to Jira transition name.
 * Used when executing transitions via the Jira API.
 */
const STATUS_TO_TRANSITION: Record<Status, string> = {
  "backlog": "Backlog",
  "to-do": "To Do",
  "in-progress": "In Progress",
  "in-review": "In Review",
  "pending": "Waiting",
  "blocked": "Blocked",
  "done": "Done",
  "deferred": "Deferred",
};

/**
 * Map a Jira issue status name to the controlled vocabulary status.
 * Accepts an optional custom status map for project-specific overrides.
 */
export function mapJiraStatusToStatus(
  jiraStatus: string,
  statusMap?: Record<string, Status>
): Status {
  const map = statusMap ?? DEFAULT_STATUS_MAP;
  const normalized = jiraStatus.toLowerCase();
  return map[normalized] ?? "backlog";
}

/**
 * Map a controlled vocabulary status to a Jira transition name.
 */
export function mapStatusToJiraTransition(status: Status): string {
  return STATUS_TO_TRANSITION[status];
}

/**
 * Convert a Jira issue + comments from the REST API into a TaskPage.
 */
function jiraIssueToPage(
  issue: JiraIssue,
  comments: JiraComment[],
  serverUrl: string,
  statusMap?: Record<string, Status>
): TaskPage {
  const status = mapJiraStatusToStatus(issue.fields.status.name, statusMap);
  const formattedComments = comments.map(
    (c) => `**${c.author.displayName}** (${c.created}):\n${c.body}`
  );

  return {
    title: issue.fields.summary,
    ref: issue.key,
    source: "jira",
    status,
    priority: issue.fields.priority?.name ?? null,
    assignee: issue.fields.assignee?.displayName ?? null,
    tags: issue.fields.labels,
    created: issue.fields.created,
    updated: issue.fields.updated,
    closed: issue.fields.resolutiondate ?? (status === "done" ? issue.fields.updated : null),
    pushed: null,
    due: issue.fields.duedate ?? null,
    jira_ref: `${serverUrl}/browse/${issue.key}`,
    asana_ref: null,
    gh_ref: null,
    comment_count: comments.length,
    description: issue.fields.description ?? "",
    comments: formattedComments,
  };
}

export interface JiraBackendOptions {
  client: JiraClient;
  serverUrl: string;
  projectKey?: string;
  statusMap?: Record<string, Status>;
}

/**
 * Create a Jira backend instance.
 * Supports: ingest, pull, push, comment, transition (full support).
 *
 * Uses the Jira REST API client for all interactions.
 * Inject `client` for testing with mocked responses.
 */
export function createJiraBackend(options: JiraBackendOptions): Backend {
  const { client, serverUrl, projectKey, statusMap } = options;

  function issueKeyFromTaskPage(taskPage: TaskPage): string {
    if (taskPage.jira_ref) {
      const match = taskPage.jira_ref.match(/\/browse\/([A-Z]+-\d+)/);
      if (match) return match[1];
    }
    if (taskPage.ref) return taskPage.ref;
    throw new Error("No Jira issue key found");
  }

  return {
    name: "jira",
    capabilities: ["ingest", "pull", "push", "comment", "transition"],

    async ingest(ref: string): Promise<TaskPage> {
      const issue = await client.getIssue(ref);
      const comments = await client.getComments(ref);
      return jiraIssueToPage(issue, comments, serverUrl, statusMap);
    },

    async pull(taskPage: TaskPage): Promise<PullResult> {
      if (!taskPage.jira_ref && !taskPage.ref) {
        throw new Error(
          "Cannot pull: task page has no Jira reference (jira_ref or ref)"
        );
      }

      const issueKey = issueKeyFromTaskPage(taskPage);
      const issue = await client.getIssue(issueKey);
      const comments = await client.getComments(issueKey);

      const changes: string[] = [];
      const newStatus = mapJiraStatusToStatus(issue.fields.status.name, statusMap);

      if (newStatus !== taskPage.status) {
        changes.push(`status: ${taskPage.status} -> ${newStatus}`);
      }

      const newCommentCount = comments.length;
      if (newCommentCount > taskPage.comment_count) {
        changes.push(`comments: ${newCommentCount - taskPage.comment_count} new`);
      }

      return {
        updated: changes.length > 0,
        changes,
      };
    },

    async push(taskPage: TaskPage): Promise<PushResult> {
      if (!projectKey) {
        throw new Error(
          "Cannot push: no Jira project key configured. Set project_key in your backend config."
        );
      }

      const result = await client.createIssue({
        project: { key: projectKey },
        summary: taskPage.title,
        description: taskPage.description,
        issuetype: { name: "Task" },
        labels: taskPage.tags,
      });

      return {
        success: true,
        ref: result.key,
        url: `${serverUrl}/browse/${result.key}`,
      };
    },

    async comment(taskPage: TaskPage, text: string): Promise<CommentResult> {
      if (!taskPage.jira_ref && !taskPage.ref) {
        throw new Error(
          "Cannot comment: task page has no Jira reference (jira_ref or ref)"
        );
      }

      const issueKey = issueKeyFromTaskPage(taskPage);
      await client.addComment(issueKey, text);

      return {
        success: true,
        commentUrl: `${serverUrl}/browse/${issueKey}`,
      };
    },

    async transition(taskPage: TaskPage, status: Status): Promise<TransitionResult> {
      if (!taskPage.jira_ref && !taskPage.ref) {
        throw new Error(
          "Cannot transition: task page has no Jira reference (jira_ref or ref)"
        );
      }

      const issueKey = issueKeyFromTaskPage(taskPage);
      const targetTransitionName = mapStatusToJiraTransition(status);

      const transitions = await client.getTransitions(issueKey);

      const transition = transitions.find(
        (t) => t.name.toLowerCase() === targetTransitionName.toLowerCase()
      );

      if (!transition) {
        const available = transitions.map((t) => t.name).join(", ");
        throw new Error(
          `Transition "${targetTransitionName}" is not available for ${issueKey}. Available: ${available}`
        );
      }

      await client.transitionIssue(issueKey, transition.id);

      return {
        success: true,
        previousStatus: taskPage.status,
        newStatus: status,
      };
    },
  };
}

/**
 * Check Jira connectivity via REST API.
 * Calls GET /myself with Basic Auth from JIRA_EMAIL + JIRA_API_TOKEN.
 */
export async function checkJiraConnectivityRest(
  options?: {
    serverUrl?: string;
    email?: string;
    apiToken?: string;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  }
): Promise<ConnectivityResult> {
  const serverUrl = options?.serverUrl;
  const email = options?.email ?? process.env.JIRA_EMAIL;
  const apiToken = options?.apiToken ?? process.env.JIRA_API_TOKEN;

  if (!serverUrl) {
    return {
      authenticated: false,
      error:
        "Jira server_url is not configured. Set server_url in your backend config. See references/backend-setup.md for instructions.",
    };
  }

  if (!email) {
    return {
      authenticated: false,
      error:
        "JIRA_EMAIL is not set. Export your Jira account email as JIRA_EMAIL. See references/backend-setup.md for instructions.",
    };
  }

  if (!apiToken) {
    return {
      authenticated: false,
      error:
        "JIRA_API_TOKEN is not set. Export your Jira API token as JIRA_API_TOKEN. See references/backend-setup.md for instructions.",
    };
  }

  try {
    const { createJiraClient } = await import("./jira-client.js");
    const client = createJiraClient({ serverUrl, email, apiToken, fetch: options?.fetch });
    const user = await client.getMyself();
    return { authenticated: true, user: user.displayName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      authenticated: false,
      error: `Jira REST API check failed: ${message}. Verify your JIRA_EMAIL and JIRA_API_TOKEN are valid. See references/backend-setup.md for instructions.`,
    };
  }
}
