import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  formatWritePreview,
  logWriteAction,
  runWriteActions,
  type WriteAction,
} from "../lib/writeback.js";
import type {
  Backend,
  CommentResult,
  TaskPage,
} from "../lib/backend.js";

describe("formatWritePreview", () => {
  it("includes the action type in the preview", () => {
    const preview = formatWritePreview({
      action: "push",
      backend: "github",
      target: "#42",
      payload: { title: "New issue", description: "Body text" },
    });

    expect(preview).toContain("push");
  });

  it("includes the backend name in the preview", () => {
    const preview = formatWritePreview({
      action: "comment",
      backend: "jira",
      target: "PROJ-123",
      payload: { text: "A comment" },
    });

    expect(preview).toContain("jira");
  });

  it("includes the target reference in the preview", () => {
    const preview = formatWritePreview({
      action: "transition",
      backend: "asana",
      target: "1234567890",
      payload: { status: "done" },
    });

    expect(preview).toContain("1234567890");
  });

  it("includes payload details in the preview", () => {
    const preview = formatWritePreview({
      action: "push",
      backend: "github",
      target: "(new)",
      payload: { title: "Fix login bug", description: "The form crashes" },
    });

    expect(preview).toContain("Fix login bug");
  });

  it("formats as a structured multi-line preview", () => {
    const preview = formatWritePreview({
      action: "comment",
      backend: "github",
      target: "#42",
      payload: { text: "Great work on this!" },
    });

    // Should be multi-line structured output
    const lines = preview.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("handles all valid action types", () => {
    const actions: WriteAction["action"][] = ["push", "comment", "transition"];

    for (const action of actions) {
      const preview = formatWritePreview({
        action,
        backend: "github",
        target: "#1",
        payload: { text: "test" },
      });
      expect(preview).toContain(action);
    }
  });
});

describe("logWriteAction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-writeback-test-"));
    fs.mkdirSync(path.join(tmpDir, "wiki"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends an entry to wiki/log.md", () => {
    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "#55",
      payload: { title: "New issue" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("push");
    expect(content).toContain("github");
    expect(content).toContain("#55");
  });

  it("includes the action type in the log entry", () => {
    logWriteAction(tmpDir, {
      action: "comment",
      backend: "jira",
      target: "PROJ-123",
      payload: { text: "Hello" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("comment");
  });

  it("includes the backend name in the log entry", () => {
    logWriteAction(tmpDir, {
      action: "transition",
      backend: "asana",
      target: "12345",
      payload: { status: "done" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("asana");
  });

  it("includes a timestamp in the log entry", () => {
    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "(new)",
      payload: { title: "Test" },
    });

    const logPath = path.join(tmpDir, "wiki", "log.md");
    const content = fs.readFileSync(logPath, "utf-8");
    // ISO timestamp pattern
    expect(content).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("creates log.md if it does not exist", () => {
    const logPath = path.join(tmpDir, "wiki", "log.md");
    expect(fs.existsSync(logPath)).toBe(false);

    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "#1",
      payload: { title: "Test" },
    });

    expect(fs.existsSync(logPath)).toBe(true);
  });

  it("appends to existing log.md without overwriting", () => {
    const logPath = path.join(tmpDir, "wiki", "log.md");
    fs.writeFileSync(logPath, "# Log\n\n- existing entry\n", "utf-8");

    logWriteAction(tmpDir, {
      action: "push",
      backend: "github",
      target: "#1",
      payload: { title: "Test" },
    });

    const content = fs.readFileSync(logPath, "utf-8");
    expect(content).toContain("existing entry");
    expect(content).toContain("push");
  });

  it("returns the log entry string", () => {
    const result = logWriteAction(tmpDir, {
      action: "comment",
      backend: "jira",
      target: "PROJ-1",
      payload: { text: "Note" },
    });

    expect(result.entry).toBeDefined();
    expect(result.entry).toContain("comment");
    expect(result.entry).toContain("jira");
    expect(result.entry).toContain("PROJ-1");
  });

  it("includes the result URL in the audit entry when one is provided", () => {
    const result = logWriteAction(
      tmpDir,
      {
        action: "comment",
        backend: "asana",
        target: "ECOMM-3585",
        payload: { text: "Linked to WEB-297" },
      },
      "https://app.asana.com/0/proj/3585/1001"
    );

    expect(result.entry).toContain("https://app.asana.com/0/proj/3585/1001");
    const logContent = fs.readFileSync(
      path.join(tmpDir, "wiki", "log.md"),
      "utf-8"
    );
    expect(logContent).toContain("https://app.asana.com/0/proj/3585/1001");
  });
});

describe("runWriteActions", () => {
  function buildTaskPage(): TaskPage {
    return {
      title: "Dark mode",
      ref: "ECOMM-3585",
      source: "asana",
      status: "backlog",
      priority: null,
      assignee: null,
      tags: [],
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      closed: null,
      pushed: null,
      due: null,
      jira_ref: "https://jira.example.com/browse/WEB-297",
      asana_ref: "https://app.asana.com/0/proj/3585",
      gh_ref: null,
      jira_needed: null,
      asana_status_raw: null,
      jira_status_raw: null,
      comment_count: 0,
      description: "",
      comments: [],
    };
  }

  function stubBackend(
    name: string,
    comment: (taskPage: TaskPage, text: string) => Promise<CommentResult>
  ): Backend {
    return {
      name,
      capabilities: ["comment"],
      ingest: async () => {
        throw new Error("not used");
      },
      pull: async () => {
        throw new Error("not used");
      },
      push: async () => {
        throw new Error("not used");
      },
      comment,
      transition: async () => {
        throw new Error("not used");
      },
    };
  }

  const asanaAction: WriteAction = {
    action: "comment",
    backend: "asana",
    target: "ECOMM-3585",
    payload: { text: "Linked to WEB-297 in work log" },
  };
  const jiraAction: WriteAction = {
    action: "comment",
    backend: "jira",
    target: "WEB-297",
    payload: { text: "Linked to ECOMM-3585 in work log" },
  };

  it("calls backend.comment() with the merged TaskPage and payload text", async () => {
    const calls: { backend: string; text: string; taskRef: string | null }[] = [];
    const asana = stubBackend("asana", async (taskPage, text) => {
      calls.push({ backend: "asana", text, taskRef: taskPage.ref });
      return { success: true, commentUrl: "https://asana.example/story/1" };
    });
    const jira = stubBackend("jira", async (taskPage, text) => {
      calls.push({ backend: "jira", text, taskRef: taskPage.ref });
      return { success: true, commentUrl: "https://jira.example/comment/2" };
    });
    const backends: Record<string, Backend> = { asana, jira };

    const outcomes = await runWriteActions({
      actions: [asanaAction, jiraAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => backends[name],
    });

    expect(calls).toEqual([
      {
        backend: "asana",
        text: "Linked to WEB-297 in work log",
        taskRef: "ECOMM-3585",
      },
      {
        backend: "jira",
        text: "Linked to ECOMM-3585 in work log",
        taskRef: "ECOMM-3585",
      },
    ]);
    expect(outcomes.every((o) => o.status === "success")).toBe(true);
    expect(outcomes[0].commentUrl).toBe("https://asana.example/story/1");
    expect(outcomes[1].commentUrl).toBe("https://jira.example/comment/2");
  });

  it("reports partial failure (Asana OK, Jira failing) as one success + one failure, logged only for the success", async () => {
    const asana = stubBackend("asana", async () => ({
      success: true,
      commentUrl: "https://asana.example/story/1",
    }));
    const jira = stubBackend("jira", async () => {
      throw new Error("jira returned 500");
    });
    const backends: Record<string, Backend> = { asana, jira };
    const logged: string[] = [];

    const outcomes = await runWriteActions({
      actions: [asanaAction, jiraAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => backends[name],
      onSuccess: (action) => logged.push(action.backend),
    });

    expect(outcomes.map((o) => ({ backend: o.action.backend, status: o.status }))).toEqual([
      { backend: "asana", status: "success" },
      { backend: "jira", status: "failure" },
    ]);
    expect(outcomes[1].error).toContain("jira returned 500");
    expect(logged).toEqual(["asana"]);
    // Command layer derives exit code from this aggregation; any "failure"
    // outcome must cause a non-zero exit:
    expect(outcomes.some((o) => o.status === "failure")).toBe(true);
  });

  it("continues attempting remaining actions after one backend fails", async () => {
    const asana = stubBackend("asana", async () => {
      throw new Error("asana is down");
    });
    let jiraCalled = false;
    const jira = stubBackend("jira", async () => {
      jiraCalled = true;
      return { success: true, commentUrl: "https://jira.example/comment/2" };
    });
    const backends: Record<string, Backend> = { asana, jira };

    const outcomes = await runWriteActions({
      actions: [asanaAction, jiraAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => backends[name],
    });

    expect(jiraCalled).toBe(true);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({
      status: "failure",
      error: "asana is down",
    });
    expect(outcomes[0].action.backend).toBe("asana");
    expect(outcomes[1]).toMatchObject({ status: "success" });
    expect(outcomes[1].action.backend).toBe("jira");
  });

  it("keeps status=success when onSuccess throws, attaching the hook error as onSuccessError", async () => {
    const asana = stubBackend("asana", async () => ({
      success: true,
      commentUrl: "https://asana.example/story/1",
    }));
    const jira = stubBackend("jira", async () => ({
      success: true,
      commentUrl: "https://jira.example/comment/2",
    }));
    const backends: Record<string, Backend> = { asana, jira };

    const outcomes = await runWriteActions({
      actions: [asanaAction, jiraAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => backends[name],
      onSuccess: (action) => {
        if (action.backend === "asana") {
          throw new Error("ENOSPC: disk full writing wiki/log.md");
        }
      },
    });

    // Remote post succeeded — the classification MUST remain success, or the
    // user's natural retry creates a duplicate comment on the remote.
    expect(outcomes[0].status).toBe("success");
    expect(outcomes[0].commentUrl).toBe("https://asana.example/story/1");
    expect(outcomes[0].onSuccessError).toBe(
      "ENOSPC: disk full writing wiki/log.md"
    );
    // The second action's hook did not throw — no onSuccessError recorded.
    expect(outcomes[1].status).toBe("success");
    expect(outcomes[1].onSuccessError).toBeUndefined();
  });

  it("does not invoke onSuccess when the remote post fails", async () => {
    let hookCalls = 0;
    const asana = stubBackend("asana", async () => {
      throw new Error("asana 500");
    });
    const backends: Record<string, Backend> = { asana };

    const outcomes = await runWriteActions({
      actions: [asanaAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => backends[name],
      onSuccess: () => {
        hookCalls += 1;
      },
    });

    expect(outcomes[0].status).toBe("failure");
    expect(outcomes[0].onSuccessError).toBeUndefined();
    expect(hookCalls).toBe(0);
  });

  it("invokes onSuccess only for actions that succeeded", async () => {
    const asana = stubBackend("asana", async () => {
      throw new Error("asana is down");
    });
    const jira = stubBackend("jira", async () => ({
      success: true,
      commentUrl: "https://jira.example/comment/2",
    }));
    const backends: Record<string, Backend> = { asana, jira };
    const logged: string[] = [];

    await runWriteActions({
      actions: [asanaAction, jiraAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => backends[name],
      onSuccess: (action) => logged.push(action.backend),
    });

    expect(logged).toEqual(["jira"]);
  });

  it("surfaces a missing-credential error as a per-backend failure while still attempting the other", async () => {
    const jira = stubBackend("jira", async () => ({
      success: true,
      commentUrl: "https://jira.example/comment/2",
    }));
    const backends: Record<string, Backend> = { jira };

    const outcomes = await runWriteActions({
      actions: [asanaAction, jiraAction],
      taskPage: buildTaskPage(),
      resolveBackend: (name) => {
        if (name === "asana") {
          throw new Error(
            "ASANA_ACCESS_TOKEN is not set. Export your Asana Personal Access Token as ASANA_ACCESS_TOKEN. See references/backend-setup.md for setup instructions."
          );
        }
        return backends[name];
      },
    });

    expect(outcomes[0].status).toBe("failure");
    expect(outcomes[0].error).toMatch(/ASANA_ACCESS_TOKEN/);
    expect(outcomes[1].status).toBe("success");
  });

  it("records a failure outcome when the backend resolver throws", async () => {
    const outcomes = await runWriteActions({
      actions: [asanaAction],
      taskPage: buildTaskPage(),
      resolveBackend: () => {
        throw new Error('No "asana" backend configured in workspace.md');
      },
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("failure");
    expect(outcomes[0].error).toContain("asana");
  });

  it("rejects actions with missing or non-string payload.text", async () => {
    const backend = stubBackend("asana", async () => {
      throw new Error("should not be called");
    });
    const outcomes = await runWriteActions({
      actions: [
        {
          action: "comment",
          backend: "asana",
          target: "ECOMM-3585",
          payload: {},
        },
      ],
      taskPage: buildTaskPage(),
      resolveBackend: () => backend,
    });

    expect(outcomes[0].status).toBe("failure");
    expect(outcomes[0].error).toMatch(/payload\.text/);
  });

  it("rejects non-comment actions until they have their own adapter", async () => {
    const backend = stubBackend("github", async () => ({
      success: true,
      commentUrl: "",
    }));
    const outcomes = await runWriteActions({
      actions: [
        {
          action: "push",
          backend: "github",
          target: "(new)",
          payload: { title: "Test" },
        },
      ],
      taskPage: buildTaskPage(),
      resolveBackend: () => backend,
    });

    expect(outcomes[0].status).toBe("failure");
    expect(outcomes[0].error).toMatch(/not supported/);
  });
});
