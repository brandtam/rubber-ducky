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
  jira_needed: "yes" | "no" | null;
  asana_status_raw: string | null;
  jira_status_raw: string | null;
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
 * Validated credentials for a backend, discriminated by `type`. Returned by
 * `requireCredentials` so callers get typed, non-optional values instead of
 * scattering `process.env.X!` assertions across the codebase.
 */
export type BackendCredentials =
  | { type: "asana"; accessToken: string }
  | { type: "jira"; email: string; apiToken: string }
  | { type: "github" };

/**
 * Read and validate the credentials required to operate a backend. Throws a
 * setup-pointer error on the first missing var so every CLI command
 * surfaces the same message for the same root cause — a user who sees
 * "ASANA_ACCESS_TOKEN is not set" from `ingest` sees the identical message
 * from `merge`, `push`, and any future adapter.
 *
 * Commands that route the failure through their own output formatter (e.g.
 * `--json` mode) should catch the thrown error and pass its `.message` to
 * the formatter. Commands that execute write actions through
 * `runWriteActions` let this throw from the `resolveBackend` hook, which
 * the executor records as a per-action failure — preserving partial-
 * failure semantics when only one backend's credentials are missing.
 *
 * Overloaded so callers that pass a config literal get the narrowed
 * credentials type at the call site (no `as` casts, no runtime re-check).
 */
export function requireCredentials<T extends BackendConfig["type"]>(
  config: Omit<BackendConfig, "type"> & { type: T }
): Extract<BackendCredentials, { type: T }>;
export function requireCredentials(config: BackendConfig): BackendCredentials {
  switch (config.type) {
    case "asana": {
      const accessToken = process.env.ASANA_ACCESS_TOKEN;
      if (!accessToken) {
        throw new Error(
          "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for setup instructions."
        );
      }
      return { type: "asana", accessToken };
    }
    case "jira": {
      const email = process.env.JIRA_EMAIL;
      if (!email) {
        throw new Error(
          "JIRA_EMAIL is not set. Export your Jira account email as JIRA_EMAIL. See references/backend-setup.md for instructions."
        );
      }
      const apiToken = process.env.JIRA_API_TOKEN;
      if (!apiToken) {
        throw new Error(
          "JIRA_API_TOKEN is not set. Export your Jira API token as JIRA_API_TOKEN. See references/backend-setup.md for instructions."
        );
      }
      return { type: "jira", email, apiToken };
    }
    case "github":
      // GitHub delegates to the `gh` CLI, which owns its own auth state.
      // `rubber-ducky backend check github` is the right place to validate.
      return { type: "github" };
    default:
      throw new Error(`Backend "${config.type}" is not yet implemented`);
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
      const serverUrl = config.server_url ?? process.env.JIRA_SERVER_URL ?? "";
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
        serverUrl: config.server_url ?? process.env.JIRA_SERVER_URL,
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
