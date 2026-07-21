import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseYaml } from "yaml";
import { createWorkspace } from "../lib/workspace.js";

describe("init — silent (default) workspace creation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-init-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readFrontmatter(wsDir: string): Record<string, unknown> {
    const content = fs.readFileSync(path.join(wsDir, "workspace.md"), "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return parseYaml(match![1]);
  }

  it("creates workspace.md with name, version, created — no purpose, no backends", async () => {
    const targetDir = path.join(tmpDir, "minimal");
    await createWorkspace({ name: "minimal-ws", targetDir });

    const fm = readFrontmatter(targetDir);
    expect(fm.name).toBe("minimal-ws");
    expect(fm.version).toBe("0.1.0");
    expect(fm.created).toBeTruthy();
    expect(fm).not.toHaveProperty("purpose");
    expect(fm).not.toHaveProperty("backends");
    expect(fm).not.toHaveProperty("ingest_scope");
  });

  it("does NOT create UBIQUITOUS_LANGUAGE.md, status-mapping.md, .env.example, or voice.md", async () => {
    const targetDir = path.join(tmpDir, "no-extras");
    await createWorkspace({ name: "no-extras", targetDir });

    expect(fs.existsSync(path.join(targetDir, "UBIQUITOUS_LANGUAGE.md"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, "wiki/status-mapping.md"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, ".env.example"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, ".claude/voice.md"))).toBe(false);
  });

  it("does NOT install /get-setup, /configure-status-mapping, or any /ingest-* skills", async () => {
    const targetDir = path.join(tmpDir, "no-backend-skills");
    await createWorkspace({ name: "no-backend-skills", targetDir });

    // Legacy /get-setup is fully retired — neither the old flat path nor the
    // new skill directory should appear.
    expect(fs.existsSync(path.join(targetDir, ".claude/commands/get-setup.md"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, ".claude/skills/get-setup"))).toBe(false);
    // Skills are plugin-resident in v3 — init never copies skills into the
    // vault, so backend ingest skills must not be present.
    for (const name of ["ingest-asana", "ingest-jira", "ingest-github"]) {
      expect(fs.existsSync(path.join(targetDir, ".claude/skills", name, "SKILL.md"))).toBe(false);
    }
  });

  it("AGENTS.md has a Connected integrations placeholder when no backends", async () => {
    const targetDir = path.join(tmpDir, "agents-md-placeholder");
    await createWorkspace({ name: "agents-md-placeholder", targetDir });

    const agentsMd = fs.readFileSync(path.join(targetDir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("## Connected integrations");
    expect(agentsMd).toContain("/connect");
    // No vocabulary file reference when none exists
    expect(agentsMd).not.toContain("Import and follow @UBIQUITOUS_LANGUAGE.md");
  });

  it("CLAUDE.md is a two-line shim importing AGENTS.md", async () => {
    const targetDir = path.join(tmpDir, "claude-md-shim");
    await createWorkspace({ name: "claude-md-shim", targetDir });

    const claudeMd = fs.readFileSync(path.join(targetDir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("@AGENTS.md");
    expect(claudeMd.trimEnd().split("\n")).toHaveLength(2);
  });

  it("creates the standard wiki subdirectories and references/", async () => {
    const targetDir = path.join(tmpDir, "dirs");
    await createWorkspace({ name: "dirs", targetDir });

    expect(fs.existsSync(path.join(targetDir, "wiki/daily"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "wiki/tasks"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "wiki/projects"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "wiki/meetings"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "wiki/spikes"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "wiki/weekly"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "wiki/repos"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "references"))).toBe(true);
  });

  it("refuses to overwrite a non-empty target directory", async () => {
    const targetDir = path.join(tmpDir, "occupied");
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(targetDir, "existing.md"), "hello", "utf-8");

    await expect(createWorkspace({ name: "x", targetDir })).rejects.toThrow(
      /already exists and is not empty/
    );
  });
});

// Note: the v2 test "installs /connect and the daily-workflow skills" was
// removed in the v3 port — createWorkspace no longer installs bundled skills,
// agents, or examples into the vault (skills are plugin-resident).
