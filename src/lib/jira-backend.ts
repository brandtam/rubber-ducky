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

interface JiraIssueJson {
  key: string;
  fields: {
    summary: string;
    description: string | null;
    status: { name: string };
    priority: { name: string } | null;
    assignee: { displayName: string } | null;
    labels: string[];
    created: string;
    updated: string;
    resolutiondate: string | null;
    duedate: string | null;
    comment: {
      total: number;
      comments: {
        body: string;
        author: { displayName: string };
        created: string;
      }[];
    };
  };
  transitions?: { id: string; name: string }[];
}

interface JiraBackendOptions {
  serverUrl: string;
  projectKey?: string;
  statusMap?: Record<string, Status>;
  exec?: (args: string[]) => string;
}

/**
 * Create a Jira backend instance.
 * Supports: ingest, pull, push, comment, transition (full support).
 *
 * Uses the `atlassian-remote` MCP server for all Jira API interactions.
 * Inject `exec` for testing with mocked MCP output.
 */
export function createJiraBackend(options: JiraBackendOptions): Backend {
  const { serverUrl, projectKey, statusMap } = options;
  const exec = options.exec ?? defaultExecJira;

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
      const output = exec(["jira_get_issue", ref]);
      const data: JiraIssueJson = JSON.parse(output);

      const status = mapJiraStatusToStatus(data.fields.status.name, statusMap);
      const comments = data.fields.comment.comments.map(
        (c) => `**${c.author.displayName}** (${c.created}):\n${c.body}`
      );

      return {
        title: data.fields.summary,
        ref: data.key,
        source: "jira",
        status,
        priority: data.fields.priority?.name ?? null,
        assignee: data.fields.assignee?.displayName ?? null,
        tags: data.fields.labels,
        created: data.fields.created,
        updated: data.fields.updated,
        closed: data.fields.resolutiondate ?? (status === "done" ? data.fields.updated : null),
        pushed: null,
        due: data.fields.duedate ?? null,
        jira_ref: `${serverUrl}/browse/${data.key}`,
        asana_ref: null,
        gh_ref: null,
        comment_count: data.fields.comment.comments.length,
        description: data.fields.description ?? "",
        comments,
      };
    },

    async pull(taskPage: TaskPage): Promise<PullResult> {
      if (!taskPage.jira_ref && !taskPage.ref) {
        throw new Error(
          "Cannot pull: task page has no Jira reference (jira_ref or ref)"
        );
      }

      const issueKey = issueKeyFromTaskPage(taskPage);
      const output = exec(["jira_get_issue", issueKey]);
      const data: JiraIssueJson = JSON.parse(output);

      const changes: string[] = [];
      const newStatus = mapJiraStatusToStatus(data.fields.status.name, statusMap);

      if (newStatus !== taskPage.status) {
        changes.push(`status: ${taskPage.status} -> ${newStatus}`);
      }

      const newCommentCount = data.fields.comment.comments.length;
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

      const payload = JSON.stringify({
        fields: {
          project: { key: projectKey },
          summary: taskPage.title,
          description: taskPage.description,
          issuetype: { name: "Task" },
          labels: taskPage.tags,
        },
      });

      const output = exec(["jira_create_issue", payload]);
      const result = JSON.parse(output);

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
      exec(["jira_add_comment", issueKey, text]);

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

      // Fetch available transitions
      const output = exec(["jira_get_issue", issueKey]);
      const data: JiraIssueJson = JSON.parse(output);
      const transitions = data.transitions ?? [];

      const transition = transitions.find(
        (t) => t.name.toLowerCase() === targetTransitionName.toLowerCase()
      );

      if (!transition) {
        const available = transitions.map((t) => t.name).join(", ");
        throw new Error(
          `Transition "${targetTransitionName}" is not available for ${issueKey}. Available: ${available}`
        );
      }

      exec(["jira_transition_issue", issueKey, transition.id]);

      return {
        success: true,
        previousStatus: taskPage.status,
        newStatus: status,
      };
    },
  };
}

function defaultExecJira(_args: string[]): string {
  throw new Error(
    "Jira backend requires the atlassian-remote MCP server. Ensure it is configured."
  );
}

/**
 * Check Jira connectivity via MCP server.
 * Returns without throwing -- caller inspects the result.
 */
export function checkJiraConnectivity(
  serverUrl: string,
  exec?: (args: string[]) => string
): ConnectivityResult {
  const run = exec ?? defaultExecJira;
  try {
    const output = run(["jira_get_server_info"]);
    const data = JSON.parse(output);
    return { authenticated: true, user: data.user };
  } catch {
    return {
      authenticated: false,
      error: `Cannot connect to Jira at ${serverUrl}. Ensure the atlassian-remote MCP server is configured and running.`,
    };
  }
}
