import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getBundledTemplates } from "../lib/update.js";

const CLI_PATH = path.resolve(__dirname, "..", "cli.ts");
const TSX_PATH = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

function runCli(args: string[], cwd?: string): string {
  return execFileSync(TSX_PATH, [CLI_PATH, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("update --json", () => {
  let tmpDir: string;
  let workspacePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-update-cmd-"));
    workspacePath = path.join(tmpDir, "workspace");
    fs.mkdirSync(workspacePath, { recursive: true });
    // Create a minimal workspace.md so the command recognizes it as a workspace
    fs.writeFileSync(
      path.join(workspacePath, "workspace.md"),
      "---\nname: Test\npurpose: Testing\nversion: 0.1.0\n---\n",
      "utf-8"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns JSON scan result with all files as new", () => {
    const output = runCli(["--json", "update"], workspacePath);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.scan).toBeDefined();
    expect(result.scan.newFiles.length).toBeGreaterThan(0);
    expect(result.scan.modified.length).toBe(0);
    expect(result.scan.unchanged.length).toBe(0);
  });

  it("returns JSON scan result with unchanged files when templates match", () => {
    const templates = getBundledTemplates();
    for (const t of templates) {
      const fullPath = path.join(workspacePath, t.relativePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, t.content, "utf-8");
    }

    const output = runCli(["--json", "update"], workspacePath);
    const result = JSON.parse(output);

    expect(result.success).toBe(true);
    expect(result.scan.unchanged.length).toBe(templates.length);
    expect(result.scan.newFiles.length).toBe(0);
    expect(result.scan.modified.length).toBe(0);
  });

  it("detects modified files and includes diff", () => {
    const templates = getBundledTemplates();
    const first = templates[0];
    const fullPath = path.join(workspacePath, first.relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, first.content + "\n<!-- custom -->", "utf-8");

    const output = runCli(["--json", "update"], workspacePath);
    const result = JSON.parse(output);

    expect(result.scan.modified.length).toBeGreaterThanOrEqual(1);
    const modifiedFile = result.scan.modified.find(
      (f: { relativePath: string }) => f.relativePath === first.relativePath
    );
    expect(modifiedFile).toBeDefined();
    expect(modifiedFile.diff).toBeDefined();
    expect(modifiedFile.diff.length).toBeGreaterThan(0);
  });

  it("each comparison has relativePath, status, and description", () => {
    const output = runCli(["--json", "update"], workspacePath);
    const result = JSON.parse(output);

    for (const comp of result.scan.comparisons) {
      expect(comp.relativePath).toBeDefined();
      expect(comp.status).toBeDefined();
      expect(comp.description).toBeDefined();
    }
  });

  it("fails if not run from a workspace directory", () => {
    const nonWorkspace = path.join(tmpDir, "not-a-workspace");
    fs.mkdirSync(nonWorkspace, { recursive: true });

    try {
      runCli(["--json", "update"], nonWorkspace);
      expect.fail("Should have thrown");
    } catch (error: unknown) {
      const err = error as { stdout?: string };
      const output = JSON.parse(err.stdout ?? "{}");
      expect(output.success).toBe(false);
      expect(output.error).toContain("workspace.md");
    }
  });
});

describe("update --help", () => {
  it("shows update in help output", () => {
    const output = runCli(["--help"]);
    expect(output).toContain("update");
  });
});
