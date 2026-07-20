import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliFail } from "./harness.js";

/**
 * CLI-surface tests for the settings and context commands. These are the
 * integration boundary every skill consumes from — exit codes, JSON
 * envelopes, and audit-log side effects are part of the public contract,
 * so they get covered here even though their internals are unit-tested
 * elsewhere.
 */

describe("settings CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-settings-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("get with no path returns the full settings object", () => {
    const out = JSON.parse(runCli(["--json", "settings", "get"], tmpDir));
    expect(out.success).toBe(true);
    expect(out.value.ingest).toBeDefined();
    expect(out.value.ingest.auto_on_wrap_up).toBe(false);
  });

  it("get with a dotted path returns just that value", () => {
    const out = JSON.parse(
      runCli(["--json", "settings", "get", "ingest.auto_on_wrap_up"], tmpDir),
    );
    expect(out.path).toBe("ingest.auto_on_wrap_up");
    expect(out.value).toBe(false);
  });

  it("enable flips the boolean to true and writes the file", () => {
    const out = JSON.parse(
      runCli(["--json", "settings", "enable", "ingest.auto_on_wrap_up"], tmpDir),
    );
    expect(out.previous).toBe(false);
    expect(out.next).toBe(true);
    const after = JSON.parse(
      runCli(["--json", "settings", "get", "ingest.auto_on_wrap_up"], tmpDir),
    );
    expect(after.value).toBe(true);
  });

  it("audit-logs every mutation to wiki/log.md", () => {
    runCli(["--json", "settings", "enable", "ingest.auto_on_wrap_up"], tmpDir);
    const log = fs.readFileSync(path.join(tmpDir, "wiki", "log.md"), "utf-8");
    expect(log).toContain("[settings] enable ingest.auto_on_wrap_up");
  });

  it("set rejects an unknown path with exit code 2", () => {
    const result = runCliFail(
      ["--json", "settings", "set", "telemetry.enabled", "true"],
      tmpDir,
    );
    expect(result.status).toBe(2);
  });

  it("set accepts a JSON literal argument", () => {
    runCli(
      ["--json", "settings", "set", "ingest.kinds", '["voice"]'],
      tmpDir,
    );
    const after = JSON.parse(
      runCli(["--json", "settings", "get", "ingest.kinds"], tmpDir),
    );
    expect(after.value).toEqual(["voice"]);
  });

  it("set preserves JSONC comments in the file after editing", () => {
    runCli(
      ["--json", "settings", "set", "confirm.jira.comment", '"auto"'],
      tmpDir,
    );
    const raw = fs.readFileSync(path.join(tmpDir, "settings.json"), "utf-8");
    expect(raw).toContain("// settings.json");
    expect(raw).toContain("Per-action confirmation policy");
  });

  it("set ingest.kinds accepts variadic positionals (no JSON quoting needed)", () => {
    runCli(
      ["--json", "settings", "set", "ingest.kinds", "voice", "vocabulary"],
      tmpDir,
    );
    const after = JSON.parse(
      runCli(["--json", "settings", "get", "ingest.kinds"], tmpDir),
    );
    expect(after.value).toEqual(["voice", "vocabulary"]);
  });

  it("enable rejects a non-boolean leaf with a clear error and exit 2", () => {
    const result = runCliFail(
      ["--json", "settings", "enable", "ingest.kinds"],
      tmpDir,
    );
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(
      /not a boolean setting|settings set ingest\.kinds/i,
    );
  });

  it("enable supports onboard.completed (first-run marker)", () => {
    const enabled = JSON.parse(
      runCli(
        ["--json", "settings", "enable", "onboard.completed"],
        tmpDir,
      ),
    );
    expect(enabled.next).toBe(true);
    const after = JSON.parse(
      runCli(["--json", "settings", "get", "onboard.completed"], tmpDir),
    );
    expect(after.value).toBe(true);
  });

  it("fails outside a workspace with exit code 3", () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), "rd-orphan-"));
    try {
      const result = runCliFail(
        ["--json", "settings", "get", "ingest.auto_on_wrap_up"],
        orphan,
      );
      expect(result.status).toBe(3);
    } finally {
      fs.rmSync(orphan, { recursive: true, force: true });
    }
  });
});

describe("context CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-context-cli-"));
    runCli(["--json", "init", tmpDir]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init scaffolds the four context pages", () => {
    for (const kind of ["voice", "about", "vocabulary", "preferences"]) {
      expect(fs.existsSync(path.join(tmpDir, "wiki", `${kind}.md`))).toBe(true);
    }
  });

  it("query returns each kind's sections as a JSON envelope", () => {
    const out = JSON.parse(
      runCli(["--json", "context", "query", "voice"], tmpDir),
    );
    expect(out.success).toBe(true);
    expect(out.kind).toBe("voice");
    expect(out.present).toBe(true);
    expect(out.sections).toBeDefined();
    expect(out.sections.Samples).toBeDefined();
  });

  it("query rejects an unknown kind with exit code 2", () => {
    const result = runCliFail(
      ["--json", "context", "query", "telepathy"],
      tmpDir,
    );
    expect(result.status).toBe(2);
  });
});
