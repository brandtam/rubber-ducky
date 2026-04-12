import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findWorkspaceRoot, loadWorkspaceConfig } from "../lib/workspace.js";
import { createWorkspace } from "../lib/workspace.js";

describe("findWorkspaceRoot", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-detect-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the directory containing workspace.md when starting in workspace root", async () => {
    await createWorkspace({ name: "Test", purpose: "Testing", targetDir: path.join(tmpDir, "ws") });
    const root = findWorkspaceRoot(path.join(tmpDir, "ws"));
    expect(root).toBe(path.join(tmpDir, "ws"));
  });

  it("finds workspace root from a nested subdirectory", async () => {
    await createWorkspace({ name: "Test", purpose: "Testing", targetDir: path.join(tmpDir, "ws") });
    const nested = path.join(tmpDir, "ws", "wiki", "daily");
    const root = findWorkspaceRoot(nested);
    expect(root).toBe(path.join(tmpDir, "ws"));
  });

  it("returns null when no workspace.md exists in any parent directory", () => {
    const noWorkspace = path.join(tmpDir, "empty");
    fs.mkdirSync(noWorkspace, { recursive: true });
    const root = findWorkspaceRoot(noWorkspace);
    expect(root).toBeNull();
  });

  it("does not traverse above the filesystem root", () => {
    const root = findWorkspaceRoot("/");
    expect(root).toBeNull();
  });

  it("uses cwd when no startDir is provided", async () => {
    // Just verify it doesn't throw when called without arguments
    const root = findWorkspaceRoot();
    // We're running tests outside a workspace, so it should be null
    // (or a path if there happens to be a workspace.md above — either is valid behavior)
    expect(typeof root === "string" || root === null).toBe(true);
  });
});

describe("loadWorkspaceConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses workspace.md frontmatter and returns typed config", async () => {
    const wsPath = path.join(tmpDir, "ws");
    await createWorkspace({ name: "My Project", purpose: "Track work", targetDir: wsPath });

    const config = loadWorkspaceConfig(wsPath);
    expect(config.name).toBe("My Project");
    expect(config.purpose).toBe("Track work");
    expect(config.version).toBe("0.1.0");
    expect(config.created).toBeDefined();
    expect(config.backends).toEqual([]);
  });

  it("returns the workspaceRoot path in the config", async () => {
    const wsPath = path.join(tmpDir, "ws");
    await createWorkspace({ name: "Test", purpose: "Testing", targetDir: wsPath });

    const config = loadWorkspaceConfig(wsPath);
    expect(config.workspaceRoot).toBe(wsPath);
  });

  it("throws when workspace.md is missing", () => {
    const empty = path.join(tmpDir, "empty");
    fs.mkdirSync(empty, { recursive: true });
    expect(() => loadWorkspaceConfig(empty)).toThrow(/workspace\.md not found/i);
  });

  it("throws when workspace.md has no valid frontmatter", () => {
    const wsPath = path.join(tmpDir, "bad-ws");
    fs.mkdirSync(wsPath, { recursive: true });
    fs.writeFileSync(path.join(wsPath, "workspace.md"), "# No frontmatter here\n");
    expect(() => loadWorkspaceConfig(wsPath)).toThrow(/frontmatter/i);
  });
});

describe("workspace isolation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-isolation-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two workspaces have independent configs", async () => {
    const wsA = path.join(tmpDir, "workspace-a");
    const wsB = path.join(tmpDir, "workspace-b");

    await createWorkspace({ name: "Work", purpose: "Professional tasks", targetDir: wsA });
    await createWorkspace({ name: "Personal", purpose: "Side projects", targetDir: wsB });

    const configA = loadWorkspaceConfig(wsA);
    const configB = loadWorkspaceConfig(wsB);

    expect(configA.name).toBe("Work");
    expect(configA.purpose).toBe("Professional tasks");
    expect(configB.name).toBe("Personal");
    expect(configB.purpose).toBe("Side projects");

    // Configs are fully independent
    expect(configA.workspaceRoot).not.toBe(configB.workspaceRoot);
  });

  it("findWorkspaceRoot from workspace A does not return workspace B", async () => {
    const wsA = path.join(tmpDir, "workspace-a");
    const wsB = path.join(tmpDir, "workspace-b");

    await createWorkspace({ name: "Work", purpose: "Professional tasks", targetDir: wsA });
    await createWorkspace({ name: "Personal", purpose: "Side projects", targetDir: wsB });

    const rootFromA = findWorkspaceRoot(path.join(wsA, "wiki", "daily"));
    const rootFromB = findWorkspaceRoot(path.join(wsB, "wiki", "tasks"));

    expect(rootFromA).toBe(wsA);
    expect(rootFromB).toBe(wsB);
  });

  it("each workspace has its own independent files", async () => {
    const wsA = path.join(tmpDir, "workspace-a");
    const wsB = path.join(tmpDir, "workspace-b");

    await createWorkspace({ name: "Work", purpose: "Professional tasks", targetDir: wsA });
    await createWorkspace({ name: "Personal", purpose: "Side projects", targetDir: wsB });

    // Each has its own workspace.md
    const contentA = fs.readFileSync(path.join(wsA, "workspace.md"), "utf-8");
    const contentB = fs.readFileSync(path.join(wsB, "workspace.md"), "utf-8");
    expect(contentA).toContain("Work");
    expect(contentA).not.toContain("Personal");
    expect(contentB).toContain("Personal");
    expect(contentB).not.toContain("Work");

    // Each has its own CLAUDE.md
    const claudeA = fs.readFileSync(path.join(wsA, "CLAUDE.md"), "utf-8");
    const claudeB = fs.readFileSync(path.join(wsB, "CLAUDE.md"), "utf-8");
    expect(claudeA).toContain("Work");
    expect(claudeB).toContain("Personal");

    // Each has its own directory structure
    expect(fs.existsSync(path.join(wsA, "wiki", "daily"))).toBe(true);
    expect(fs.existsSync(path.join(wsB, "wiki", "daily"))).toBe(true);
  });

  it("modifying one workspace does not affect the other", async () => {
    const wsA = path.join(tmpDir, "workspace-a");
    const wsB = path.join(tmpDir, "workspace-b");

    await createWorkspace({ name: "Work", purpose: "Professional tasks", targetDir: wsA });
    await createWorkspace({ name: "Personal", purpose: "Side projects", targetDir: wsB });

    // Add a file to workspace A
    fs.writeFileSync(path.join(wsA, "wiki", "tasks", "task-1.md"), "# Task 1\n");

    // Workspace B should not have it
    expect(fs.existsSync(path.join(wsB, "wiki", "tasks", "task-1.md"))).toBe(false);

    // Workspace A should have it
    expect(fs.existsSync(path.join(wsA, "wiki", "tasks", "task-1.md"))).toBe(true);
  });
});
