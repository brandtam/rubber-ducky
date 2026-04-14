import { describe, it, expect } from "vitest";
import Bottleneck from "bottleneck";
import {
  createJiraClient,
  type JiraClientOptions,
  type JiraClient,
} from "../lib/jira-client.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function mockFetch(
  handler: (url: string, init?: RequestInit) => { status: number; body: unknown }
): FetchFn {
  return async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body,
      text: async () => JSON.stringify(result.body),
    } as Response;
  };
}

describe("JiraClient", () => {
  const baseOpts = {
    serverUrl: "https://myorg.atlassian.net",
    email: "alice@myorg.com",
    apiToken: "jira-api-token-123",
  };

  describe("auth", () => {
    it("throws when JIRA_EMAIL is not set on first request", async () => {
      const client = createJiraClient({ ...baseOpts, email: "" });
      await expect(client.getMyself()).rejects.toThrow("JIRA_EMAIL");
    });

    it("throws when JIRA_API_TOKEN is not set on first request", async () => {
      const client = createJiraClient({ ...baseOpts, apiToken: "" });
      await expect(client.getMyself()).rejects.toThrow("JIRA_API_TOKEN");
    });

    it("throws when serverUrl is not set on first request", async () => {
      const client = createJiraClient({ ...baseOpts, serverUrl: "" });
      await expect(client.getMyself()).rejects.toThrow("server_url");
    });

    it("sends Basic Auth header with base64-encoded email:token", async () => {
      let capturedHeaders: HeadersInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedHeaders = init?.headers;
        return { status: 200, body: { displayName: "Alice", emailAddress: "alice@myorg.com" } };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      await client.getMyself();

      expect(capturedHeaders).toBeDefined();
      const expected = Buffer.from("alice@myorg.com:jira-api-token-123").toString("base64");
      expect((capturedHeaders as Record<string, string>)["Authorization"]).toBe(
        `Basic ${expected}`
      );
    });
  });

  describe("getMyself", () => {
    it("returns authenticated user info", async () => {
      const fetch = mockFetch((url) => {
        if (url.includes("/myself")) {
          return {
            status: 200,
            body: {
              displayName: "Alice Smith",
              emailAddress: "alice@myorg.com",
              accountId: "abc123",
            },
          };
        }
        return { status: 404, body: {} };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const result = await client.getMyself();

      expect(result.displayName).toBe("Alice Smith");
      expect(result.emailAddress).toBe("alice@myorg.com");
    });

    it("throws on 401 unauthorized", async () => {
      const fetch = mockFetch(() => ({
        status: 401,
        body: { message: "Unauthorized" },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      await expect(client.getMyself()).rejects.toThrow("401");
    });
  });

  describe("getIssue", () => {
    it("fetches an issue by key with correct fields", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            key: "ECOMM-4643",
            fields: {
              summary: "Fix checkout flow",
              description: "The checkout crashes on submit",
              status: { name: "In Progress" },
              priority: { name: "High" },
              assignee: { displayName: "Alice Smith" },
              labels: ["bug", "checkout"],
              created: "2024-01-15T10:00:00.000+0000",
              updated: "2024-01-16T12:00:00.000+0000",
              resolutiondate: null,
              duedate: "2024-02-01",
              attachment: [],
            },
          },
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const issue = await client.getIssue("ECOMM-4643");

      expect(issue.key).toBe("ECOMM-4643");
      expect(issue.fields.summary).toBe("Fix checkout flow");
      expect(issue.fields.description).toBe("The checkout crashes on submit");
      expect(issue.fields.assignee?.displayName).toBe("Alice Smith");
      expect(capturedUrl).toContain("/rest/api/3/issue/ECOMM-4643");
    });

    it("throws on 404 not found", async () => {
      const fetch = mockFetch(() => ({
        status: 404,
        body: { errorMessages: ["Issue does not exist"] },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      await expect(client.getIssue("NONEXISTENT-1")).rejects.toThrow("404");
    });
  });

  describe("getComments", () => {
    it("fetches comments for an issue key", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            comments: [
              {
                id: "10001",
                body: "I can reproduce this",
                author: { displayName: "Bob Jones" },
                created: "2024-01-15T11:00:00.000+0000",
              },
              {
                id: "10002",
                body: "Fixed in latest build",
                author: { displayName: "Alice Smith" },
                created: "2024-01-16T09:00:00.000+0000",
              },
            ],
          },
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const comments = await client.getComments("ECOMM-4643");

      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe("I can reproduce this");
      expect(comments[0].author.displayName).toBe("Bob Jones");
      expect(capturedUrl).toContain("/rest/api/3/issue/ECOMM-4643/comment");
    });

    it("returns empty array when issue has no comments", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { comments: [] },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      const comments = await client.getComments("ECOMM-1");
      expect(comments).toEqual([]);
    });
  });

  describe("searchIssues", () => {
    it("searches issues using the new /search/jql POST endpoint", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          status: 200,
          body: {
            isLast: true,
            issues: [
              {
                key: "ECOMM-1",
                fields: {
                  summary: "First issue",
                  description: null,
                  status: { name: "To Do" },
                  priority: null,
                  assignee: null,
                  labels: [],
                  created: "2024-01-01T00:00:00.000+0000",
                  updated: "2024-01-01T00:00:00.000+0000",
                  resolutiondate: null,
                  duedate: null,
                  attachment: [],
                },
              },
            ],
          },
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const result = await client.searchIssues("project = ECOMM");

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].key).toBe("ECOMM-1");
      // New endpoint has no `total`; the client's return shape drops it too.
      expect("total" in result).toBe(false);
      expect(capturedUrl).toContain("/rest/api/3/search/jql");
      expect(capturedInit?.method).toBe("POST");

      const body = JSON.parse((capturedInit?.body as string) ?? "{}");
      expect(body.jql).toBe("project = ECOMM");
      expect(body.fields).toContain("*all");
    });

    it("passes maxResults parameter in the POST body", async () => {
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((_url, init) => {
        capturedInit = init;
        return { status: 200, body: { isLast: true, issues: [] } };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      await client.searchIssues("project = ECOMM", { maxResults: 50 });

      const body = JSON.parse((capturedInit?.body as string) ?? "{}");
      expect(body.maxResults).toBe(50);
    });

    it("paginates via nextPageToken until isLast", async () => {
      const pages = [
        {
          isLast: false,
          nextPageToken: "tok-1",
          issues: [{ key: "A-1", fields: { summary: "one" } }],
        },
        {
          isLast: true,
          issues: [{ key: "A-2", fields: { summary: "two" } }],
        },
      ];
      let call = 0;
      const capturedBodies: Array<Record<string, unknown>> = [];
      const fetch = mockFetch((_url, init) => {
        capturedBodies.push(JSON.parse((init?.body as string) ?? "{}"));
        const page = pages[call++];
        return { status: 200, body: page };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const result = await client.searchIssues("project = A");

      expect(result.issues.map((i) => i.key)).toEqual(["A-1", "A-2"]);
      expect(capturedBodies[0].nextPageToken).toBeUndefined();
      expect(capturedBodies[1].nextPageToken).toBe("tok-1");
    });
  });

  describe("createIssue", () => {
    it("creates an issue with correct endpoint and payload", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          status: 201,
          body: { key: "PROJ-99", id: "12345", self: "https://myorg.atlassian.net/rest/api/3/issue/12345" },
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const result = await client.createIssue({
        project: { key: "PROJ" },
        summary: "New task",
        description: "Build this",
        issuetype: { name: "Task" },
        labels: ["bug"],
      });

      expect(result.key).toBe("PROJ-99");
      expect(result.id).toBe("12345");
      expect(capturedUrl).toContain("/rest/api/3/issue");
      expect(capturedInit?.method).toBe("POST");
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.fields.summary).toBe("New task");
      expect(body.fields.labels).toEqual(["bug"]);
    });

    it("throws on 400 bad request", async () => {
      const fetch = mockFetch(() => ({
        status: 400,
        body: { errorMessages: ["Project is required"] },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      await expect(
        client.createIssue({ summary: "No project" })
      ).rejects.toThrow("400");
    });
  });

  describe("addComment", () => {
    it("adds a comment to an issue with correct endpoint and body", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return {
          status: 201,
          body: { id: "10001", body: "Great work!", author: { displayName: "Alice" }, created: "2024-01-15T10:00:00.000+0000" },
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const result = await client.addComment("PROJ-42", "Great work!");

      expect(result.id).toBe("10001");
      expect(capturedUrl).toContain("/rest/api/3/issue/PROJ-42/comment");
      expect(capturedInit?.method).toBe("POST");
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.body).toBe("Great work!");
    });

    it("throws on 404 when issue not found", async () => {
      const fetch = mockFetch(() => ({
        status: 404,
        body: { errorMessages: ["Issue does not exist"] },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      await expect(client.addComment("NOPE-1", "comment")).rejects.toThrow("404");
    });
  });

  describe("getTransitions", () => {
    it("fetches available transitions for an issue", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            transitions: [
              { id: "21", name: "In Progress" },
              { id: "31", name: "Done" },
            ],
          },
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const transitions = await client.getTransitions("PROJ-42");

      expect(transitions).toHaveLength(2);
      expect(transitions[0]).toEqual({ id: "21", name: "In Progress" });
      expect(transitions[1]).toEqual({ id: "31", name: "Done" });
      expect(capturedUrl).toContain("/rest/api/3/issue/PROJ-42/transitions");
    });

    it("returns empty array when no transitions available", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: { transitions: [] },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      const transitions = await client.getTransitions("PROJ-1");
      expect(transitions).toEqual([]);
    });
  });

  describe("transitionIssue", () => {
    it("sends transition request with correct endpoint and body", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;
      const fetch = mockFetch((url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return { status: 204, body: null };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      await client.transitionIssue("PROJ-42", "21");

      expect(capturedUrl).toContain("/rest/api/3/issue/PROJ-42/transitions");
      expect(capturedInit?.method).toBe("POST");
      const body = JSON.parse(capturedInit?.body as string);
      expect(body.transition.id).toBe("21");
    });

    it("throws on 400 when transition is invalid", async () => {
      const fetch = mockFetch(() => ({
        status: 400,
        body: { errorMessages: ["Invalid transition"] },
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      await expect(client.transitionIssue("PROJ-42", "999")).rejects.toThrow("400");
    });
  });

  describe("getMyself URL construction", () => {
    it("constructs correct base URL without trailing slash", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return { status: 200, body: { displayName: "Alice", emailAddress: "alice@myorg.com" } };
      });

      const client = createJiraClient({
        ...baseOpts,
        serverUrl: "https://myorg.atlassian.net/",
        fetch,
      });
      await client.getMyself();

      expect(capturedUrl).toBe("https://myorg.atlassian.net/rest/api/3/myself");
    });
  });

  describe("getProjects", () => {
    it("fetches all projects from the Jira instance", async () => {
      let capturedUrl = "";
      const fetch = mockFetch((url) => {
        capturedUrl = url;
        return {
          status: 200,
          body: [
            { key: "ECOMM", name: "E-Commerce", id: "10001" },
            { key: "WEB", name: "Website", id: "10002" },
            { key: "MOB", name: "Mobile App", id: "10003" },
          ],
        };
      });

      const client = createJiraClient({ ...baseOpts, fetch });
      const projects = await client.getProjects();

      expect(projects).toHaveLength(3);
      expect(projects[0].key).toBe("ECOMM");
      expect(projects[0].name).toBe("E-Commerce");
      expect(projects[1].key).toBe("WEB");
      expect(capturedUrl).toContain("/rest/api/3/project");
    });

    it("returns empty array when no projects exist", async () => {
      const fetch = mockFetch(() => ({
        status: 200,
        body: [],
      }));

      const client = createJiraClient({ ...baseOpts, fetch });
      const projects = await client.getProjects();
      expect(projects).toEqual([]);
    });
  });

  describe("rate-limited client integration", () => {
    function testLimiter(): Bottleneck {
      return new Bottleneck({ minTime: 0, maxConcurrent: null });
    }

    function mockFetchWithHeaders(
      handler: (url: string, init?: RequestInit) => {
        status: number;
        body: unknown;
        headers?: Record<string, string>;
      }
    ): FetchFn {
      return async (url: string, init?: RequestInit) => {
        const result = handler(url, init);
        return {
          ok: result.status >= 200 && result.status < 300,
          status: result.status,
          headers: new Headers(result.headers ?? {}),
          json: async () => result.body,
          text: async () => JSON.stringify(result.body),
        } as Response;
      };
    }

    it("routes GET requests through the rate-limited client when limiter is provided", async () => {
      let called = false;
      const fetch = mockFetchWithHeaders((url) => {
        called = true;
        return {
          status: 200,
          body: { displayName: "Alice", emailAddress: "alice@myorg.com" },
        };
      });

      const client = createJiraClient({
        ...baseOpts,
        fetch,
        limiter: testLimiter(),
      });
      const result = await client.getMyself();

      expect(called).toBe(true);
      expect(result.displayName).toBe("Alice");
    });

    it("routes POST requests through the rate-limited client when limiter is provided", async () => {
      const fetch = mockFetchWithHeaders(() => ({
        status: 200,
        body: { isLast: true, issues: [{ key: "X-1", fields: { summary: "test" } }] },
      }));

      const client = createJiraClient({
        ...baseOpts,
        fetch,
        limiter: testLimiter(),
      });
      const result = await client.searchIssues("project = X");
      expect(result.issues).toHaveLength(1);
    });

    it("updates limiter reservoir from X-RateLimit-Remaining headers", async () => {
      const limiter = testLimiter();
      // Set an initial reservoir so we can observe the change
      limiter.updateSettings({ reservoir: 60 });

      const fetch = mockFetchWithHeaders(() => ({
        status: 200,
        body: { displayName: "Alice", emailAddress: "alice@myorg.com" },
        headers: { "x-ratelimit-remaining": "25" },
      }));

      const client = createJiraClient({
        ...baseOpts,
        fetch,
        limiter,
      });
      await client.getMyself();

      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(25);
    });

    it("retries on 429 with Retry-After when limiter is provided", async () => {
      let callCount = 0;
      const fetch = mockFetchWithHeaders(() => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 429,
            body: { message: "rate limited" },
            headers: { "retry-after": "0" },
          };
        }
        return {
          status: 200,
          body: { displayName: "Alice", emailAddress: "alice@myorg.com" },
        };
      });

      const client = createJiraClient({
        ...baseOpts,
        fetch,
        limiter: testLimiter(),
        sleep: async () => {},
      });
      const result = await client.getMyself();

      expect(callCount).toBe(2);
      expect(result.displayName).toBe("Alice");
    });

    it("no rate-limit headers does not change reservoir (self-hosted path)", async () => {
      const limiter = testLimiter();
      limiter.updateSettings({ reservoir: 60 });

      const fetch = mockFetchWithHeaders(() => ({
        status: 200,
        body: { displayName: "Alice", emailAddress: "alice@myorg.com" },
        // No X-RateLimit-* headers
      }));

      const client = createJiraClient({
        ...baseOpts,
        fetch,
        limiter,
      });
      await client.getMyself();

      // Reservoir decrements by 1 (Bottleneck consumed a token for the request)
      // but the hints adapter did not modify it — self-hosted path works.
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(59);
    });

    it("regression: normal ingest search completes with limiter + hints adapter", async () => {
      const limiter = testLimiter();
      limiter.updateSettings({ reservoir: 60 });
      let callCount = 0;

      const fetch = mockFetchWithHeaders((url) => {
        callCount++;
        if (url.includes("/search/jql")) {
          return {
            status: 200,
            body: {
              isLast: true,
              issues: [
                { key: "PROJ-1", fields: { summary: "First" } },
                { key: "PROJ-2", fields: { summary: "Second" } },
              ],
            },
            headers: { "x-ratelimit-remaining": "55" },
          };
        }
        if (url.includes("/issue/PROJ-1/comment")) {
          return {
            status: 200,
            body: { comments: [{ id: "1", body: "hello", author: { displayName: "Bob" }, created: "2024-01-01" }] },
            headers: { "x-ratelimit-remaining": "54" },
          };
        }
        if (url.includes("/issue/PROJ-2/comment")) {
          return {
            status: 200,
            body: { comments: [] },
            headers: { "x-ratelimit-remaining": "53" },
          };
        }
        return { status: 200, body: {}, headers: { "x-ratelimit-remaining": "52" } };
      });

      const client = createJiraClient({
        ...baseOpts,
        fetch,
        limiter,
      });

      // Simulate an ingest: search + fetch comments for each issue
      const searchResult = await client.searchIssues("project = PROJ");
      expect(searchResult.issues).toHaveLength(2);

      const comments1 = await client.getComments("PROJ-1");
      expect(comments1).toHaveLength(1);

      const comments2 = await client.getComments("PROJ-2");
      expect(comments2).toHaveLength(0);

      // Reservoir should have been updated by the hints adapter
      const reservoir = await limiter.currentReservoir();
      expect(reservoir).toBe(53);
      expect(callCount).toBe(3);
    });
  });
});
