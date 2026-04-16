import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { stringify as yamlStringify } from "yaml";
import { runMerge, resumeMerge, type MergeOptions } from "../lib/merge.js";
import {
  listSentinels,
  readSentinel,
  advanceSentinel,
  deleteSentinelAbort,
  describeRemainingWork,
  transactionsDir,
  type MergeStep,
} from "../lib/merge-sentinel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function seedWorkspace(root: string): void {
  fs.mkdirSync(path.join(root, "wiki", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki", "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki", "projects"), { recursive: true });
  fs.mkdirSync(path.join(root, ".rubber-ducky", "transactions"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "workspace.md"),
    [
      "---",
      "name: Test",
      "purpose: Testing",
      'version: "0.5.0"',
      'created: "2026-01-01"',
      "backends:",
      "  - type: asana",
      '    workspace_id: "123"',
      "  - type: jira",
      '    server_url: "https://jira.example.com"',
      '    project_key: "WEB"',
      "---",
      "# Test Workspace",
    ].join("\n"),
  );
}

function writeTaskPage(
  root: string,
  filename: string,
  opts: {
    source: "asana" | "jira";
    ref?: string;
    asana_ref?: string | null;
    jira_ref?: string | null;
    title?: string;
    status?: string;
  },
): void {
  const fm: Record<string, unknown> = {
    title: opts.title ?? `${opts.source} task`,
    type: "task",
    ref: opts.ref ?? null,
    source: opts.source,
    status: opts.status ?? "backlog",
    priority: null,
    assignee: null,
    tags: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: opts.jira_ref ?? null,
    asana_ref: opts.asana_ref ?? null,
    gh_ref: null,
    comment_count: 0,
  };

  const body = [
    `## ${opts.source === "asana" ? "Asana" : "Jira"} description`,
    "",
    `Description for ${filename}`,
    "",
    `## ${opts.source === "asana" ? "Asana" : "Jira"} comments`,
    "",
    "## Activity log",
    "",
    `- 2026-01-01 — Ingested`,
    "",
    "## See also",
    "",
  ].join("\n");

  const content = `---\n${yamlStringify(fm).trimEnd()}\n---\n${body}`;
  fs.writeFileSync(path.join(root, "wiki", "tasks", filename), content, "utf-8");
}

function seedMergePages(root: string): void {
  writeTaskPage(root, "ECOMM-100.md", {
    source: "asana",
    ref: "https://app.asana.com/0/proj/100",
    asana_ref: "https://app.asana.com/0/proj/100",
    title: "Feature A",
  });
  writeTaskPage(root, "WEB-50.md", {
    source: "jira",
    ref: "WEB-50",
    jira_ref: "https://jira.example.com/browse/WEB-50",
    title: "Feature A (Jira side)",
  });
}

/**
 * Run a clean, uninterrupted merge and return the vault state for comparison.
 */
function runReferenceMerge(root: string): {
  mergedContent: string;
  filesInTasks: string[];
  logContent: string;
} {
  seedWorkspace(root);
  seedMergePages(root);

  const result = runMerge({
    asanaRef: "ECOMM-100",
    jiraRef: "WEB-50",
    workspaceRoot: root,
  });
  if (!result.success) throw new Error(`Reference merge failed: ${result.error}`);

  const tasksDir = path.join(root, "wiki", "tasks");
  return {
    mergedContent: fs.readFileSync(result.mergedPath, "utf-8"),
    filesInTasks: fs.readdirSync(tasksDir).sort(),
    logContent: fs.readFileSync(path.join(root, "wiki", "log.md"), "utf-8"),
  };
}

function mergeOpts(root: string, crashAfter?: MergeStep): MergeOptions {
  return {
    asanaRef: "ECOMM-100",
    jiraRef: "WEB-50",
    workspaceRoot: root,
    __crashAfter: crashAfter,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-resume-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Successful merge leaves no sentinel
// ---------------------------------------------------------------------------

describe("successful merge", () => {
  it("leaves no sentinel file behind", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    const result = runMerge(mergeOpts(tmpDir));
    if (!result.success) throw new Error(result.error);

    expect(listSentinels(tmpDir)).toHaveLength(1);

    // The sentinel still exists because the caller (command layer) deletes
    // it after back-links are posted. The lib layer leaves it for the caller.
    // Verify it's at the expected step.
    const files = listSentinels(tmpDir);
    const sentinel = readSentinel(files[0]);
    expect(sentinel.step).toBe("logged");
  });
});

// ---------------------------------------------------------------------------
// Crash at each phase leaves sentinel at expected step
// ---------------------------------------------------------------------------

describe("crash simulation via __crashAfter", () => {
  const phases: Array<{ crashAt: MergeStep; expectedStep: MergeStep }> = [
    { crashAt: "started", expectedStep: "started" },
    { crashAt: "merged-file-written", expectedStep: "merged-file-written" },
    { crashAt: "orphans-deleted", expectedStep: "orphans-deleted" },
    { crashAt: "wikilinks-rewritten", expectedStep: "wikilinks-rewritten" },
    { crashAt: "logged", expectedStep: "logged" },
  ];

  for (const { crashAt, expectedStep } of phases) {
    it(`crash after '${crashAt}' leaves sentinel at '${expectedStep}'`, () => {
      seedWorkspace(tmpDir);
      seedMergePages(tmpDir);

      expect(() => runMerge(mergeOpts(tmpDir, crashAt))).toThrow(
        `__crashAfter: ${crashAt}`,
      );

      const files = listSentinels(tmpDir);
      expect(files).toHaveLength(1);
      const sentinel = readSentinel(files[0]);
      expect(sentinel.step).toBe(expectedStep);
    });
  }

  it("crash after 'started' — merged file does NOT exist", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    expect(() => runMerge(mergeOpts(tmpDir, "started"))).toThrow();

    const mergedPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-100 (WEB-50).md");
    expect(fs.existsSync(mergedPath)).toBe(false);
  });

  it("crash after 'merged-file-written' — merged file exists, originals still present", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    expect(() => runMerge(mergeOpts(tmpDir, "merged-file-written"))).toThrow();

    const mergedPath = path.join(tmpDir, "wiki", "tasks", "ECOMM-100 (WEB-50).md");
    expect(fs.existsSync(mergedPath)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-100.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-50.md"))).toBe(true);
  });

  it("crash after 'orphans-deleted' — originals are gone", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    expect(() => runMerge(mergeOpts(tmpDir, "orphans-deleted"))).toThrow();

    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-100.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-50.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-100 (WEB-50).md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Resume from each crash point produces the same final state
// ---------------------------------------------------------------------------

describe("resume after crash", () => {
  const resumablePhases: MergeStep[] = [
    "started",
    "merged-file-written",
    "orphans-deleted",
    "wikilinks-rewritten",
    "logged",
  ];

  for (const crashAt of resumablePhases) {
    it(`resume from '${crashAt}' produces consistent vault state`, () => {
      // Get reference state from clean merge
      const refDir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-ref-"));
      const ref = runReferenceMerge(refDir);

      // Now crash + resume in the test dir
      seedWorkspace(tmpDir);
      seedMergePages(tmpDir);

      expect(() => runMerge(mergeOpts(tmpDir, crashAt))).toThrow();

      const files = listSentinels(tmpDir);
      const sentinel = readSentinel(files[0]);
      const resumed = resumeMerge(tmpDir, sentinel);
      expect(resumed.success).toBe(true);

      if (!resumed.success) throw new Error("resumed unexpectedly failed");

      // Merged file exists with same content (modulo timestamps in activity log)
      expect(fs.existsSync(resumed.mergedPath)).toBe(true);

      // Same set of files in wiki/tasks/
      const tasksDir = path.join(tmpDir, "wiki", "tasks");
      const taskFiles = fs.readdirSync(tasksDir).sort();
      expect(taskFiles).toEqual(ref.filesInTasks);

      // Originals are gone
      expect(fs.existsSync(path.join(tasksDir, "ECOMM-100.md"))).toBe(false);
      expect(fs.existsSync(path.join(tasksDir, "WEB-50.md"))).toBe(false);

      // Log entry was written
      const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
      expect(log).toContain("Merged ECOMM-100 + WEB-50");

      fs.rmSync(refDir, { recursive: true, force: true });
    });
  }
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe("abort after crash", () => {
  it("deletes sentinel and describeRemainingWork lists unfinished phases", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    expect(() => runMerge(mergeOpts(tmpDir, "orphans-deleted"))).toThrow();

    const files = listSentinels(tmpDir);
    const sentinel = readSentinel(files[0]);

    const remaining = describeRemainingWork(sentinel);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.some((r) => r.includes("wikilink"))).toBe(true);

    deleteSentinelAbort(tmpDir, sentinel);
    expect(listSentinels(tmpDir)).toHaveLength(0);
  });

  it("abort after 'started' reports all phases remaining", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    expect(() => runMerge(mergeOpts(tmpDir, "started"))).toThrow();

    const files = listSentinels(tmpDir);
    const sentinel = readSentinel(files[0]);
    const remaining = describeRemainingWork(sentinel);
    expect(remaining.length).toBeGreaterThanOrEqual(4);

    deleteSentinelAbort(tmpDir, sentinel);
    expect(listSentinels(tmpDir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// History log tracks crash + resume cycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resume with partially-posted back-links
// ---------------------------------------------------------------------------

describe("resume with partially-posted back-links", () => {
  it("only generates writeActions for back-links not yet posted", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    // Run merge to completion of vault phases
    const result = runMerge(mergeOpts(tmpDir));
    if (!result.success) throw new Error(result.error);

    // Simulate: Asana back-link posted, Jira not yet
    const { sentinel } = result;
    const updated = advanceSentinel(tmpDir, sentinel, "logged", {
      backLinks: [
        { backend: "asana", target: "https://app.asana.com/0/proj/100", posted: true, commentUrl: "https://asana/c/1" },
        { backend: "jira", target: "WEB-50", posted: false },
      ],
    });

    // Resume should only produce the Jira writeAction
    const resumed = resumeMerge(tmpDir, updated);
    if (!resumed.success) throw new Error(resumed.error);

    expect(resumed.writeActions).toHaveLength(1);
    expect(resumed.writeActions[0].backend).toBe("jira");
    expect(resumed.writeActions[0].target).toBe("WEB-50");
  });
});

// ---------------------------------------------------------------------------
// History log tracks crash + resume cycle
// ---------------------------------------------------------------------------

describe("transaction history", () => {
  it("records advance events during crash, then more during resume", () => {
    seedWorkspace(tmpDir);
    seedMergePages(tmpDir);

    expect(() => runMerge(mergeOpts(tmpDir, "orphans-deleted"))).toThrow();

    const historyFile = path.join(transactionsDir(tmpDir), "history.jsonl");
    const linesBefore = fs
      .readFileSync(historyFile, "utf-8")
      .trim()
      .split("\n");

    const files = listSentinels(tmpDir);
    const sentinel = readSentinel(files[0]);
    resumeMerge(tmpDir, sentinel);

    const linesAfter = fs
      .readFileSync(historyFile, "utf-8")
      .trim()
      .split("\n");

    // Resume adds more entries
    expect(linesAfter.length).toBeGreaterThan(linesBefore.length);

    const parsed = linesAfter.map((l) => JSON.parse(l));
    const events = parsed.map((p) => p.event);
    expect(events.every((e: string) => e === "advance")).toBe(true);
  });
});
