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
  total: number;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface JiraClientOptions {
  serverUrl: string;
  email: string;
  apiToken: string;
  fetch?: FetchFn;
}

export interface JiraClient {
  getMyself(): Promise<JiraUser>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  getComments(issueKey: string): Promise<JiraComment[]>;
  searchIssues(jql: string, options?: { maxResults?: number }): Promise<JiraSearchResult>;
}

export function createJiraClient(options: JiraClientOptions): JiraClient {
  const { email, apiToken } = options;
  const serverUrl = options.serverUrl.replace(/\/+$/, "");

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

  const fetchFn: FetchFn = options.fetch ?? globalThis.fetch;

  const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${credentials}`,
    Accept: "application/json",
  };

  async function request<T>(path: string): Promise<T> {
    const url = `${serverUrl}${path}`;
    const response = await fetchFn(url, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira API ${response.status}: ${body}`);
    }

    return (await response.json()) as T;
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
      const params = new URLSearchParams({ jql });
      if (searchOptions?.maxResults !== undefined) {
        params.set("maxResults", String(searchOptions.maxResults));
      }
      return request<JiraSearchResult>(`/rest/api/3/search?${params.toString()}`);
    },
  };
}
