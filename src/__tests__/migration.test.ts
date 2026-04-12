import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import {
  scanExistingContent,
  buildMigrationPlan,
  executeMigration,
  type ScanResult,
} from "../lib/migration.js";

describe("scanExistingContent", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-migration-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects existing .md files in the target directory", () => {
    fs.writeFileSync(path.join(tmpDir, "notes.md"), "# My Notes\nSome content");
    fs.writeFileSync(path.join(tmpDir, "todo.md"), "# TODO\n- Item 1");

    const result = scanExistingContent(tmpDir);

    expect(result.totalMdFiles).toBe(2);
    expect(result.files).toHaveLength(2);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual(["notes.md", "todo.md"]);
  });

  it("returns empty result for directories with no .md files", () => {
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "text file");

    const result = scanExistingContent(tmpDir);

    expect(result.totalMdFiles).toBe(0);
    expect(result.files).toHaveLength(0);
  });

  it("scans nested directories for .md files", () => {
    fs.mkdirSync(path.join(tmpDir, "subfolder"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "top.md"), "# Top");
    fs.writeFileSync(path.join(tmpDir, "subfolder", "nested.md"), "# Nested");

    const result = scanExistingContent(tmpDir);

    expect(result.totalMdFiles).toBe(2);
    expect(result.files.map((f) => f.relativePath).sort()).toEqual(["subfolder/nested.md", "top.md"]);
  });

  it("identifies files with valid YAML frontmatter", () => {
    fs.writeFileSync(
      path.join(tmpDir, "with-frontmatter.md"),
      "---\ntitle: My Note\nstatus: in-progress\n---\n\n# My Note\nContent here"
    );
    fs.writeFileSync(path.join(tmpDir, "without-frontmatter.md"), "# Just Markdown\nNo frontmatter");

    const result = scanExistingContent(tmpDir);

    const withFm = result.files.find((f) => f.relativePath === "with-frontmatter.md")!;
    const withoutFm = result.files.find((f) => f.relativePath === "without-frontmatter.md")!;

    expect(withFm.hasFrontmatter).toBe(true);
    expect(withFm.frontmatter).toEqual({ title: "My Note", status: "in-progress" });
    expect(withoutFm.hasFrontmatter).toBe(false);
    expect(withoutFm.frontmatter).toBeUndefined();
  });

  it("counts files with frontmatter separately", () => {
    fs.writeFileSync(path.join(tmpDir, "a.md"), "---\ntitle: A\n---\n\n# A");
    fs.writeFileSync(path.join(tmpDir, "b.md"), "# B\nNo frontmatter");
    fs.writeFileSync(path.join(tmpDir, "c.md"), "---\ntitle: C\ntype: task\n---\n\n# C");

    const result = scanExistingContent(tmpDir);

    expect(result.totalMdFiles).toBe(3);
    expect(result.filesWithFrontmatter).toBe(2);
  });

  it("detects existing directory structures", () => {
    fs.mkdirSync(path.join(tmpDir, "daily"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".obsidian"), { recursive: true });

    const result = scanExistingContent(tmpDir);

    expect(result.directories.hasDaily).toBe(true);
    expect(result.directories.hasTasks).toBe(true);
    expect(result.directories.hasProjects).toBe(false);
    expect(result.directories.hasObsidian).toBe(true);
  });

  it("detects daily/ and tasks/ inside wiki/ as well", () => {
    fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });

    const result = scanExistingContent(tmpDir);

    expect(result.directories.hasDaily).toBe(true);
    expect(result.directories.hasTasks).toBe(true);
    expect(result.directories.hasProjects).toBe(true);
  });

  it("ignores .obsidian directory contents when scanning for .md files", () => {
    fs.mkdirSync(path.join(tmpDir, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".obsidian", "config.md"), "obsidian config");
    fs.writeFileSync(path.join(tmpDir, "real-note.md"), "# Real Note");

    const result = scanExistingContent(tmpDir);

    expect(result.totalMdFiles).toBe(1);
    expect(result.files[0].relativePath).toBe("real-note.md");
  });
});

describe("buildMigrationPlan", () => {
  it("lists directories that need to be created", () => {
    const scan: ScanResult = {
      files: [],
      directories: {
        hasDaily: false,
        hasTasks: false,
        hasProjects: false,
        hasRaw: false,
        hasObsidian: true,
      },
      totalMdFiles: 0,
      filesWithFrontmatter: 0,
    };

    const plan = buildMigrationPlan(scan);

    expect(plan.dirsToCreate).toContain("wiki/daily");
    expect(plan.dirsToCreate).toContain("wiki/tasks");
    expect(plan.dirsToCreate).toContain("wiki/projects");
    expect(plan.dirsToCreate).toContain("raw");
    expect(plan.dirsToCreate).not.toContain(".obsidian");
  });

  it("skips directories that already exist", () => {
    const scan: ScanResult = {
      files: [],
      directories: {
        hasDaily: true,
        hasTasks: true,
        hasProjects: true,
        hasRaw: true,
        hasObsidian: true,
      },
      totalMdFiles: 0,
      filesWithFrontmatter: 0,
    };

    const plan = buildMigrationPlan(scan);

    expect(plan.dirsToCreate).toHaveLength(0);
  });

  it("identifies files needing frontmatter added", () => {
    const scan: ScanResult = {
      files: [
        { relativePath: "notes.md", hasFrontmatter: false },
        { relativePath: "todo.md", hasFrontmatter: false },
      ],
      directories: {
        hasDaily: false,
        hasTasks: false,
        hasProjects: false,
        hasRaw: false,
        hasObsidian: false,
      },
      totalMdFiles: 2,
      filesWithFrontmatter: 0,
    };

    const plan = buildMigrationPlan(scan);

    expect(plan.filesToAddFrontmatter).toEqual(["notes.md", "todo.md"]);
  });

  it("identifies files with existing frontmatter to update", () => {
    const scan: ScanResult = {
      files: [
        { relativePath: "task.md", hasFrontmatter: true, frontmatter: { title: "Task" } },
        { relativePath: "plain.md", hasFrontmatter: false },
      ],
      directories: {
        hasDaily: false,
        hasTasks: false,
        hasProjects: false,
        hasRaw: false,
        hasObsidian: false,
      },
      totalMdFiles: 2,
      filesWithFrontmatter: 1,
    };

    const plan = buildMigrationPlan(scan);

    expect(plan.filesToUpdateFrontmatter).toEqual(["task.md"]);
    expect(plan.filesToAddFrontmatter).toEqual(["plain.md"]);
  });

  it("lists template files that need to be created", () => {
    const scan: ScanResult = {
      files: [],
      directories: {
        hasDaily: false,
        hasTasks: false,
        hasProjects: false,
        hasRaw: false,
        hasObsidian: false,
      },
      totalMdFiles: 0,
      filesWithFrontmatter: 0,
    };

    const plan = buildMigrationPlan(scan);

    expect(plan.templateFilesToCreate).toContain("workspace.md");
    expect(plan.templateFilesToCreate).toContain("CLAUDE.md");
    expect(plan.templateFilesToCreate).toContain("UBIQUITOUS_LANGUAGE.md");
  });

  it("skips template files that already exist in the scan", () => {
    const scan: ScanResult = {
      files: [
        { relativePath: "workspace.md", hasFrontmatter: true, frontmatter: { name: "existing" } },
      ],
      directories: {
        hasDaily: false,
        hasTasks: false,
        hasProjects: false,
        hasRaw: false,
        hasObsidian: false,
      },
      totalMdFiles: 1,
      filesWithFrontmatter: 1,
    };

    const plan = buildMigrationPlan(scan);

    expect(plan.templateFilesToCreate).not.toContain("workspace.md");
    expect(plan.templateFilesToCreate).toContain("CLAUDE.md");
    expect(plan.templateFilesToCreate).toContain("UBIQUITOUS_LANGUAGE.md");
  });
});

describe("executeMigration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-migrate-exec-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates missing directories", () => {
    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    expect(fs.existsSync(path.join(tmpDir, "wiki", "daily"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "projects"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "raw"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".obsidian"))).toBe(true);
  });

  it("creates template files that don't exist", () => {
    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    expect(fs.existsSync(path.join(tmpDir, "workspace.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "CLAUDE.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "UBIQUITOUS_LANGUAGE.md"))).toBe(true);
  });

  it("adds frontmatter to files without it", () => {
    fs.writeFileSync(path.join(tmpDir, "my-note.md"), "# My Note\n\nSome content here.");

    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    const content = fs.readFileSync(path.join(tmpDir, "my-note.md"), "utf-8");

    expect(content).toMatch(/^---\n/);
    expect(content).toContain("title: my-note");
    expect(content).toContain("adopted: true");
    // Original content preserved
    expect(content).toContain("# My Note");
    expect(content).toContain("Some content here.");
  });

  it("preserves existing content when adding frontmatter", () => {
    const originalContent = "# Important Notes\n\n- Item 1\n- Item 2\n\n## Section\n\nMore stuff.";
    fs.writeFileSync(path.join(tmpDir, "important.md"), originalContent);

    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    const content = fs.readFileSync(path.join(tmpDir, "important.md"), "utf-8");

    // Should contain all original content
    expect(content).toContain("# Important Notes");
    expect(content).toContain("- Item 1");
    expect(content).toContain("- Item 2");
    expect(content).toContain("## Section");
    expect(content).toContain("More stuff.");
  });

  it("updates existing frontmatter with adopted flag without losing fields", () => {
    fs.writeFileSync(
      path.join(tmpDir, "existing.md"),
      "---\ntitle: My Task\nstatus: in-progress\ntags:\n  - work\n---\n\n# My Task\nDescription here."
    );

    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    const content = fs.readFileSync(path.join(tmpDir, "existing.md"), "utf-8");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);

    expect(fmMatch).not.toBeNull();
    const fm = parseYaml(fmMatch![1]);

    // Original fields preserved
    expect(fm.title).toBe("My Task");
    expect(fm.status).toBe("in-progress");
    expect(fm.tags).toEqual(["work"]);
    // Adopted flag added
    expect(fm.adopted).toBe(true);
    // Body preserved
    expect(content).toContain("# My Task");
    expect(content).toContain("Description here.");
  });

  it("does not overwrite existing template files", () => {
    const existingWorkspaceMd = "---\nname: My Vault\npurpose: My stuff\n---\n\n# My Vault";
    fs.writeFileSync(path.join(tmpDir, "workspace.md"), existingWorkspaceMd);

    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    executeMigration(plan, {
      name: "New Name",
      purpose: "New Purpose",
      targetDir: tmpDir,
    });

    const content = fs.readFileSync(path.join(tmpDir, "workspace.md"), "utf-8");

    // Should still have the original content (with adopted flag added)
    expect(content).toContain("My Vault");
  });

  it("generates an index from adopted content", () => {
    fs.writeFileSync(path.join(tmpDir, "notes.md"), "# Notes\nSome notes.");
    fs.writeFileSync(
      path.join(tmpDir, "task-1.md"),
      "---\ntitle: Task One\nstatus: in-progress\n---\n\n# Task One"
    );

    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    const result = executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    // Index file should be created
    expect(fs.existsSync(path.join(tmpDir, "wiki", "index.md"))).toBe(true);
    const index = fs.readFileSync(path.join(tmpDir, "wiki", "index.md"), "utf-8");
    expect(index).toContain("notes.md");
    expect(index).toContain("task-1.md");
  });

  it("returns a result with all adopted files and created dirs/files", () => {
    fs.writeFileSync(path.join(tmpDir, "note.md"), "# A Note");

    const scan = scanExistingContent(tmpDir);
    const plan = buildMigrationPlan(scan);

    const result = executeMigration(plan, {
      name: "Test Workspace",
      purpose: "Testing",
      targetDir: tmpDir,
    });

    expect(result.workspacePath).toBe(tmpDir);
    expect(result.filesCreated.length).toBeGreaterThan(0);
    expect(result.dirsCreated.length).toBeGreaterThan(0);
    expect(result.filesAdopted).toContain("note.md");
  });
});
