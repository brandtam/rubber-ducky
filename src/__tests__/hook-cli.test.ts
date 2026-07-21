import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliFail } from "./harness.js";
import { WRITE_PATTERNS_RELPATH } from "../lib/confirm-gate.js";

/**
 * CLI-surface tests for `rubber-ducky hook pre-tool-use` — the confirm gate
 * the plugin registers as its PreToolUse hook. The contract under test is
 * exactly what Claude Code sees: synthetic PreToolUse payloads on stdin,
 * decision JSON (or nothing) on stdout, and exit code 0 in every case —
 * the gate never uses exit 2; fail-open means silence, not error.
 */

describe("hook pre-tool-use CLI (confirm gate)", () => {
  let vault: string;

  const payload = (command: string, overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({
      session_id: "test-session",
      transcript_path: "/dev/null",
      hook_event_name: "PreToolUse",
      cwd: vault,
      tool_name: "Bash",
      tool_input: { command },
      ...overrides,
    });

  const gate = (input: string) =>
    runCliFail(["hook", "pre-tool-use"], vault, input);

  const decisionOf = (stdout: string) =>
    JSON.parse(stdout).hookSpecificOutput;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "rd-hook-cli-"));
    runCli(["--json", "init", vault]);
    fs.writeFileSync(
      path.join(vault, WRITE_PATTERNS_RELPATH),
      "# registered by /connect\ngithub.comment gh issue comment *\n",
    );
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("allows a registered write whose policy is auto", () => {
    runCli(["--json", "settings", "set", "confirm.github.comment", "auto"], vault);
    const result = gate(payload("gh issue comment 7 --body hi"));
    expect(result.status).toBe(0);
    const decision = decisionOf(result.stdout);
    expect(decision.hookEventName).toBe("PreToolUse");
    expect(decision.permissionDecision).toBe("allow");
  });

  it("blocks a registered write pending confirmation when policy is manual", () => {
    runCli(["--json", "settings", "set", "confirm.github.comment", "manual"], vault);
    const result = gate(payload("gh issue comment 7 --body hi"));
    expect(result.status).toBe(0);
    const decision = decisionOf(result.stdout);
    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toContain("manual");
  });

  it("asks with a command preview when policy is preview (also the default)", () => {
    // No explicit setting: registered writes default to preview.
    const result = gate(payload("gh issue comment 7 --body hi"));
    expect(result.status).toBe(0);
    const decision = decisionOf(result.stdout);
    expect(decision.permissionDecision).toBe("ask");
    expect(decision.permissionDecisionReason).toContain("gh issue comment 7 --body hi");
  });

  it("passes an unregistered command through untouched (no output, exit 0)", () => {
    const result = gate(payload("ls -la"));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("passes through on a malformed payload (fail-open, exit 0)", () => {
    const result = gate("this is not json");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("passes through for non-Bash tools", () => {
    const result = gate(
      payload("irrelevant", { tool_name: "Edit", tool_input: { file_path: "/x" } }),
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("passes through when cwd is outside any workspace", () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "rd-hook-orphan-"));
    try {
      const result = gate(payload("gh issue comment 7", { cwd: orphan }));
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    } finally {
      fs.rmSync(orphan, { recursive: true, force: true });
    }
  });

  it("passes through when no patterns file has been registered", () => {
    fs.rmSync(path.join(vault, WRITE_PATTERNS_RELPATH));
    const result = gate(payload("gh issue comment 7"));
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("is hidden from --help (machine-facing verb)", () => {
    const help = runCli(["--help"], vault);
    expect(help).not.toContain("pre-tool-use");
  });
});

describe("confirm settings via the settings verbs", () => {
  let vault: string;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "rd-confirm-settings-"));
    runCli(["--json", "init", vault]);
  });

  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("accepts all three policies and round-trips them", () => {
    for (const policy of ["auto", "manual", "preview"]) {
      runCli(["--json", "settings", "set", "confirm.github.comment", policy], vault);
      const got = JSON.parse(
        runCli(["--json", "settings", "get", "confirm.github.comment"], vault),
      );
      expect(got.value).toBe(policy);
    }
  });

  it("rejects an unknown policy with exit 2 and names the valid set", () => {
    const result = runCliFail(
      ["--json", "settings", "set", "confirm.github.comment", "yolo"],
      vault,
    );
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toContain("auto, manual, preview");
  });

  it("audit-logs confirm policy changes to wiki/log.md", () => {
    runCli(["--json", "settings", "set", "confirm.github.comment", "manual"], vault);
    const log = fs.readFileSync(path.join(vault, "wiki", "log.md"), "utf-8");
    expect(log).toContain("[settings] set confirm.github.comment");
    expect(log).toContain('"manual"');
  });
});
