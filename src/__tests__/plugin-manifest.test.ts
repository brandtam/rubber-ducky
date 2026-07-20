import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Structural checks for the Claude Code plugin skeleton — the wiring that
 * `claude plugin validate` (CI's validate-plugin job) cannot see: version
 * lockstep between plugin and package manifests, the hook actually pointing
 * at an executable script that exists, and the bin wrapper being present and
 * executable. These are file-state assertions, headless by construction.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");

function readJson(...segments: string[]): any {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ...segments), "utf-8"));
}

function isExecutable(...segments: string[]): boolean {
  const stat = fs.statSync(path.join(REPO_ROOT, ...segments));
  return (stat.mode & 0o111) !== 0;
}

describe("plugin manifest", () => {
  const plugin = readJson(".claude-plugin", "plugin.json");
  const pkg = readJson("package.json");

  it("has the kebab-case plugin name", () => {
    expect(plugin.name).toBe("rubber-ducky");
  });

  it("stays in version lockstep with package.json", () => {
    // The wrapper downloads release assets tagged v<plugin.json version>, and
    // release.yml tags come from package.json — if these diverge, installed
    // plugins fetch the wrong (or no) binary.
    expect(plugin.version).toBe(pkg.version);
  });

  it("registers hooks at the default plugin-root location", () => {
    expect(plugin.hooks).toBe("./hooks/hooks.json");
  });
});

describe("marketplace manifest", () => {
  const marketplace = readJson(".claude-plugin", "marketplace.json");
  const plugin = readJson(".claude-plugin", "plugin.json");

  it("serves the repo root as the plugin source", () => {
    expect(marketplace.name).toBe("rubber-ducky");
    expect(marketplace.owner?.name).toBeTruthy();
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].name).toBe(plugin.name);
    expect(marketplace.plugins[0].source).toBe("./");
  });

  it("leaves versioning to plugin.json (single source of truth)", () => {
    expect(marketplace.plugins[0].version).toBeUndefined();
  });
});

describe("hook wiring", () => {
  const hooks = readJson("hooks", "hooks.json");

  it("registers a SessionStart command hook", () => {
    const sessionStart = hooks.hooks?.SessionStart;
    expect(Array.isArray(sessionStart)).toBe(true);
    expect(sessionStart).toHaveLength(1);
    const commands = sessionStart[0].hooks;
    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe("command");
    expect(commands[0].command).toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  it("points at a pre-warm script that exists and is executable", () => {
    const command: string = hooks.hooks.SessionStart[0].hooks[0].command;
    // Resolve ${CLAUDE_PLUGIN_ROOT} to the repo root (the plugin root) and
    // strip the shell-form quoting to get the real path.
    const resolved = command.replaceAll('"', "").replace("${CLAUDE_PLUGIN_ROOT}", REPO_ROOT);
    expect(fs.existsSync(resolved)).toBe(true);
    expect((fs.statSync(resolved).mode & 0o111) !== 0).toBe(true);
  });
});

describe("bin wrapper", () => {
  it("is present, executable, and POSIX-sh (no Node/Bun dependency)", () => {
    expect(isExecutable("bin", "rubber-ducky")).toBe(true);
    const firstLine = fs
      .readFileSync(path.join(REPO_ROOT, "bin", "rubber-ducky"), "utf-8")
      .split("\n")[0];
    expect(firstLine).toBe("#!/bin/sh");
  });

  it("ships an executable pre-warm script", () => {
    expect(isExecutable("scripts", "prewarm.sh")).toBe(true);
    const firstLine = fs
      .readFileSync(path.join(REPO_ROOT, "scripts", "prewarm.sh"), "utf-8")
      .split("\n")[0];
    expect(firstLine).toBe("#!/bin/sh");
  });
});
