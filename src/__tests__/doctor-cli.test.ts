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
    `---\nname: test-workspace\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\nbackends: []\n---\n\n# Test\n`,
    "utf-8"
  );

  fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Test\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"), "# UL\n", "utf-8");

  // Skill files
  fs.mkdirSync(path.join(tmpDir, ".claude", "commands"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/good-morning.md"), "# Good Morning\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/wrap-up.md"), "# Wrap Up\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/lint.md"), "# Lint\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/query.md"), "# Query\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/push.md"), "# Push\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/comment.md"), "# Comment\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/transition.md"), "# Transition\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/pull-active.md"), "# Pull Active\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/reconcile.md"), "# Reconcile\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/start.md"), "# Start\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/close.md"), "# Close\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/asap-process.md"), "# ASAP Process\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/ubiquitous-language.md"), "# Ubiquitous Language\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/grill-me.md"), "# Grill Me\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/link.md"), "# Link\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/configure-status-mapping.md"), "# Configure Status Mapping\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/commands/triage.md"), "# Triage\n", "utf-8");

  // Agent files
  fs.mkdirSync(path.join(tmpDir, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, ".claude/agents/work-historian.md"), "# WH\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/agents/linter.md"), "# Linter\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/agents/ticket-writer.md"), "# Ticket Writer\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, ".claude/agents/research-partner.md"), "# Research Partner\n", "utf-8");
}

describe("doctor CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "rubber-ducky-doctor-cli-test-")
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("outputs JSON result for a healthy workspace", () => {
    createWorkspace(tmpDir);
    const output = runCli(["--json", "doctor"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.healthy).toBe(true);
    expect(result.checks).toBeInstanceOf(Array);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.passed).toBe(result.total);
  });

  it("reports failure when not inside a workspace", () => {
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    const output = runCliExpectFail(["--json", "doctor"], emptyDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/workspace/i);
  });

  it("reports checks with pass/fail status", () => {
    createWorkspace(tmpDir);
    // Remove a directory to cause a failure
    fs.rmSync(path.join(tmpDir, "wiki/tasks"), { recursive: true });

    const output = runCliExpectFail(["--json", "doctor"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(false);
    expect(result.healthy).toBe(false);
    const failedCheck = result.checks.find(
      (c: { name: string; pass: boolean }) => c.name === "directory-structure" && !c.pass
    );
    expect(failedCheck).toBeDefined();
  });

  it("shows help text for doctor command", () => {
    const output = runCli(["doctor", "--help"]);
    expect(output).toMatch(/health check/i);
  });

  it("doctor lint subcommand outputs JSON lint results", () => {
    createWorkspace(tmpDir);
    const output = runCli(["--json", "doctor", "lint"], tmpDir);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result).toHaveProperty("findings");
    expect(result).toHaveProperty("summary");
    expect(result.summary).toHaveProperty("errors");
    expect(result.summary).toHaveProperty("warnings");
  });

  it("doctor lint reports frontmatter errors", () => {
    createWorkspace(tmpDir);
    // Create a task with invalid frontmatter
    fs.writeFileSync(
      path.join(tmpDir, "wiki/tasks/bad.md"),
      "---\ntitle: Bad\ntype: task\ncreated: 2024-01-01\n---\n",
      "utf-8"
    );

    const output = runCli(["--json", "doctor", "lint"], tmpDir);
    const result = JSON.parse(output);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some((f: { rule: string }) => f.rule === "frontmatter-error")).toBe(true);
  });
});
