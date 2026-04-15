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

function writeAsanaPage(tmpDir: string, filename: string): void {
  fs.writeFileSync(
    path.join(tmpDir, "wiki", "tasks", filename),
    [
      "---",
      'title: "Implement dark mode"',
      "type: task",
      'ref: "https://app.asana.com/0/proj/3585"',
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
      'asana_ref: "https://app.asana.com/0/proj/3585"',
      "gh_ref: null",
      "jira_needed: null",
      "asana_status_raw: null",
      "jira_status_raw: null",
      "comment_count: 0",
      "---",
      "## Asana description",
      "",
      "Dark mode feature",
      "",
      "## Asana comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n")
  );
}

function writeJiraPage(tmpDir: string, filename: string): void {
  fs.writeFileSync(
    path.join(tmpDir, "wiki", "tasks", filename),
    [
      "---",
      'title: "Dark mode bug"',
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
      "asana_status_raw: null",
      "jira_status_raw: null",
      "comment_count: 0",
      "---",
      "## Jira description",
      "",
      "Fix dark mode rendering",
      "",
      "## Jira comments",
      "",
      "## Activity log",
      "",
      "## See also",
      "",
    ].join("\n")
  );
}

describe("rubber-ducky merge CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-merge-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("outputs JSON merge result with --json flag", () => {
    createWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md");
    writeJiraPage(tmpDir, "WEB-297.md");

    const output = runCli(
      ["--json", "merge", "ECOMM-3585", "WEB-297"],
      tmpDir
    );
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.mergedFilename).toBe("ECOMM-3585 (WEB-297).md");
    expect(parsed.writeActions).toHaveLength(2);

    // Verify file was created
    expect(
      fs.existsSync(
        path.join(tmpDir, "wiki", "tasks", "ECOMM-3585 (WEB-297).md")
      )
    ).toBe(true);
    // Orphan deleted
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))
    ).toBe(false);
  });

  it("fails with conflict report when statuses differ", () => {
    createWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md");
    // Override Jira page status
    const jiraPath = path.join(tmpDir, "wiki", "tasks", "WEB-297.md");
    writeJiraPage(tmpDir, "WEB-297.md");
    let content = fs.readFileSync(jiraPath, "utf-8");
    content = content.replace("status: backlog", "status: done");
    fs.writeFileSync(jiraPath, content);

    const output = runCliExpectFail(
      ["--json", "merge", "ECOMM-3585", "WEB-297"],
      tmpDir
    );
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.conflicts).toBeDefined();
    expect(parsed.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it("resolves conflict with --status flag", () => {
    createWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md");
    const jiraPath = path.join(tmpDir, "wiki", "tasks", "WEB-297.md");
    writeJiraPage(tmpDir, "WEB-297.md");
    let content = fs.readFileSync(jiraPath, "utf-8");
    content = content.replace("status: backlog", "status: done");
    fs.writeFileSync(jiraPath, content);

    const output = runCli(
      ["--json", "merge", "ECOMM-3585", "WEB-297", "--status", "done"],
      tmpDir
    );
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.mergedFilename).toBe("ECOMM-3585 (WEB-297).md");
  });

  it("fails gracefully outside a workspace", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-workspace-"));
    try {
      const output = runCliExpectFail(
        ["--json", "merge", "ECOMM-3585", "WEB-297"],
        emptyDir
      );
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/not inside a rubber-ducky workspace/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("fails when Asana page does not exist", () => {
    createWorkspace(tmpDir);
    writeJiraPage(tmpDir, "WEB-297.md");

    const output = runCliExpectFail(
      ["--json", "merge", "ECOMM-9999", "WEB-297"],
      tmpDir
    );
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("ECOMM-9999");
  });
});
