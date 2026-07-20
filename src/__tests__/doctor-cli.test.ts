import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliFail } from "./harness.js";

function createWorkspace(tmpDir: string): void {
  const dirs = ["wiki/daily", "wiki/tasks", "wiki/projects", "raw"];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(tmpDir, dir), { recursive: true });
  }

  fs.writeFileSync(
    path.join(tmpDir, "workspace.md"),
    `---\nname: test-workspace\npurpose: testing\nversion: "0.1.0"\ncreated: "2024-01-01"\n---\n\n# Test\n`,
    "utf-8"
  );

  fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Test\n", "utf-8");
  fs.writeFileSync(path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"), "# UL\n", "utf-8");
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
    const { stdout, status } = runCliFail(["--json", "doctor"], emptyDir);
    const result = JSON.parse(stdout);

    expect(status).not.toBe(0);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/workspace/i);
  });

  it("reports checks with pass/fail status", () => {
    createWorkspace(tmpDir);
    // Remove a directory to cause a failure
    fs.rmSync(path.join(tmpDir, "wiki/tasks"), { recursive: true });

    const { stdout, status } = runCliFail(["--json", "doctor"], tmpDir);
    const result = JSON.parse(stdout);

    expect(status).not.toBe(0);
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
