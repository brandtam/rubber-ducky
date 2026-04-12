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

    it("migrates existing vault with .md files and returns JSON", () => {
      const target = path.join(tmpDir, "existing-vault");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "my-notes.md"), "# My Notes\nSome content");
      fs.writeFileSync(
        path.join(target, "task.md"),
        "---\ntitle: A Task\nstatus: to-do\n---\n\n# A Task"
      );

      const output = runCli(["--json", "init", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.migrated).toBe(true);
      expect(result.filesAdopted).toContain("my-notes.md");
      expect(result.filesAdopted).toContain("task.md");
    });

    it("preserves existing content during migration", () => {
      const target = path.join(tmpDir, "preserve-test");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "important.md"), "# Important\n\nDo not lose this.");

      runCli(["--json", "init", target]);

      const content = fs.readFileSync(path.join(target, "important.md"), "utf-8");
      expect(content).toContain("# Important");
      expect(content).toContain("Do not lose this.");
      // Should also have frontmatter added
      expect(content).toMatch(/^---\n/);
      expect(content).toContain("adopted: true");
    });

    it("creates workspace structure during migration", () => {
      const target = path.join(tmpDir, "struct-test");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "note.md"), "# Note");

      runCli(["--json", "init", target]);

      expect(fs.existsSync(path.join(target, "wiki", "daily"))).toBe(true);
      expect(fs.existsSync(path.join(target, "wiki", "tasks"))).toBe(true);
      expect(fs.existsSync(path.join(target, "wiki", "projects"))).toBe(true);
      expect(fs.existsSync(path.join(target, "workspace.md"))).toBe(true);
      expect(fs.existsSync(path.join(target, "CLAUDE.md"))).toBe(true);
    });

    it("generates index from adopted content", () => {
      const target = path.join(tmpDir, "index-test");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "alpha.md"), "# Alpha");
      fs.writeFileSync(path.join(target, "beta.md"), "# Beta");

      runCli(["--json", "init", target]);

      const indexPath = path.join(target, "wiki", "index.md");
      expect(fs.existsSync(indexPath)).toBe(true);
      const index = fs.readFileSync(indexPath, "utf-8");
      expect(index).toContain("alpha.md");
      expect(index).toContain("beta.md");
    });

    it("handles directory with only non-.md files as empty workspace creation", () => {
      const target = path.join(tmpDir, "non-md");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "file.txt"), "text content");

      // Non-md files trigger migration path but with no .md files to adopt
      const output = runCli(["--json", "init", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.migrated).toBe(true);
    });
  });
});
