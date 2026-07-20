import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runCli, runCliFail } from "./harness.js";

describe("CLI frontmatter commands", () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-fm-cli-test-"));
    testFile = path.join(tmpDir, "test.md");
    fs.writeFileSync(testFile, `---
title: Test Page
type: task
status: backlog
priority: high
tags:
  - frontend
  - urgent
created: "2026-01-15"
---

# Test Page

Some body content.
`, "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("frontmatter get", () => {
    it("reads all frontmatter fields as JSON", () => {
      const output = runCli(["--json", "frontmatter", "get", testFile]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.data.title).toBe("Test Page");
      expect(result.data.type).toBe("task");
      expect(result.data.status).toBe("backlog");
      expect(result.data.priority).toBe("high");
      expect(result.data.tags).toEqual(["frontend", "urgent"]);
    });

    it("reads a specific field as JSON", () => {
      const output = runCli(["--json", "frontmatter", "get", testFile, "status"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.field).toBe("status");
      expect(result.value).toBe("backlog");
    });

    it("returns error for nonexistent field", () => {
      const { stdout, status } = runCliFail(["--json", "frontmatter", "get", testFile, "nonexistent"]);
      const result = JSON.parse(stdout);

      expect(status).not.toBe(0);
      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent");
    });

    it("returns error for nonexistent file", () => {
      const { stdout, status } = runCliFail(["--json", "frontmatter", "get", path.join(tmpDir, "nope.md")]);
      const result = JSON.parse(stdout);

      expect(status).not.toBe(0);
      expect(result.success).toBe(false);
    });

    it("returns error for file without frontmatter", () => {
      const noFmFile = path.join(tmpDir, "nofm.md");
      fs.writeFileSync(noFmFile, "# Just markdown\n\nNo frontmatter here.\n", "utf-8");

      const { stdout, status } = runCliFail(["--json", "frontmatter", "get", noFmFile]);
      const result = JSON.parse(stdout);

      expect(status).not.toBe(0);
      expect(result.success).toBe(false);
    });
  });

  describe("frontmatter set", () => {
    it("sets a field value as JSON", () => {
      const output = runCli(["--json", "frontmatter", "set", testFile, "status", "done"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.field).toBe("status");
      expect(result.value).toBe("done");

      // Verify the file was actually updated
      const content = fs.readFileSync(testFile, "utf-8");
      expect(content).toContain("status: done");
    });

    it("preserves other fields when setting", () => {
      runCli(["--json", "frontmatter", "set", testFile, "status", "done"]);

      const content = fs.readFileSync(testFile, "utf-8");
      expect(content).toContain("title: Test Page");
      expect(content).toContain("priority: high");
      expect(content).toContain("Some body content.");
    });

    it("adds a new field", () => {
      const output = runCli(["--json", "frontmatter", "set", testFile, "assignee", "alice"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);

      const content = fs.readFileSync(testFile, "utf-8");
      expect(content).toContain("assignee: alice");
    });

    it("returns error for nonexistent file", () => {
      const { stdout, status } = runCliFail(["--json", "frontmatter", "set", path.join(tmpDir, "nope.md"), "status", "done"]);
      const result = JSON.parse(stdout);

      expect(status).not.toBe(0);
      expect(result.success).toBe(false);
    });
  });

  describe("frontmatter validate", () => {
    it("validates a valid task file", () => {
      const output = runCli(["--json", "frontmatter", "validate", testFile]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("reports validation errors for invalid file", () => {
      const invalidFile = path.join(tmpDir, "invalid.md");
      fs.writeFileSync(invalidFile, `---
title: Bad Task
type: task
---

# Bad Task
`, "utf-8");

      const { stdout, status } = runCliFail(["--json", "frontmatter", "validate", invalidFile]);
      const result = JSON.parse(stdout);

      expect(status).not.toBe(0);
      expect(result.success).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("validates against a specific page type with --type flag", () => {
      const dailyFile = path.join(tmpDir, "daily.md");
      fs.writeFileSync(dailyFile, `---
title: "2026-01-15"
type: daily
created: "2026-01-15"
---

# Daily Log
`, "utf-8");

      const output = runCli(["--json", "frontmatter", "validate", dailyFile, "--type", "daily"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.valid).toBe(true);
    });

    it("returns error for nonexistent file", () => {
      const { stdout, status } = runCliFail(["--json", "frontmatter", "validate", path.join(tmpDir, "nope.md")]);
      const result = JSON.parse(stdout);

      expect(status).not.toBe(0);
      expect(result.success).toBe(false);
    });
  });

  describe("human-readable output", () => {
    it("frontmatter get shows human-readable output without --json", () => {
      const output = runCli(["frontmatter", "get", testFile]);

      // Should contain field names and values in human-readable form
      expect(output).toContain("title");
      expect(output).toContain("Test Page");
    });

    it("frontmatter set shows human-readable confirmation", () => {
      const output = runCli(["frontmatter", "set", testFile, "status", "done"]);

      expect(output).toContain("status");
      expect(output).toContain("done");
    });

    it("frontmatter validate shows human-readable result", () => {
      const output = runCli(["frontmatter", "validate", testFile]);

      // Valid file should show success message
      expect(output.toLowerCase()).toMatch(/valid|pass|ok|no errors/i);
    });
  });

  describe("frontmatter array add", () => {
    let projectFile: string;

    beforeEach(() => {
      projectFile = path.join(tmpDir, "project.md");
      fs.writeFileSync(projectFile, `---
title: Test Project
type: project
created: "2026-05-09"
status: backlog
---

## Description
`, "utf-8");
    });

    it("creates the field when it doesn't exist", () => {
      const output = runCli(["--json", "frontmatter", "array", "add", projectFile, "data_sources", "mercury"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.values).toEqual(["mercury"]);
      expect(result.noop).toBe(false);
    });

    it("appends to an existing array", () => {
      runCli(["frontmatter", "array", "add", projectFile, "data_sources", "mercury"]);
      const output = runCli(["--json", "frontmatter", "array", "add", projectFile, "data_sources", "plaid"]);
      const result = JSON.parse(output);

      expect(result.values).toEqual(["mercury", "plaid"]);
    });

    it("is idempotent (unique by default)", () => {
      runCli(["frontmatter", "array", "add", projectFile, "data_sources", "mercury"]);
      const output = runCli(["--json", "frontmatter", "array", "add", projectFile, "data_sources", "mercury"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
      expect(result.values).toEqual(["mercury"]);
    });

    it("--allow-duplicates appends anyway", () => {
      runCli(["frontmatter", "array", "add", projectFile, "data_sources", "mercury"]);
      const output = runCli([
        "--json",
        "frontmatter",
        "array",
        "add",
        projectFile,
        "data_sources",
        "mercury",
        "--allow-duplicates",
      ]);
      const result = JSON.parse(output);

      expect(result.values).toEqual(["mercury", "mercury"]);
      expect(result.noop).toBe(false);
    });

    it("returns InvalidInput when the field is a scalar", () => {
      const { stdout, status } = runCliFail([
        "--json",
        "frontmatter",
        "array",
        "add",
        projectFile,
        "status",
        "anything",
      ]);
      const result = JSON.parse(stdout);

      expect(status).toBe(2);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not an array/);
    });

    it("returns NotFound for nonexistent file", () => {
      const { status } = runCliFail([
        "--json",
        "frontmatter",
        "array",
        "add",
        path.join(tmpDir, "nope.md"),
        "data_sources",
        "x",
      ]);
      expect(status).toBe(3);
    });
  });

  describe("frontmatter array remove", () => {
    let projectFile: string;

    beforeEach(() => {
      projectFile = path.join(tmpDir, "project.md");
      fs.writeFileSync(projectFile, `---
title: Test Project
type: project
created: "2026-05-09"
data_sources:
  - mercury
  - plaid
---
`, "utf-8");
    });

    it("removes the value", () => {
      const output = runCli(["--json", "frontmatter", "array", "remove", projectFile, "data_sources", "mercury"]);
      const result = JSON.parse(output);

      expect(result.values).toEqual(["plaid"]);
      expect(result.noop).toBe(false);
    });

    it("is a no-op when the value isn't present", () => {
      const output = runCli(["--json", "frontmatter", "array", "remove", projectFile, "data_sources", "stripe"]);
      const result = JSON.parse(output);

      expect(result.success).toBe(true);
      expect(result.noop).toBe(true);
      expect(result.values).toEqual(["mercury", "plaid"]);
    });

    it("leaves the field as [] when last value removed", () => {
      runCli(["frontmatter", "array", "remove", projectFile, "data_sources", "mercury"]);
      const output = runCli(["--json", "frontmatter", "array", "remove", projectFile, "data_sources", "plaid"]);
      const result = JSON.parse(output);

      expect(result.values).toEqual([]);
    });
  });

  describe("frontmatter array set", () => {
    let projectFile: string;

    beforeEach(() => {
      projectFile = path.join(tmpDir, "project.md");
      fs.writeFileSync(projectFile, `---
title: Test Project
type: project
created: "2026-05-09"
data_sources:
  - mercury
---
`, "utf-8");
    });

    it("replaces the array with the given values", () => {
      const output = runCli([
        "--json",
        "frontmatter",
        "array",
        "set",
        projectFile,
        "data_sources",
        "stripe",
        "hubspot",
      ]);
      const result = JSON.parse(output);

      expect(result.values).toEqual(["stripe", "hubspot"]);
    });

    it("sets the field to [] when no values are passed", () => {
      runCli(["frontmatter", "array", "set", projectFile, "data_sources"]);
      const reread = fs.readFileSync(projectFile, "utf-8");
      const out = runCli(["--json", "frontmatter", "get", projectFile, "data_sources"]);
      const result = JSON.parse(out);
      expect(result.value).toEqual([]);
      // Field is preserved, body unchanged
      expect(reread).toContain("data_sources:");
    });
  });
});
