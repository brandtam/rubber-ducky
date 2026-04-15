import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI_PATH = path.resolve(__dirname, "..", "cli.ts");
const TSX_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "node_modules",
  ".bin",
  "tsx"
);

function runCli(args: string[], cwd?: string): string {
  return execFileSync(TSX_PATH, [CLI_PATH, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function runCliExpectFail(args: string[], cwd?: string): string {
  try {
    execFileSync(TSX_PATH, [CLI_PATH, ...args], {
      encoding: "utf-8",
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    throw new Error("Expected CLI to fail but it succeeded");
  } catch (error: unknown) {
    if (error instanceof Error && "stdout" in error) {
      return (error as { stdout: string }).stdout;
    }
    throw error;
  }
}

function createWorkspace(tmpDir: string): void {
  const dirs = ["wiki/daily", "wiki/tasks", "wiki/projects", "raw"];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
  }

  fs.writeFileSync(
    path.join(tmpDir, "workspace.md"),
    [
      "---",
      "name: test-workspace",
      "purpose: testing",
      'version: "0.5.0"',
      'created: "2026-01-01"',
      "backends:",
      "  - type: asana",
      '    workspace_id: "123"',
      '    identifier_field: "ECOMM ID"',
      "  - type: jira",
      '    server_url: "https://jira.example.com"',
      '    project_key: "WEB"',
      "---",
      "",
      "# Test Workspace",
      "",
    ].join("\n"),
    "utf-8"
  );
}

describe("rubber-ducky triage-candidates CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "rubber-ducky-triage-cand-cli-")
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("outputs JSON with candidates when Jira keys found in body", () => {
    createWorkspace(tmpDir);

    // Write an Asana page that mentions WEB-297
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-100.md"),
      [
        "---",
        'title: "Test task"',
        "type: task",
        'ref: "https://app.asana.com/0/proj/100"',
        "source: asana",
        "status: backlog",
        "priority: null",
        "assignee: null",
        "tags: []",
        'created: "2026-01-01T00:00:00.000Z"',
        'updated: "2026-01-01T00:00:00.000Z"',
        "closed: null",
        "pushed: null",
        "due: null",
        "jira_ref: null",
        'asana_ref: "https://app.asana.com/0/proj/100"',
        "gh_ref: null",
        "jira_needed: null",
        "comment_count: 0",
        "---",
        "## Asana description",
        "",
        "Related to WEB-297.",
        "",
        "## Asana comments",
        "",
        "## Activity log",
        "",
        "## See also",
        "",
      ].join("\n")
    );

    // Write a Jira page so WEB-297 is in the vault
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "WEB-297.md"),
      [
        "---",
        'title: "Jira task"',
        "type: task",
        'ref: "WEB-297"',
        "source: jira",
        "status: backlog",
        "priority: null",
        "assignee: null",
        "tags: []",
        'created: "2026-01-02T00:00:00.000Z"',
        'updated: "2026-01-02T00:00:00.000Z"',
        "closed: null",
        "pushed: null",
        "due: null",
        'jira_ref: "https://jira.example.com/browse/WEB-297"',
        "asana_ref: null",
        "gh_ref: null",
        "jira_needed: null",
        "comment_count: 0",
        "---",
        "## Jira description",
        "",
        "## Jira comments",
        "",
        "## Activity log",
        "",
        "## See also",
        "",
      ].join("\n")
    );

    const output = runCli(
      ["--json", "triage-candidates", "wiki/tasks/ECOMM-100.md"],
      tmpDir
    );
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].jiraKey).toBe("WEB-297");
    expect(parsed.candidates[0].location).toBe("description");
  });

  it("returns empty candidates when no Jira keys in body", () => {
    createWorkspace(tmpDir);

    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-200.md"),
      [
        "---",
        'title: "No jira mentions"',
        "type: task",
        'ref: "https://app.asana.com/0/proj/200"',
        "source: asana",
        "status: backlog",
        "priority: null",
        "assignee: null",
        "tags: []",
        'created: "2026-01-01T00:00:00.000Z"',
        'updated: "2026-01-01T00:00:00.000Z"',
        "closed: null",
        "pushed: null",
        "due: null",
        "jira_ref: null",
        'asana_ref: "https://app.asana.com/0/proj/200"',
        "gh_ref: null",
        "jira_needed: null",
        "comment_count: 0",
        "---",
        "## Asana description",
        "",
        "No Jira mentions here.",
        "",
        "## Asana comments",
        "",
        "## Activity log",
        "",
        "## See also",
        "",
      ].join("\n")
    );

    const output = runCli(
      ["--json", "triage-candidates", "wiki/tasks/ECOMM-200.md"],
      tmpDir
    );
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.candidates).toHaveLength(0);
  });

  it("fails gracefully outside a workspace", () => {
    const emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "not-a-workspace-triage-")
    );
    try {
      const output = runCliExpectFail(
        ["--json", "triage-candidates", "wiki/tasks/ECOMM-100.md"],
        emptyDir
      );
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/not inside a rubber-ducky workspace/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
