import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../../package.json");
import { parse as parseYaml } from "yaml";

import { runCli, runCliFail } from "./harness.js";

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

    expect(output.trim()).toBe(PKG_VERSION);
  });

  describe("init --json (silent)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-cli-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates a minimal workspace and returns JSON (default {count, sample} envelopes)", () => {
      const target = path.join(tmpDir, "test-ws");
      const output = runCli(["--json", "init", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBe(target);
      // Default response is the {count, sample} envelope, not a full array.
      expect(typeof result.filesCreated.count).toBe("number");
      expect(Array.isArray(result.filesCreated.sample)).toBe(true);
      expect(result.filesCreated.sample.length).toBeLessThanOrEqual(result.filesCreated.count);
      expect(typeof result.dirsCreated.count).toBe("number");
      expect(Array.isArray(result.dirsCreated.sample)).toBe(true);
    });

    it("--verbose returns full filesCreated/dirsCreated arrays", () => {
      const target = path.join(tmpDir, "test-ws-verbose");
      const output = runCli(["--json", "--verbose", "init", target]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.filesCreated)).toBe(true);
      expect(result.filesCreated).toContain("workspace.md");
      expect(result.filesCreated).toContain("CLAUDE.md");
      // No UBIQUITOUS_LANGUAGE.md, no .env.example, no status-mapping.md, no voice.md
      expect(result.filesCreated).not.toContain("UBIQUITOUS_LANGUAGE.md");
      expect(result.filesCreated).not.toContain(".env.example");
      expect(result.filesCreated).not.toContain(".claude/voice.md");
      expect(Array.isArray(result.dirsCreated)).toBe(true);
      expect(result.dirsCreated).toContain("wiki/daily");
      expect(result.dirsCreated).toContain("wiki/tasks");
      expect(result.dirsCreated).toContain("wiki/projects");
      expect(result.dirsCreated).toContain("raw");
    });

    it("creates valid workspace.md with minimal YAML frontmatter (no purpose, no backends)", () => {
      const target = path.join(tmpDir, "yaml-test");
      runCli(["--json", "init", target]);

      const content = fs.readFileSync(path.join(target, "workspace.md"), "utf-8");
      expect(content).toMatch(/^---\n/);
      expect(content).toContain("name:");
      expect(content).toContain("version:");
      expect(content).not.toContain("purpose:");
      expect(content).not.toContain("backends:");

      const match = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = parseYaml(match![1]);
      expect(frontmatter.name).toBe("yaml-test");
      expect(frontmatter).not.toHaveProperty("purpose");
      expect(frontmatter).not.toHaveProperty("backends");
    });

    it("refuses to operate on a non-empty existing directory", () => {
      const target = path.join(tmpDir, "occupied");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "stuff.md"), "# Pre-existing");

      const { stdout, status } = runCliFail(["--json", "init", target]);
      expect(status).not.toBe(0);
      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/already exists and is not empty/);
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
      const { stdout, status } = runCliFail(["--json", "status"], tmpDir);
      expect(status).not.toBe(0);
      const output = JSON.parse(stdout);
      expect(output.success).toBe(false);
      expect(output.error).toMatch(/not inside a rubber-ducky workspace/i);
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
