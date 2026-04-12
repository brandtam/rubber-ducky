import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createWorkspace, migrateWorkspace, detectExistingContent, type WorkspaceOptions } from "../lib/workspace.js";

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

    it("is approximately 50 lines or fewer", async () => {
      const result = await createWorkspace(opts());
      const content = fs.readFileSync(
        path.join(result.workspacePath, "CLAUDE.md"),
        "utf-8"
      );
      const lines = content.split("\n").length;

      expect(lines).toBeLessThanOrEqual(60);
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
  });
});
