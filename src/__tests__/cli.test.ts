import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";

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
    expect(output).toContain("status");
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

    it("generates index of migrated content", () => {
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

    it("writes backend configs to workspace.md when --backends-json is provided", () => {
      const target = path.join(tmpDir, "backend-test");
      const backends = JSON.stringify([
        { type: "github", mcp_server: "github" },
        { type: "jira", mcp_server: "atlassian-remote", server_url: "https://myorg.atlassian.net", project_key: "PROJ" },
      ]);
      runCli(["--json", "init", target, "--backends-json", backends]);

      const content = fs.readFileSync(path.join(target, "workspace.md"), "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = parseYaml(match![1]);

      expect(frontmatter.backends).toHaveLength(2);
      expect(frontmatter.backends[0].type).toBe("github");
      expect(frontmatter.backends[1].type).toBe("jira");
      expect(frontmatter.backends[1].server_url).toBe("https://myorg.atlassian.net");
    });

    it("writes vocabulary to UBIQUITOUS_LANGUAGE.md when --vocabulary-json is provided", () => {
      const target = path.join(tmpDir, "vocab-test");
      const vocabulary = JSON.stringify({
        brands: ["Acme Corp"],
        teams: ["Frontend", "Backend"],
        labels: ["urgent"],
      });
      runCli(["--json", "init", target, "--vocabulary-json", vocabulary]);

      const content = fs.readFileSync(path.join(target, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("## Brands");
      expect(content).toContain("Acme Corp");
      expect(content).toContain("## Teams");
      expect(content).toContain("Frontend");
      expect(content).toContain("## Labels");
      expect(content).toContain("urgent");
    });

    it("creates valid workspace when backends are skipped (no --backends-json)", () => {
      const target = path.join(tmpDir, "no-backend-test");
      const output = runCli(["--json", "init", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);

      const content = fs.readFileSync(path.join(target, "workspace.md"), "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = parseYaml(match![1]);

      expect(frontmatter.backends).toEqual([]);
    });

    it("always includes status vocabulary even with custom vocabulary", () => {
      const target = path.join(tmpDir, "status-vocab-test");
      const vocabulary = JSON.stringify({ brands: ["Test"] });
      runCli(["--json", "init", target, "--vocabulary-json", vocabulary]);

      const content = fs.readFileSync(path.join(target, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("backlog");
      expect(content).toContain("to-do");
      expect(content).toContain("in-progress");
      expect(content).toContain("done");
      expect(content).toContain("deferred");
    });
  });

  describe("status --json", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-status-test-")));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns workspace info when run inside a workspace", () => {
      const wsPath = path.join(tmpDir, "my-ws");
      runCli(["--json", "init", wsPath]);

      const output = runCli(["--json", "status"], wsPath);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.workspace.name).toBe("my-ws");
      expect(result.workspace.workspaceRoot).toBe(wsPath);
    });

    it("returns workspace info when run from a nested subdirectory", () => {
      const wsPath = path.join(tmpDir, "nested-ws");
      runCli(["--json", "init", wsPath]);

      const output = runCli(["--json", "status"], path.join(wsPath, "wiki", "daily"));
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.workspace.workspaceRoot).toBe(wsPath);
    });

    it("returns error when run outside any workspace", () => {
      try {
        runCli(["--json", "status"], tmpDir);
        expect.fail("Should have thrown");
      } catch (error: unknown) {
        const err = error as { stdout?: string };
        const output = JSON.parse(err.stdout ?? "{}");
        expect(output.success).toBe(false);
        expect(output.error).toMatch(/not inside a rubber-ducky workspace/i);
      }
    });

    it("workspace A status shows workspace A config, not workspace B", () => {
      const wsA = path.join(tmpDir, "work");
      const wsB = path.join(tmpDir, "personal");
      runCli(["--json", "init", wsA]);
      runCli(["--json", "init", wsB]);

      const outputA = JSON.parse(runCli(["--json", "status"], wsA));
      const outputB = JSON.parse(runCli(["--json", "status"], wsB));

      expect(outputA.workspace.name).toBe("work");
      expect(outputB.workspace.name).toBe("personal");
      expect(outputA.workspace.workspaceRoot).not.toBe(outputB.workspace.workspaceRoot);
    });
  });
});
