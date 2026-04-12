import { describe, it, expect } from "vitest";
import {
  assertCapability,
  getBackend,
  checkConnectivity,
  type TaskPage,
} from "../lib/backend.js";
import {
  createGitHubBackend,
  mapGitHubStateToStatus,
  mapStatusToGitHubState,
  checkGitHubConnectivity,
} from "../lib/github-backend.js";

function makeTaskPage(overrides?: Partial<TaskPage>): TaskPage {
  return {
    title: "Test task",
    ref: "#1",
    source: "github",
    status: "to-do",
    priority: null,
    assignee: null,
    tags: [],
    created: "2024-01-01T00:00:00.000Z",
    updated: "2024-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: null,
    asana_ref: null,
    gh_ref: "https://github.com/owner/repo/issues/1",
    comment_count: 0,
    description: "",
    comments: [],
    ...overrides,
  };
}

describe("Backend interface", () => {
  describe("assertCapability", () => {
    it("does not throw for a supported capability", () => {
      const backend = createGitHubBackend({ exec: () => "" });
      expect(() => assertCapability(backend, "ingest")).not.toThrow();
      expect(() => assertCapability(backend, "push")).not.toThrow();
      expect(() => assertCapability(backend, "comment")).not.toThrow();
    });

    it("throws a clear error for an unsupported capability", () => {
      const backend = createGitHubBackend({ exec: () => "" });
      expect(() => assertCapability(backend, "pull")).toThrow(
        'Backend "github" does not support "pull"'
      );
      expect(() => assertCapability(backend, "transition")).toThrow(
        'Backend "github" does not support "transition"'
      );
    });
  });

  describe("getBackend", () => {
    it("returns a github backend for github config", () => {
      const backend = getBackend({ type: "github", mcp_server: "github" });
      expect(backend.name).toBe("github");
      expect(backend.capabilities).toContain("ingest");
      expect(backend.capabilities).toContain("push");
      expect(backend.capabilities).toContain("comment");
    });

    it("returns a jira backend for jira config", () => {
      const backend = getBackend({
        type: "jira",
        mcp_server: "atlassian-remote",
        server_url: "https://myorg.atlassian.net",
      });
      expect(backend.name).toBe("jira");
      expect(backend.capabilities).toContain("ingest");
      expect(backend.capabilities).toContain("pull");
      expect(backend.capabilities).toContain("push");
      expect(backend.capabilities).toContain("comment");
      expect(backend.capabilities).toContain("transition");
    });

    it("throws for unimplemented backend type", () => {
      expect(() =>
        getBackend({ type: "asana", mcp_server: "asana" })
      ).toThrow('Backend "asana" is not yet implemented');
    });
  });

  describe("checkConnectivity", () => {
    it("delegates to GitHub for github backend config", () => {
      const exec = () => "github.com\n  ✓ Logged in to github.com account testuser\n";
      const result = checkConnectivity(
        { type: "github", mcp_server: "github" },
        { exec }
      );
      expect(result.authenticated).toBe(true);
    });

    it("delegates to Jira for jira backend config", () => {
      const exec = () => JSON.stringify({ user: "alice@myorg.com" });
      const result = checkConnectivity(
        { type: "jira", mcp_server: "atlassian-remote", server_url: "https://myorg.atlassian.net" },
        { exec }
      );
      expect(result.authenticated).toBe(true);
    });

    it("returns not-implemented for unimplemented backends", () => {
      const result = checkConnectivity({
        type: "asana",
        mcp_server: "asana",
      });
      expect(result.authenticated).toBe(false);
      expect(result.error).toMatch(/not yet implemented/);
    });
  });
});

describe("GitHub backend", () => {
  describe("status mapping", () => {
    it("maps OPEN state to to-do", () => {
      expect(mapGitHubStateToStatus("OPEN")).toBe("to-do");
    });

    it("maps CLOSED state to done", () => {
      expect(mapGitHubStateToStatus("CLOSED")).toBe("done");
    });

    it("maps MERGED state to done", () => {
      expect(mapGitHubStateToStatus("MERGED")).toBe("done");
    });

    it("prefers label-based status over state when labels match", () => {
      expect(mapGitHubStateToStatus("OPEN", ["in-progress"])).toBe(
        "in-progress"
      );
    });

    it("maps blocked label to blocked status", () => {
      expect(mapGitHubStateToStatus("OPEN", ["blocked"])).toBe("blocked");
    });

    it("maps in-review label to in-review status", () => {
      expect(mapGitHubStateToStatus("OPEN", ["in-review"])).toBe("in-review");
    });

    it("maps pending label to pending status", () => {
      expect(mapGitHubStateToStatus("OPEN", ["pending"])).toBe("pending");
    });

    it("maps backlog label to backlog status", () => {
      expect(mapGitHubStateToStatus("OPEN", ["backlog"])).toBe("backlog");
    });

    it("maps deferred label to deferred status", () => {
      expect(mapGitHubStateToStatus("OPEN", ["deferred"])).toBe("deferred");
    });

    it("maps labels case-insensitively", () => {
      expect(mapGitHubStateToStatus("OPEN", ["In-Progress"])).toBe(
        "in-progress"
      );
      expect(mapGitHubStateToStatus("OPEN", ["BLOCKED"])).toBe("blocked");
    });

    it("falls back to state when no matching label found", () => {
      expect(mapGitHubStateToStatus("OPEN", ["enhancement", "bug"])).toBe(
        "to-do"
      );
    });

    it("maps unknown state to backlog", () => {
      expect(mapGitHubStateToStatus("UNKNOWN")).toBe("backlog");
    });

    it("maps done status to closed GitHub state", () => {
      expect(mapStatusToGitHubState("done")).toBe("closed");
    });

    it("maps non-done statuses to open GitHub state", () => {
      expect(mapStatusToGitHubState("in-progress")).toBe("open");
      expect(mapStatusToGitHubState("backlog")).toBe("open");
      expect(mapStatusToGitHubState("to-do")).toBe("open");
      expect(mapStatusToGitHubState("blocked")).toBe("open");
    });
  });

  describe("ingest", () => {
    it("ingests a GitHub issue into a TaskPage", async () => {
      const mockIssue = {
        number: 42,
        title: "Fix the login bug",
        body: "The login form crashes on submit",
        state: "OPEN",
        url: "https://github.com/owner/repo/issues/42",
        labels: [{ name: "bug" }],
        comments: [
          {
            body: "I can reproduce this",
            author: { login: "alice" },
            createdAt: "2024-01-15T10:00:00Z",
          },
        ],
      };

      const exec = (args: string[]) => {
        if (args[0] === "issue" && args[1] === "view")
          return JSON.stringify(mockIssue);
        throw new Error("unexpected call");
      };

      const backend = createGitHubBackend({ exec });
      const page = await backend.ingest("42");

      expect(page.title).toBe("Fix the login bug");
      expect(page.ref).toBe("#42");
      expect(page.source).toBe("github");
      expect(page.status).toBe("to-do");
      expect(page.gh_ref).toBe("https://github.com/owner/repo/issues/42");
      expect(page.description).toBe("The login form crashes on submit");
      expect(page.tags).toEqual(["bug"]);
      expect(page.comments).toHaveLength(1);
      expect(page.comments[0]).toContain("alice");
      expect(page.comments[0]).toContain("I can reproduce this");
      expect(page.comment_count).toBe(1);
    });

    it("falls back to PR when issue view fails", async () => {
      const mockPr = {
        number: 99,
        title: "Add new feature",
        body: "This PR adds a new feature",
        state: "OPEN",
        url: "https://github.com/owner/repo/pull/99",
        labels: [],
        comments: [],
      };

      const exec = (args: string[]) => {
        if (args[0] === "issue" && args[1] === "view")
          throw new Error("not found");
        if (args[0] === "pr" && args[1] === "view")
          return JSON.stringify(mockPr);
        throw new Error("unexpected call");
      };

      const backend = createGitHubBackend({ exec });
      const page = await backend.ingest("99");

      expect(page.title).toBe("Add new feature");
      expect(page.ref).toBe("#99");
      expect(page.source).toBe("github");
      expect(page.gh_ref).toBe("https://github.com/owner/repo/pull/99");
    });

    it("maps GitHub labels to status and tags", async () => {
      const mockIssue = {
        number: 10,
        title: "Blocked task",
        body: "",
        state: "OPEN",
        url: "https://github.com/owner/repo/issues/10",
        labels: [{ name: "blocked" }, { name: "priority:high" }],
        comments: [],
      };

      const exec = () => JSON.stringify(mockIssue);

      const backend = createGitHubBackend({ exec });
      const page = await backend.ingest("10");

      expect(page.status).toBe("blocked");
      expect(page.tags).toEqual(["blocked", "priority:high"]);
    });

    it("handles null body gracefully", async () => {
      const mockIssue = {
        number: 1,
        title: "No body issue",
        body: null,
        state: "OPEN",
        url: "https://github.com/owner/repo/issues/1",
        labels: [],
        comments: [],
      };

      const exec = () => JSON.stringify(mockIssue);

      const backend = createGitHubBackend({ exec });
      const page = await backend.ingest("1");

      expect(page.description).toBe("");
    });

    it("sets closed timestamp for closed issues", async () => {
      const mockIssue = {
        number: 5,
        title: "Done task",
        body: "Finished",
        state: "CLOSED",
        url: "https://github.com/owner/repo/issues/5",
        labels: [],
        comments: [],
      };

      const exec = () => JSON.stringify(mockIssue);

      const backend = createGitHubBackend({ exec });
      const page = await backend.ingest("5");

      expect(page.status).toBe("done");
      expect(page.closed).not.toBeNull();
    });

    it("formats multiple comments correctly", async () => {
      const mockIssue = {
        number: 7,
        title: "Commented issue",
        body: "Main body",
        state: "OPEN",
        url: "https://github.com/owner/repo/issues/7",
        labels: [],
        comments: [
          {
            body: "First comment",
            author: { login: "alice" },
            createdAt: "2024-01-10T10:00:00Z",
          },
          {
            body: "Second comment",
            author: { login: "bob" },
            createdAt: "2024-01-11T11:00:00Z",
          },
        ],
      };

      const exec = () => JSON.stringify(mockIssue);

      const backend = createGitHubBackend({ exec });
      const page = await backend.ingest("7");

      expect(page.comments).toHaveLength(2);
      expect(page.comment_count).toBe(2);
      expect(page.comments[0]).toContain("alice");
      expect(page.comments[1]).toContain("bob");
    });
  });

  describe("push", () => {
    it("creates a GitHub issue from a TaskPage", async () => {
      const calls: string[][] = [];
      const exec = (args: string[]) => {
        calls.push(args);
        return "https://github.com/owner/repo/issues/55\n";
      };

      const backend = createGitHubBackend({ exec });
      const taskPage = makeTaskPage({
        title: "New feature",
        description: "Build this thing",
      });

      const result = await backend.push(taskPage);

      expect(result.success).toBe(true);
      expect(result.url).toBe("https://github.com/owner/repo/issues/55");
      expect(result.ref).toBe("#55");
      expect(calls[0]).toContain("issue");
      expect(calls[0]).toContain("create");
      expect(calls[0]).toContain("--title");
      expect(calls[0]).toContain("New feature");
      expect(calls[0]).toContain("--body");
      expect(calls[0]).toContain("Build this thing");
    });

    it("includes labels from task tags", async () => {
      const calls: string[][] = [];
      const exec = (args: string[]) => {
        calls.push(args);
        return "https://github.com/owner/repo/issues/56\n";
      };

      const backend = createGitHubBackend({ exec });
      const taskPage = makeTaskPage({
        title: "Tagged task",
        tags: ["bug", "urgent"],
      });

      await backend.push(taskPage);

      const args = calls[0];
      const labelIndices = args.reduce((acc: number[], arg, i) => {
        if (arg === "--label") acc.push(i);
        return acc;
      }, []);
      expect(labelIndices).toHaveLength(2);
      expect(args[labelIndices[0] + 1]).toBe("bug");
      expect(args[labelIndices[1] + 1]).toBe("urgent");
    });

    it("creates issue without labels when tags are empty", async () => {
      const calls: string[][] = [];
      const exec = (args: string[]) => {
        calls.push(args);
        return "https://github.com/owner/repo/issues/57\n";
      };

      const backend = createGitHubBackend({ exec });
      const taskPage = makeTaskPage({ title: "No tags", tags: [] });

      await backend.push(taskPage);

      expect(calls[0]).not.toContain("--label");
    });
  });

  describe("comment", () => {
    it("adds a comment to a GitHub issue via gh_ref", async () => {
      const calls: string[][] = [];
      const exec = (args: string[]) => {
        calls.push(args);
        return "https://github.com/owner/repo/issues/42#issuecomment-123\n";
      };

      const backend = createGitHubBackend({ exec });
      const taskPage = makeTaskPage({
        gh_ref: "https://github.com/owner/repo/issues/42",
      });

      const result = await backend.comment(taskPage, "Great work!");

      expect(result.success).toBe(true);
      expect(result.commentUrl).toContain("issuecomment");
      expect(calls[0]).toContain("issue");
      expect(calls[0]).toContain("comment");
      expect(calls[0]).toContain(
        "https://github.com/owner/repo/issues/42"
      );
      expect(calls[0]).toContain("--body");
      expect(calls[0]).toContain("Great work!");
    });

    it("uses ref when gh_ref is not set", async () => {
      const calls: string[][] = [];
      const exec = (args: string[]) => {
        calls.push(args);
        return "";
      };

      const backend = createGitHubBackend({ exec });
      const taskPage = makeTaskPage({ ref: "#42", gh_ref: null });

      await backend.comment(taskPage, "A comment");

      expect(calls[0]).toContain("#42");
    });

    it("throws when no reference is available", async () => {
      const backend = createGitHubBackend({ exec: () => "" });
      const taskPage = makeTaskPage({ ref: null, gh_ref: null });

      await expect(backend.comment(taskPage, "oops")).rejects.toThrow(
        "Cannot comment: task page has no GitHub reference"
      );
    });
  });

  describe("unsupported operations", () => {
    it("throws clear error for pull", async () => {
      const backend = createGitHubBackend({ exec: () => "" });
      await expect(backend.pull(makeTaskPage())).rejects.toThrow(
        'Backend "github" does not support "pull"'
      );
    });

    it("throws clear error for transition", async () => {
      const backend = createGitHubBackend({ exec: () => "" });
      await expect(
        backend.transition(makeTaskPage(), "done")
      ).rejects.toThrow('Backend "github" does not support "transition"');
    });
  });

  describe("checkGitHubConnectivity", () => {
    it("returns authenticated when gh auth status succeeds", () => {
      const exec = () =>
        "github.com\n  ✓ Logged in to github.com account testuser (keyring)\n";
      const result = checkGitHubConnectivity(exec);
      expect(result.authenticated).toBe(true);
      expect(result.user).toBe("testuser");
    });

    it("returns authenticated without user when output format differs", () => {
      const exec = () => "github.com\n  ✓ Logged in\n";
      const result = checkGitHubConnectivity(exec);
      expect(result.authenticated).toBe(true);
    });

    it("returns not authenticated when gh auth status fails", () => {
      const exec = () => {
        throw new Error("not logged in");
      };
      const result = checkGitHubConnectivity(exec);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
