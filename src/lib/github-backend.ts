import { execFileSync } from "node:child_process";
import type {
  Backend,
  TaskPage,
  PullResult,
  PushResult,
  CommentResult,
  FindCommentResult,
  TransitionResult,
  Status,
  ConnectivityResult,
} from "./backend.js";

/**
 * Map a GitHub issue/PR state (OPEN, CLOSED, MERGED) to the controlled vocabulary status.
 * Labels are checked first for more specific statuses (e.g., "in-progress", "blocked").
 */
export function mapGitHubStateToStatus(
  state: string,
  labels?: string[]
): Status {
  if (labels) {
    for (const label of labels) {
      const normalized = label.toLowerCase();
      if (normalized === "in-progress") return "in-progress";
      if (normalized === "in-review") return "in-review";
      if (normalized === "blocked") return "blocked";
      if (normalized === "pending") return "pending";
      if (normalized === "backlog") return "backlog";
      if (normalized === "deferred") return "deferred";
    }
  }

  switch (state.toUpperCase()) {
    case "OPEN":
      return "to-do";
    case "CLOSED":
    case "MERGED":
      return "done";
    default:
      return "backlog";
  }
}

/**
 * Map a controlled vocabulary status to a GitHub issue state (open/closed).
 * GitHub only supports two states — all non-done statuses map to "open".
 */
export function mapStatusToGitHubState(status: Status): "open" | "closed" {
  return status === "done" ? "closed" : "open";
}

interface GhIssueJson {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  labels: { name: string }[];
  comments: { body: string; author: { login: string }; createdAt: string }[];
}

function defaultExecGh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8" });
}

/**
 * Create a GitHub backend instance.
 * Supports: ingest, push, comment.
 *
 * Uses the `gh` CLI for all GitHub API interactions.
 * Inject `exec` for testing with mocked CLI output.
 */
export function createGitHubBackend(options?: {
  exec?: (args: string[]) => string;
}): Backend {
  const gh = options?.exec ?? defaultExecGh;

  return {
    name: "github",
    capabilities: ["ingest", "push", "comment"],

    async ingest(ref: string): Promise<TaskPage> {
      const jsonFields = "number,title,body,state,url,labels,comments";

      let data: GhIssueJson;
      try {
        const output = gh(["issue", "view", ref, "--json", jsonFields]);
        data = JSON.parse(output);
      } catch {
        // Issue not found — try as a pull request
        const output = gh(["pr", "view", ref, "--json", jsonFields]);
        data = JSON.parse(output);
      }

      const labels = data.labels.map((l) => l.name);
      const status = mapGitHubStateToStatus(data.state, labels);
      const now = new Date().toISOString();

      return {
        title: data.title,
        ref: `#${data.number}`,
        source: "github",
        status,
        priority: null,
        assignee: null,
        tags: labels,
        created: now,
        updated: now,
        closed: status === "done" ? now : null,
        pushed: null,
        due: null,
        jira_ref: null,
        asana_ref: null,
        gh_ref: data.url,
        jira_needed: null,
        asana_status_raw: null,
        jira_status_raw: null,
        comment_count: data.comments.length,
        description: data.body ?? "",
        comments: data.comments.map(
          (c) => `**${c.author.login}** (${c.createdAt}):\n${c.body}`
        ),
      };
    },

    async pull(_taskPage: TaskPage): Promise<PullResult> {
      throw new Error('Backend "github" does not support "pull"');
    },

    async push(taskPage: TaskPage): Promise<PushResult> {
      const args = [
        "issue",
        "create",
        "--title",
        taskPage.title,
        "--body",
        taskPage.description,
      ];
      for (const tag of taskPage.tags) {
        args.push("--label", tag);
      }

      const output = gh(args);
      const url = output.trim();
      const match = url.match(/\/(\d+)$/);
      const ref = match ? `#${match[1]}` : url;

      return { success: true, ref, url };
    },

    async comment(taskPage: TaskPage, text: string): Promise<CommentResult> {
      if (!taskPage.gh_ref && !taskPage.ref) {
        throw new Error(
          "Cannot comment: task page has no GitHub reference (gh_ref or ref)"
        );
      }

      const target = taskPage.gh_ref ?? taskPage.ref!;
      const output = gh(["issue", "comment", target, "--body", text]);

      return {
        success: true,
        commentUrl: output.trim() || target,
      };
    },

    async findCommentByMarker(
      taskPage: TaskPage,
      marker: string,
    ): Promise<FindCommentResult> {
      const target = taskPage.gh_ref ?? taskPage.ref;
      if (!target) return { found: false };

      try {
        const output = gh([
          "issue",
          "view",
          target,
          "--json",
          "comments",
          "--jq",
          ".comments[].body",
        ]);
        const found = output.includes(marker);
        return { found, commentUrl: found ? target : undefined };
      } catch {
        return { found: false };
      }
    },

    async transition(
      _taskPage: TaskPage,
      _status: Status
    ): Promise<TransitionResult> {
      throw new Error('Backend "github" does not support "transition"');
    },
  };
}

/**
 * Check GitHub CLI authentication status.
 * Returns without throwing — caller inspects the result.
 */
export function checkGitHubConnectivity(
  exec?: (args: string[]) => string
): ConnectivityResult {
  const gh = exec ?? defaultExecGh;
  try {
    const output = gh(["auth", "status"]);
    const match = output.match(/account\s+(\S+)/i);
    return { authenticated: true, user: match?.[1] };
  } catch {
    return {
      authenticated: false,
      error:
        "GitHub CLI is not authenticated. Run `gh auth login` to authenticate. See references/backend-setup.md for setup instructions.",
    };
  }
}
