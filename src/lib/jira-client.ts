/**
 * Thin REST API client for Jira Cloud using Node's built-in fetch().
 *
 * Auth: Basic Auth via JIRA_EMAIL + JIRA_API_TOKEN env vars.
 * All HTTP I/O is injectable via the `fetch` option for testing.
 */

export interface JiraIssue {
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
    attachment: { id: string; filename: string; content: string; mimeType: string }[];
  };
}

export interface JiraComment {
  id: string;
  body: string;
  author: { displayName: string };
  created: string;
}

export interface JiraUser {
  displayName: string;
  emailAddress: string;
  accountId?: string;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface JiraClientOptions {
  serverUrl: string;
  email: string;
  apiToken: string;
  fetch?: FetchFn;
}

export interface JiraTransition {
  id: string;
  name: string;
}

export interface JiraProject {
  key: string;
  name: string;
  id: string;
}

export interface JiraClient {
  getMyself(): Promise<JiraUser>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  getComments(issueKey: string): Promise<JiraComment[]>;
  searchIssues(jql: string, options?: { maxResults?: number }): Promise<JiraSearchResult>;
  createIssue(fields: Record<string, unknown>): Promise<{ key: string; id: string; self: string }>;
  addComment(issueKey: string, body: string): Promise<{ id: string }>;
  getTransitions(issueKey: string): Promise<JiraTransition[]>;
  transitionIssue(issueKey: string, transitionId: string): Promise<void>;
  getProjects(): Promise<JiraProject[]>;
}

export function createJiraClient(options: JiraClientOptions): JiraClient {
  const { email, apiToken } = options;
  const serverUrl = options.serverUrl.replace(/\/+$/, "");
  const fetchFn: FetchFn = options.fetch ?? globalThis.fetch;

  /**
   * Cached auth headers — computed once on first request, reused thereafter.
   * Validation is deferred to first use so backend list/capabilities work
   * without credentials set.
   */
  let cachedHeaders: Record<string, string> | null = null;

  function getAuthHeaders(): Record<string, string> {
    if (cachedHeaders) return cachedHeaders;

    if (!serverUrl) {
      throw new Error(
        "Jira server_url is not configured. Set server_url in your backend config. See references/backend-setup.md for instructions."
      );
    }
    if (!email) {
      throw new Error(
        "JIRA_EMAIL is not set. Export your Jira account email as JIRA_EMAIL. See references/backend-setup.md for instructions."
      );
    }
    if (!apiToken) {
      throw new Error(
        "JIRA_API_TOKEN is not set. Export your Jira API token as JIRA_API_TOKEN. See references/backend-setup.md for instructions."
      );
    }

    const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");
    cachedHeaders = {
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    };
    return cachedHeaders;
  }

  async function request<T>(apiPath: string): Promise<T> {
    const headers = getAuthHeaders();
    const url = `${serverUrl}${apiPath}`;
    const response = await fetchFn(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
  }

  async function post<T>(apiPath: string, body: unknown): Promise<T> {
    const headers = getAuthHeaders();
    const url = `${serverUrl}${apiPath}`;
    const response = await fetchFn(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  async function postNoContent(apiPath: string, body: unknown): Promise<void> {
    const headers = getAuthHeaders();
    const url = `${serverUrl}${apiPath}`;
    const response = await fetchFn(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API ${response.status}: ${text}`);
    }
  }

  return {
    async getMyself(): Promise<JiraUser> {
      return request<JiraUser>("/rest/api/3/myself");
    },

    async getIssue(issueKey: string): Promise<JiraIssue> {
      return request<JiraIssue>(`/rest/api/3/issue/${issueKey}`);
    },

    async getComments(issueKey: string): Promise<JiraComment[]> {
      const result = await request<{ comments: JiraComment[] }>(
        `/rest/api/3/issue/${issueKey}/comment`
      );
      return result.comments;
    },

    async searchIssues(
      jql: string,
      searchOptions?: { maxResults?: number }
    ): Promise<JiraSearchResult> {
      const pageSize = searchOptions?.maxResults ?? 50;
      const allIssues: JiraIssue[] = [];
      let nextPageToken: string | undefined;

      // POST /rest/api/3/search/jql — Atlassian deprecated the old
      // /rest/api/3/search endpoint (HTTP 410). Cursor-based pagination via
      // `nextPageToken`; termination is signalled by `isLast` (preferred)
      // or absence of `nextPageToken`. The new endpoint intentionally does
      // not return a total.
      while (true) {
        const body: Record<string, unknown> = {
          jql,
          maxResults: pageSize,
          fields: ["*all"],
        };
        if (nextPageToken) body.nextPageToken = nextPageToken;

        const page = await post<{
          issues: JiraIssue[];
          nextPageToken?: string;
          isLast?: boolean;
        }>("/rest/api/3/search/jql", body);

        allIssues.push(...(page.issues ?? []));

        if (page.isLast || !page.nextPageToken) {
          return { issues: allIssues };
        }
        nextPageToken = page.nextPageToken;
      }
    },

    async createIssue(
      fields: Record<string, unknown>
    ): Promise<{ key: string; id: string; self: string }> {
      return post("/rest/api/3/issue", { fields });
    },

    async addComment(issueKey: string, body: string): Promise<{ id: string }> {
      return post(`/rest/api/3/issue/${issueKey}/comment`, { body });
    },

    async getTransitions(issueKey: string): Promise<JiraTransition[]> {
      const result = await request<{ transitions: JiraTransition[] }>(
        `/rest/api/3/issue/${issueKey}/transitions`
      );
      return result.transitions;
    },

    async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
      await postNoContent(`/rest/api/3/issue/${issueKey}/transitions`, {
        transition: { id: transitionId },
      });
    },

    async getProjects(): Promise<JiraProject[]> {
      return request<JiraProject[]>("/rest/api/3/project");
    },
  };
}
