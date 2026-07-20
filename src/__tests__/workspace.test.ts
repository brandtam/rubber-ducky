import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import {
  createWorkspace,
  type WorkspaceOptions,
} from "../lib/workspace.js";

describe("createWorkspace", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const defaultOpts: WorkspaceOptions = {
    name: "My Workspace",
    targetDir: "", // set per test
  };

  function opts(overrides?: Record<string, unknown>): WorkspaceOptions {
    const merged = {
      ...defaultOpts,
      targetDir: path.join(tmpDir, "my-workspace"),
      ...overrides,
    };
    return { name: merged.name as string, targetDir: merged.targetDir as string };
  }

  describe("directory structure", () => {
    it("creates wiki/daily/, wiki/tasks/, wiki/projects/, and raw/ directories", async () => {
      const result = await createWorkspace(opts());

      expect(fs.existsSync(path.join(result.workspacePath, "wiki", "daily"))).toBe(true);
      expect(fs.existsSync(path.join(result.workspacePath, "wiki", "tasks"))).toBe(true);
      expect(fs.existsSync(path.join(result.workspacePath, "wiki", "projects"))).toBe(true);
      expect(fs.existsSync(path.join(result.workspacePath, "raw"))).toBe(true);
    });

    it("drops .gitkeep files in empty content directories so git tracks them", async () => {
      const result = await createWorkspace(opts());

      for (const dir of [
        "wiki/daily",
        "wiki/tasks",
        "wiki/projects",
        "wiki/meetings",
        "wiki/spikes",
        "wiki/weekly",
        "wiki/repos",
        "raw",
      ]) {
        expect(fs.existsSync(path.join(result.workspacePath, dir, ".gitkeep"))).toBe(true);
      }
    });

    it("creates the workspace in the specified target directory", async () => {
      const target = path.join(tmpDir, "custom-target");
      const result = await createWorkspace(opts({ targetDir: target }));

      expect(result.workspacePath).toBe(target);
      expect(fs.existsSync(target)).toBe(true);
    });

    it("throws if the target directory already exists and is non-empty", async () => {
      const target = path.join(tmpDir, "existing");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "file.txt"), "content");

      await expect(createWorkspace(opts({ targetDir: target }))).rejects.toThrow(
        /already exists and is not empty/
      );
    });

    it("succeeds on empty existing directory", async () => {
      const target = path.join(tmpDir, "empty-dir");
      fs.mkdirSync(target, { recursive: true });

      const result = await createWorkspace(opts({ targetDir: target }));
      expect(result.workspacePath).toBe(target);
    });
  });

  describe("workspace.md generation", () => {
    it("creates workspace.md with valid YAML frontmatter", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "workspace.md"),
        "utf-8"
      );

      // Should start and end with frontmatter delimiters
      expect(content).toMatch(/^---\n/);
      expect(content).toMatch(/\n---\n/);
    });


    it("includes version field in frontmatter", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "workspace.md"),
        "utf-8"
      );

      expect(content).toContain("version: 0.1.0");
    });

    it("includes a markdown body after frontmatter", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "workspace.md"),
        "utf-8"
      );

      const parts = content.split("---");
      // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2]+ is body
      const body = parts.slice(2).join("---").trim();
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe("CLAUDE.md generation", () => {
    it("creates CLAUDE.md", async () => {
      const result = await createWorkspace(opts());
      expect(
        fs.existsSync(path.join(result.workspacePath, "CLAUDE.md"))
      ).toBe(true);
    });



    it("does NOT reference UBIQUITOUS_LANGUAGE.md in silent init (no backends)", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "CLAUDE.md"),
        "utf-8"
      );

      expect(content).not.toContain("Import and follow @UBIQUITOUS_LANGUAGE.md");
    });

    it("includes a Connected integrations placeholder when no backends", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "CLAUDE.md"),
        "utf-8"
      );

      expect(content).toContain("## Connected integrations");
      expect(content).toContain("/connect");
    });

    it("includes CLI command reference and request mapping", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "CLAUDE.md"),
        "utf-8"
      );

      expect(content).toContain("rubber-ducky page create");
      expect(content).toContain("User says");
    });
  });

  describe("backend configuration", () => {

    it("omits the backends key entirely when none provided (silent init)", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(path.join(result.workspacePath, "workspace.md"), "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = parseYaml(match![1]);

      expect(frontmatter).not.toHaveProperty("backends");
    });

  });



  describe("reference file generation", () => {
    it("creates references directory", async () => {
      const result = await createWorkspace(opts());
      const refsDir = path.join(result.workspacePath, "references");

      expect(fs.existsSync(refsDir)).toBe(true);
    });

    it("creates universal reference files", async () => {
      const result = await createWorkspace(opts());

      const fmPath = path.join(result.workspacePath, "references", "frontmatter-templates.md");
      const cliPath = path.join(result.workspacePath, "references", "when-to-use-cli.md");

      expect(fs.existsSync(fmPath)).toBe(true);
      expect(fs.existsSync(cliPath)).toBe(true);
    });

    it("includes reference files in filesCreated", async () => {
      const result = await createWorkspace(opts());

      expect(result.filesCreated).toContain("references/frontmatter-templates.md");
      expect(result.filesCreated).toContain("references/when-to-use-cli.md");
    });

    it("does not create backend-specific files for unconfigured backends", async () => {
      const result = await createWorkspace(opts());

      const ghPath = path.join(result.workspacePath, "references", "github-ticket-template.md");
      const jiraPath = path.join(result.workspacePath, "references", "jira-ticket-template.md");
      const asanaPath = path.join(result.workspacePath, "references", "asana-ticket-template.md");

      expect(fs.existsSync(ghPath)).toBe(false);
      expect(fs.existsSync(jiraPath)).toBe(false);
      expect(fs.existsSync(asanaPath)).toBe(false);
    });

    it("includes references in dirsCreated", async () => {
      const result = await createWorkspace(opts());

      expect(result.dirsCreated).toContain("references");
    });
  });

  describe("result object", () => {
    it("returns workspace path and list of created files", async () => {
      const result = await createWorkspace(opts());

      expect(result.workspacePath).toBeDefined();
      expect(result.filesCreated).toBeInstanceOf(Array);
      expect(result.filesCreated.length).toBeGreaterThan(0);
      expect(result.filesCreated).toContain("workspace.md");
      expect(result.filesCreated).toContain("CLAUDE.md");
      // UBIQUITOUS_LANGUAGE.md no longer ships with silent init
      expect(result.filesCreated).not.toContain("UBIQUITOUS_LANGUAGE.md");
    });

    it("returns list of created directories", async () => {
      const result = await createWorkspace(opts());

      expect(result.dirsCreated).toBeInstanceOf(Array);
      expect(result.dirsCreated).toContain("wiki/daily");
      expect(result.dirsCreated).toContain("wiki/tasks");
      expect(result.dirsCreated).toContain("wiki/projects");
      expect(result.dirsCreated).toContain("raw");
    });

    it("creates .rubber-ducky/transactions directory", async () => {
      const result = await createWorkspace(opts());

      expect(result.dirsCreated).toContain(".rubber-ducky/transactions");
      expect(
        fs.existsSync(path.join(result.workspacePath, ".rubber-ducky", "transactions")),
      ).toBe(true);
    });

    it("includes .rubber-ducky/ in generated .gitignore", async () => {
      const result = await createWorkspace(opts());

      const gitignore = fs.readFileSync(
        path.join(result.workspacePath, ".gitignore"),
        "utf-8",
      );
      expect(gitignore).toContain(".rubber-ducky/");
    });
  });

});

describe("createWorkspace + new config abstractions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scaffolds wiki/meetings and wiki/spikes directories", async () => {
    const target = path.join(tmpDir, "ws");
    const result = await createWorkspace({
      name: "Test",
      targetDir: target,
    });

    expect(fs.existsSync(path.join(result.workspacePath, "wiki", "meetings"))).toBe(true);
    expect(fs.existsSync(path.join(result.workspacePath, "wiki", "spikes"))).toBe(true);
    expect(fs.existsSync(path.join(result.workspacePath, "wiki", "meetings", ".gitkeep"))).toBe(true);
    expect(fs.existsSync(path.join(result.workspacePath, "wiki", "spikes", ".gitkeep"))).toBe(true);
  });

  it("does NOT scaffold .claude/voice.md (no longer generated at init)", async () => {
    const target = path.join(tmpDir, "ws");
    const result = await createWorkspace({
      name: "Test",
      targetDir: target,
    });

    const voicePath = path.join(result.workspacePath, ".claude", "voice.md");
    expect(fs.existsSync(voicePath)).toBe(false);
  });
});
