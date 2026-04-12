import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI_PATH = path.resolve(__dirname, "..", "cli.ts");
const TSX_PATH = path.resolve(__dirname, "..", "..", "node_modules", ".bin", "tsx");

function runCli(args: string[], cwd?: string): string {
  return execFileSync(TSX_PATH, [CLI_PATH, ...args], {
    encoding: "utf-8",
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("CLI", () => {
  it("prints help with --help", () => {
    const output = runCli(["--help"]);

    expect(output).toContain("rubber-ducky");
    expect(output).toContain("init");
    expect(output).toContain("--json");
    expect(output).toContain("--version");
  });

  it("prints version with --version", () => {
    const output = runCli(["--version"]);

    expect(output.trim()).toBe("0.1.0");
  });

  describe("init --json", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-cli-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates workspace and returns JSON", () => {
      const target = path.join(tmpDir, "test-ws");
      const output = runCli(["--json", "init", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe(target);
      expect(result.filesCreated).toContain("workspace.md");
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain("UBIQUITOUS_LANGUAGE.md");
      expect(result.dirsCreated).toContain("wiki/daily");
      expect(result.dirsCreated).toContain("wiki/tasks");
      expect(result.dirsCreated).toContain("wiki/projects");
      expect(result.dirsCreated).toContain("raw");
    });

    it("creates valid workspace.md with YAML frontmatter", () => {
      const target = path.join(tmpDir, "yaml-test");
      runCli(["--json", "init", target]);

      const content = fs.readFileSync(path.join(target, "workspace.md"), "utf-8");
      expect(content).toMatch(/^---\n/);
      expect(content).toContain("name:");
      expect(content).toContain("purpose:");
      expect(content).toContain("version:");
    });

    it("returns error JSON when target exists and is non-empty", () => {
      const target = path.join(tmpDir, "existing");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "file.txt"), "content");

      try {
        runCli(["--json", "init", target]);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const err = error as { stdout?: string };
        const output = JSON.parse(err.stdout ?? "{}");
        expect(output.success).toBe(false);
        expect(output.error).toContain("already exists and is not empty");
      }
    });
  });
});
