import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { createWorkspace, migrateWorkspace, detectExistingContent, updateWorkspaceBackend, type WorkspaceOptions } from "../lib/workspace.js";
import type { BackendConfig, VocabularyOptions } from "../lib/templates.js";

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
    purpose: "Testing things",
    targetDir: "", // set per test
  };

  function opts(overrides?: Partial<WorkspaceOptions>): WorkspaceOptions {
    return {
      ...defaultOpts,
      targetDir: path.join(tmpDir, "my-workspace"),
      ...overrides,
    };
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

      for (const dir of ["wiki/daily", "wiki/tasks", "wiki/projects", "raw"]) {
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

    it("includes workspace name and purpose in frontmatter", async () => {
      const result = await createWorkspace(
        opts({ name: "Dev Log", purpose: "Track daily work" })
      );
      const content = fs.readFileSync(
        path.join(result.workspacePath, "workspace.md"),
        "utf-8"
      );

      expect(content).toContain("name: Dev Log");
      expect(content).toContain("purpose: Track daily work");
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

    it("includes workspace identity in CLAUDE.md", async () => {
      const result = await createWorkspace(
        opts({ name: "Dev Log", purpose: "Track daily work" })
      );
      const content = fs.readFileSync(
        path.join(result.workspacePath, "CLAUDE.md"),
        "utf-8"
      );

      expect(content).toContain("Dev Log");
      expect(content).toContain("Track daily work");
    });

    it("references UBIQUITOUS_LANGUAGE.md", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "CLAUDE.md"),
        "utf-8"
      );

      expect(content).toContain("UBIQUITOUS_LANGUAGE.md");
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

  describe("UBIQUITOUS_LANGUAGE.md generation", () => {
    it("creates UBIQUITOUS_LANGUAGE.md", async () => {
      const result = await createWorkspace(opts());
      expect(
        fs.existsSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"))
      ).toBe(true);
    });

    it("contains starter vocabulary structure", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"),
        "utf-8"
      );

      expect(content).toContain("# Ubiquitous Language");
    });
  });

  describe("Obsidian vault compatibility", () => {
    it("creates .obsidian directory for vault recognition", async () => {
      const result = await createWorkspace(opts());
      expect(
        fs.existsSync(path.join(result.workspacePath, ".obsidian"))
      ).toBe(true);
    });
  });

  describe("backend configuration", () => {
    it("writes backend configs into workspace.md frontmatter", async () => {
      const backends: BackendConfig[] = [
        { type: "github", mcp_server: "github" },
        { type: "jira", mcp_server: "atlassian-remote", server_url: "https://myorg.atlassian.net", project_key: "PROJ" },
      ];
      const result = await createWorkspace(opts({ backends }));
      const content = fs.readFileSync(path.join(result.workspacePath, "workspace.md"), "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = parseYaml(match![1]);

      expect(frontmatter.backends).toHaveLength(2);
      expect(frontmatter.backends[0].type).toBe("github");
      expect(frontmatter.backends[1].type).toBe("jira");
      expect(frontmatter.backends[1].server_url).toBe("https://myorg.atlassian.net");
    });

    it("produces empty backends array when none provided", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(path.join(result.workspacePath, "workspace.md"), "utf-8");
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = parseYaml(match![1]);

      expect(frontmatter.backends).toEqual([]);
    });

    it("creates valid workspace when backends are skipped", async () => {
      const result = await createWorkspace(opts({ backends: [] }));

      expect(fs.existsSync(path.join(result.workspacePath, "workspace.md"))).toBe(true);
      expect(fs.existsSync(path.join(result.workspacePath, "CLAUDE.md"))).toBe(true);
      expect(fs.existsSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"))).toBe(true);
      expect(result.filesCreated).toContain("workspace.md");
    });
  });

  describe("vocabulary in UBIQUITOUS_LANGUAGE.md", () => {
    it("includes custom brands in UBIQUITOUS_LANGUAGE.md", async () => {
      const vocabulary: VocabularyOptions = {
        brands: ["Acme Corp", "Widget Co"],
      };
      const result = await createWorkspace(opts({ vocabulary }));
      const content = fs.readFileSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("## Brands");
      expect(content).toContain("Acme Corp");
      expect(content).toContain("Widget Co");
    });

    it("includes custom teams in UBIQUITOUS_LANGUAGE.md", async () => {
      const vocabulary: VocabularyOptions = {
        teams: ["Frontend", "Backend"],
      };
      const result = await createWorkspace(opts({ vocabulary }));
      const content = fs.readFileSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("## Teams");
      expect(content).toContain("Frontend");
      expect(content).toContain("Backend");
    });

    it("includes custom labels in UBIQUITOUS_LANGUAGE.md", async () => {
      const vocabulary: VocabularyOptions = {
        labels: ["urgent", "bug"],
      };
      const result = await createWorkspace(opts({ vocabulary }));
      const content = fs.readFileSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("## Labels");
      expect(content).toContain("urgent");
      expect(content).toContain("bug");
    });

    it("always includes status vocabulary regardless of custom vocabulary", async () => {
      const vocabulary: VocabularyOptions = { brands: ["Test"] };
      const result = await createWorkspace(opts({ vocabulary }));
      const content = fs.readFileSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("backlog");
      expect(content).toContain("to-do");
      expect(content).toContain("in-progress");
      expect(content).toContain("done");
      expect(content).toContain("deferred");
    });

    it("produces default UBIQUITOUS_LANGUAGE.md when no vocabulary is provided", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(path.join(result.workspacePath, "UBIQUITOUS_LANGUAGE.md"), "utf-8");

      expect(content).toContain("# Ubiquitous Language");
      expect(content).toContain("## Statuses");
      expect(content).toContain("## Custom terms");
    });
  });

  describe("skill generation", () => {
    it("generates ingest-asana skill when asana backend is configured", async () => {
      const backends: BackendConfig[] = [
        { type: "asana", mcp_server: "asana", workspace_id: "12345" },
      ];
      const result = await createWorkspace(opts({ backends }));

      const skillPath = path.join(result.workspacePath, ".claude", "commands", "ingest-asana.md");
      expect(fs.existsSync(skillPath)).toBe(true);

      const content = fs.readFileSync(skillPath, "utf-8");
      expect(content).toContain("Ingest Asana Task");
      expect(content).toContain("12345");
    });

    it("includes skill in filesCreated result", async () => {
      const backends: BackendConfig[] = [
        { type: "asana", mcp_server: "asana" },
      ];
      const result = await createWorkspace(opts({ backends }));

      expect(result.filesCreated).toContain(".claude/commands/ingest-asana.md");
    });

    it("does not generate skills when no backends configured", async () => {
      const result = await createWorkspace(opts());

      const skillPath = path.join(result.workspacePath, ".claude", "commands", "ingest-asana.md");
      expect(fs.existsSync(skillPath)).toBe(false);
      expect(result.filesCreated).not.toContain(".claude/commands/ingest-asana.md");
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

    it("creates backend-specific reference files when backends configured", async () => {
      const backends: BackendConfig[] = [
        { type: "github", mcp_server: "github" },
      ];
      const result = await createWorkspace(opts({ backends }));

      const ghPath = path.join(result.workspacePath, "references", "github-ticket-template.md");
      expect(fs.existsSync(ghPath)).toBe(true);
      expect(result.filesCreated).toContain("references/github-ticket-template.md");

      const content = fs.readFileSync(ghPath, "utf-8");
      expect(content).toContain("GitHub Ticket Template");
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
      expect(result.filesCreated).toContain("UBIQUITOUS_LANGUAGE.md");
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

  describe("detectExistingContent", () => {
    it("returns null for non-existent directory", () => {
      const result = detectExistingContent(path.join(tmpDir, "nope"));
      expect(result).toBeNull();
    });

    it("returns null for empty directory", () => {
      const target = path.join(tmpDir, "empty");
      fs.mkdirSync(target, { recursive: true });

      const result = detectExistingContent(target);
      expect(result).toBeNull();
    });

    it("returns scan result and migration plan for non-empty directory", () => {
      const target = path.join(tmpDir, "existing");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "notes.md"), "# Notes");

      const result = detectExistingContent(target);

      expect(result).not.toBeNull();
      expect(result!.scanResult.totalMdFiles).toBe(1);
      expect(result!.migrationPlan.filesToAddFrontmatter).toContain("notes.md");
    });
  });

  describe("migrateWorkspace", () => {
    it("completes successfully on a non-empty directory", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "my-notes.md"), "# My Notes\nContent");

      const result = await migrateWorkspace({
        name: "Migrated Vault",
        purpose: "Testing migration",
        targetDir: target,
      });

      expect(result.workspacePath).toBe(target);
      expect(result.migrated).toBe(true);
      expect(result.filesAdopted).toContain("my-notes.md");
    });

    it("creates workspace structure alongside existing content", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "readme.md"), "# README");

      await migrateWorkspace({
        name: "Test",
        purpose: "Testing",
        targetDir: target,
      });

      expect(fs.existsSync(path.join(target, "wiki", "daily"))).toBe(true);
      expect(fs.existsSync(path.join(target, "wiki", "tasks"))).toBe(true);
      expect(fs.existsSync(path.join(target, "workspace.md"))).toBe(true);
      expect(fs.existsSync(path.join(target, "CLAUDE.md"))).toBe(true);
    });

    it("preserves existing file content", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      const originalContent = "# Important\n\nDo not lose this content.";
      fs.writeFileSync(path.join(target, "important.md"), originalContent);

      await migrateWorkspace({
        name: "Test",
        purpose: "Testing",
        targetDir: target,
      });

      const content = fs.readFileSync(path.join(target, "important.md"), "utf-8");
      expect(content).toContain("# Important");
      expect(content).toContain("Do not lose this content.");
    });

    it("creates CLAUDE.md.backup when CLAUDE.md already exists", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      const originalClaudeMd = "# My Custom CLAUDE.md\n\nCustom instructions here.";
      fs.writeFileSync(path.join(target, "CLAUDE.md"), originalClaudeMd);

      const result = await migrateWorkspace({
        name: "Test",
        purpose: "Testing",
        targetDir: target,
      });

      // Backup should exist with original content
      expect(fs.existsSync(path.join(target, "CLAUDE.md.backup"))).toBe(true);
      const backupContent = fs.readFileSync(path.join(target, "CLAUDE.md.backup"), "utf-8");
      expect(backupContent).toBe(originalClaudeMd);

      // New CLAUDE.md should be the bundled version (not the original)
      const newContent = fs.readFileSync(path.join(target, "CLAUDE.md"), "utf-8");
      expect(newContent).not.toBe(originalClaudeMd);
    });

    it("does NOT create CLAUDE.md.backup when no CLAUDE.md exists", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "notes.md"), "# Notes");

      await migrateWorkspace({
        name: "Test",
        purpose: "Testing",
        targetDir: target,
      });

      // No backup should exist
      expect(fs.existsSync(path.join(target, "CLAUDE.md.backup"))).toBe(false);
      // But CLAUDE.md should be created
      expect(fs.existsSync(path.join(target, "CLAUDE.md"))).toBe(true);
    });

    it("includes claudeMdBackedUp in result when backup was created", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "CLAUDE.md"), "# Existing CLAUDE.md");

      const result = await migrateWorkspace({
        name: "Test",
        purpose: "Testing",
        targetDir: target,
      });

      expect(result.claudeMdBackedUp).toBe(true);
    });

    it("does NOT overwrite existing backup on re-run", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      const originalContent = "# My custom CLAUDE.md";
      fs.writeFileSync(path.join(target, "CLAUDE.md"), originalContent);

      // First migration — creates backup
      await migrateWorkspace({ name: "Test", purpose: "Testing", targetDir: target });
      const backupAfterFirst = fs.readFileSync(path.join(target, "CLAUDE.md.backup"), "utf-8");
      expect(backupAfterFirst).toBe(originalContent);

      // Second migration — backup should be preserved, not overwritten
      const result = await migrateWorkspace({ name: "Test", purpose: "Testing", targetDir: target });
      const backupAfterSecond = fs.readFileSync(path.join(target, "CLAUDE.md.backup"), "utf-8");
      expect(backupAfterSecond).toBe(originalContent);
      expect(result.claudeMdBackedUp).toBeUndefined();
    });

    it("does not set claudeMdBackedUp when no backup was needed", async () => {
      const target = path.join(tmpDir, "vault");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "notes.md"), "# Notes");

      const result = await migrateWorkspace({
        name: "Test",
        purpose: "Testing",
        targetDir: target,
      });

      expect(result.claudeMdBackedUp).toBeUndefined();
    });
  });
});

describe("updateWorkspaceBackend", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readFrontmatter(wsDir: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(wsDir, "workspace.md"), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return parseYaml(match![1]);
  }

  it("writes naming_source and naming_case to an existing Asana backend", async () => {
    const targetDir = path.join(tmpDir, "ws-update");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [
        { type: "asana", workspace_id: "ws-123", project_gid: "proj-456" },
      ],
    });

    updateWorkspaceBackend(targetDir, "asana", {
      naming_source: "identifier",
      naming_case: "preserve",
      identifier_field: "TIK",
    });

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("identifier");
    expect(asana.naming_case).toBe("preserve");
    expect(asana.identifier_field).toBe("TIK");
    // Existing fields preserved
    expect(asana.workspace_id).toBe("ws-123");
    expect(asana.project_gid).toBe("proj-456");
  });

  it("preserves markdown body after frontmatter update", async () => {
    const targetDir = path.join(tmpDir, "ws-body");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [{ type: "asana", workspace_id: "ws-123" }],
    });

    updateWorkspaceBackend(targetDir, "asana", {
      naming_source: "title",
    });

    const content = fs.readFileSync(path.join(targetDir, "workspace.md"), "utf-8");
    expect(content).toContain("# test");
    expect(content).toContain("wiki/daily/");
  });

  it("writes naming_source gid without naming_case", async () => {
    const targetDir = path.join(tmpDir, "ws-gid");
    await createWorkspace({
      name: "test",
      purpose: "testing",
      targetDir,
      backends: [{ type: "asana", workspace_id: "ws-123" }],
    });

    updateWorkspaceBackend(targetDir, "asana", {
      naming_source: "gid",
    });

    const fm = readFrontmatter(targetDir);
    const asana = (fm.backends as BackendConfig[])[0];
    expect(asana.naming_source).toBe("gid");
    expect(asana).not.toHaveProperty("naming_case");
  });
});
