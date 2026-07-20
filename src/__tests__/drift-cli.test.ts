import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliFail } from "./harness.js";

/**
 * CLI-integration suite for `rubber-ducky drift`. Asserts external behavior
 * only: the exact typed JSON disagreement reports and the typed exit codes
 * (0 no drift, 7 drift found, 2 invalid payload, 3 page problems).
 */
describe("CLI drift command", () => {
  let tmpDir: string;
  let pageFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-drift-cli-test-"));
    pageFile = path.join(tmpDir, "task.md");
    fs.writeFileSync(pageFile, `---
title: Fix login flow
type: task
status: in-progress
priority: high
tags:
  - auth
  - frontend
created: "2026-01-15"
---

# Fix login flow

Body content.
`, "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function incomingFile(payload: unknown): string {
    const file = path.join(tmpDir, "incoming.json");
    fs.writeFileSync(file, JSON.stringify(payload), "utf-8");
    return file;
  }

  describe("no drift", () => {
    it("exits 0 with an exact empty report (stdin payload)", () => {
      const stdout = runCli(
        ["--json", "drift", pageFile],
        tmpDir,
        JSON.stringify({ status: "in-progress", priority: "high", tags: ["auth", "frontend"] }),
      );
      expect(JSON.parse(stdout)).toEqual({
        success: true,
        drift: false,
        page: pageFile,
        compared: ["priority", "status", "tags"],
        disagreements: [],
      });
    });

    it("exits 0 with an empty report via --incoming file", () => {
      const file = incomingFile({ status: "in-progress" });
      const stdout = runCli(["--json", "drift", pageFile, "--incoming", file], tmpDir);
      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.drift).toBe(false);
      expect(result.disagreements).toEqual([]);
    });

    it("an empty payload object is vacuously in sync", () => {
      const stdout = runCli(["--json", "drift", pageFile], tmpDir, "{}");
      expect(JSON.parse(stdout)).toEqual({
        success: true,
        drift: false,
        page: pageFile,
        compared: [],
        disagreements: [],
      });
    });
  });

  describe("partial disagreement", () => {
    it("exits 7 with the exact typed report", () => {
      const { stdout, status } = runCliFail(
        ["--json", "drift", pageFile],
        tmpDir,
        JSON.stringify({ status: "done", priority: "high", assignee: "alice" }),
      );
      expect(status).toBe(7);
      expect(JSON.parse(stdout)).toEqual({
        success: false,
        drift: true,
        page: pageFile,
        compared: ["assignee", "priority", "status"],
        disagreements: [
          { field: "assignee", kind: "missing", incoming: "alice" },
          { field: "status", kind: "mismatch", wiki: "in-progress", incoming: "done" },
        ],
      });
    });
  });

  describe("full disagreement", () => {
    it("exits 7 reporting every compared field", () => {
      const { stdout, status } = runCliFail(
        ["--json", "drift", pageFile],
        tmpDir,
        JSON.stringify({ status: "done", priority: "low", tags: ["backend"] }),
      );
      expect(status).toBe(7);
      expect(JSON.parse(stdout)).toEqual({
        success: false,
        drift: true,
        page: pageFile,
        compared: ["priority", "status", "tags"],
        disagreements: [
          { field: "priority", kind: "mismatch", wiki: "high", incoming: "low" },
          { field: "status", kind: "mismatch", wiki: "in-progress", incoming: "done" },
          { field: "tags", kind: "mismatch", wiki: ["auth", "frontend"], incoming: ["backend"] },
        ],
      });
    });
  });

  describe("invalid input", () => {
    it("malformed JSON on stdin exits 2 with a useful message", () => {
      const { stdout, status } = runCliFail(["--json", "drift", pageFile], tmpDir, "{not json");
      expect(status).toBe(2);
      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not valid JSON");
    });

    it("empty stdin exits 2", () => {
      const { status, stdout } = runCliFail(["--json", "drift", pageFile], tmpDir, "");
      expect(status).toBe(2);
      expect(JSON.parse(stdout).success).toBe(false);
    });

    it("a non-object payload (array) exits 2 with a useful message", () => {
      const { stdout, status } = runCliFail(["--json", "drift", pageFile], tmpDir, "[1,2]");
      expect(status).toBe(2);
      expect(JSON.parse(stdout).error).toContain("must be a JSON object");
    });

    it("malformed JSON in --incoming file exits 2", () => {
      const file = path.join(tmpDir, "bad.json");
      fs.writeFileSync(file, "oops", "utf-8");
      const { status } = runCliFail(["--json", "drift", pageFile, "--incoming", file], tmpDir);
      expect(status).toBe(2);
    });
  });

  describe("not found", () => {
    it("missing page exits 3", () => {
      const { stdout, status } = runCliFail(
        ["--json", "drift", path.join(tmpDir, "nope.md")],
        tmpDir,
        '{"status": "done"}',
      );
      expect(status).toBe(3);
      expect(JSON.parse(stdout).error).toContain("not found");
    });

    it("page without frontmatter exits 3", () => {
      const noFm = path.join(tmpDir, "nofm.md");
      fs.writeFileSync(noFm, "# Just markdown\n", "utf-8");
      const { stdout, status } = runCliFail(["--json", "drift", noFm], tmpDir, '{"status": "done"}');
      expect(status).toBe(3);
      expect(JSON.parse(stdout).error).toContain("No frontmatter");
    });

    it("missing --incoming file exits 3", () => {
      const { status } = runCliFail(
        ["--json", "drift", pageFile, "--incoming", path.join(tmpDir, "nope.json")],
        tmpDir,
      );
      expect(status).toBe(3);
    });
  });

  describe("determinism", () => {
    it("same inputs produce byte-identical reports across runs and key orders", () => {
      const a = runCliFail(["--json", "drift", pageFile], tmpDir, '{"status":"done","priority":"low"}');
      const b = runCliFail(["--json", "drift", pageFile], tmpDir, '{"priority":"low","status":"done"}');
      expect(a.status).toBe(7);
      expect(b.status).toBe(7);
      expect(a.stdout).toBe(b.stdout);
    });
  });
});
