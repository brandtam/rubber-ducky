/**
 * Backend interface contract for Rubber-Ducky work management integrations.
 *
 * Every backend implements this interface to provide a uniform API for
 * ingesting from, pushing to, and interacting with external work management
 * systems (GitHub, Jira, Asana, etc.).
 *
 * ## Implementing a new backend
 *
 * 1. Create a factory function that returns a `Backend` object
 * 2. Declare supported operations in `capabilities`
 * 3. Implement supported methods; unsupported methods should throw
 *    a clear error (e.g., `Backend "x" does not support "y"`)
 * 4. Add status mapping between controlled vocabulary and your system's states
 * 5. Export a connectivity check function for `backend check`
 * 6. Register in `getBackend()` and `checkConnectivity()`
 *
 * See `github-backend.ts` for a reference implementation.
 */

import type { BackendConfig } from "./templates.js";
import {
  createGitHubBackend,
  checkGitHubConnectivity,
} from "./github-backend.js";
import {
  createJiraBackend,
  checkJiraConnectivityRest,
} from "./jira-backend.js";
import { createJiraClient } from "./jira-client.js";
import {
  createAsanaBackend,
  checkAsanaConnectivityRest,
} from "./asana-backend.js";
import { createAsanaClient } from "./asana-client.js";

export type Capability = "ingest" | "pull" | "push" | "comment" | "transition";

export type Status =
  | "backlog"
  | "to-do"
  | "in-progress"
  | "in-review"
  | "pending"
  | "blocked"
  | "done"
  | "deferred";

export const VALID_STATUSES: Status[] = [
  "backlog",
  "to-do",
  "in-progress",
  "in-review",
  "pending",
  "blocked",
  "done",
  "deferred",
];

/** Structured representation of a task page's data. */
export interface TaskPage {
  title: string;
  ref: string | null;
  source: string | null;
  status: Status;
  priority: string | null;
  assignee: string | null;
  tags: string[];
  created: string;
  updated: string;
  closed: string | null;
  pushed: string | null;
  due: string | null;
  jira_ref: string | null;
  asana_ref: string | null;
  gh_ref: string | null;
  comment_count: number;
  description: string;
  comments: string[];
}

export interface PullResult {
  updated: boolean;
  changes: string[];
}

export interface PushResult {
  success: boolean;
  ref: string;
  url: string;
}

export interface CommentResult {
  success: boolean;
  commentUrl: string;
}

export interface TransitionResult {
  success: boolean;
  previousStatus: Status;
  newStatus: Status;
}

export interface ConnectivityResult {
  authenticated: boolean;
  user?: string;
  error?: string;
}

/**
 * The uniform backend interface that all work management integrations implement.
 *
 * Backends declare which operations they support via `capabilities`.
 * Core skills check capabilities before calling methods.
 * Unsupported operations should throw a clear error.
 */
export interface Backend {
  /** Backend identifier (e.g., "github", "jira", "asana") */
  name: string;

  /** Operations this backend supports */
  capabilities: Capability[];

  /** Ingest an external item (issue, ticket, task) into a TaskPage */
  ingest(ref: string): Promise<TaskPage>;

  /** Pull latest state from the external system for an existing task */
  pull(taskPage: TaskPage): Promise<PullResult>;

  /** Push a local task page to the external system as a new item */
  push(taskPage: TaskPage): Promise<PushResult>;

  /** Add a comment to the external item referenced by the task page */
  comment(taskPage: TaskPage, text: string): Promise<CommentResult>;

  /** Transition the external item's status */
  transition(taskPage: TaskPage, status: Status): Promise<TransitionResult>;
}

/**
 * Assert that a backend supports a given capability.
 * Throws a clear error if the capability is not supported.
 */
export function assertCapability(
  backend: Backend,
  capability: Capability
): void {
  if (!backend.capabilities.includes(capability)) {
    throw new Error(
      `Backend "${backend.name}" does not support "${capability}"`
    );
  }
}

/**
 * Create a backend instance from a workspace backend configuration.
 * Throws for backend types that are not yet implemented.
 */
export function getBackend(
  config: BackendConfig,
  options?: {
    exec?: (args: string[]) => string;
    token?: string;
    email?: string;
    apiToken?: string;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  }
): Backend {
  switch (config.type) {
    case "github":
      return createGitHubBackend(options);
    case "jira": {
      const email = options?.email ?? process.env.JIRA_EMAIL ?? "";
      const apiToken = options?.apiToken ?? process.env.JIRA_API_TOKEN ?? "";
      const serverUrl = config.server_url ?? "";
      const client = createJiraClient({
        serverUrl,
        email,
        apiToken,
        fetch: options?.fetch,
      });
      return createJiraBackend({
        client,
        serverUrl,
        projectKey: config.project_key,
      });
    }
    case "asana": {
      const token = options?.token ?? process.env.ASANA_ACCESS_TOKEN ?? "";
      const client = createAsanaClient({ token, fetch: options?.fetch });
      return createAsanaBackend({
        client,
        workspaceId: config.workspace_id,
      });
    }
    default:
      throw new Error(`Backend "${config.type}" is not yet implemented`);
  }
}

/**
 * Check connectivity for a configured backend.
 * Returns authentication status without throwing.
 *
 * Asana and Jira use REST APIs by default.
 * Falls back to MCP if a `mcp` option is explicitly provided and no token is set.
 */
export async function checkConnectivity(
  config: BackendConfig,
  options?: {
    exec?: (args: string[]) => string;
    token?: string;
    email?: string;
    apiToken?: string;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  }
): Promise<ConnectivityResult> {
  switch (config.type) {
    case "github":
      return checkGitHubConnectivity(options?.exec);
    case "jira":
      return checkJiraConnectivityRest({
        serverUrl: config.server_url,
        email: options?.email,
        apiToken: options?.apiToken,
        fetch: options?.fetch,
      });
    case "asana":
      return checkAsanaConnectivityRest({
        token: options?.token,
        fetch: options?.fetch,
      });
    default:
      return {
        authenticated: false,
        error: `Backend "${config.type}" is not yet implemented`,
      };
  }
}
