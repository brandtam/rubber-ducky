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
      'name: test-workspace',
      'purpose: testing',
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

describe("rubber-ducky migrate CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-migrate-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("outputs JSON with --json flag when vault is already migrated", () => {
    createWorkspace(tmpDir);

    const output = runCli(["--json", "migrate"], tmpDir);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.alreadyMigrated).toBe(true);
    expect(parsed.filesRenamed).toBe(0);
  });

  it("renames files and reports results in JSON mode", () => {
    createWorkspace(tmpDir);

    // Write old-format task
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "ecomm-42.md"),
      [
        "---",
        'title: "ECOMM-42"',
        "type: task",
        "source: asana",
        "status: backlog",
        'asana_ref: "https://app.asana.com/0/123/42"',
        "---",
        "## Description",
        "",
        "Test task",
        "",
        "## Comments",
        "",
      ].join("\n")
    );

    const output = runCli(["--json", "migrate"], tmpDir);
    const parsed = JSON.parse(output);

    expect(parsed.success).toBe(true);
    expect(parsed.filesRenamed).toBe(1);
    expect(parsed.headersRewritten).toBe(1);
    expect(parsed.renames).toEqual([
      { from: "ecomm-42.md", to: "ECOMM-42.md" },
    ]);

    // Verify file was actually renamed
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-42.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ecomm-42.md"))).toBe(false);
  });

  it("fails gracefully outside a workspace", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-workspace-"));
    try {
      const output = runCliExpectFail(["--json", "migrate"], emptyDir);
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toMatch(/not inside a rubber-ducky workspace/i);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
