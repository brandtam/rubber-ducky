import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter, setFrontmatterField } from "../lib/frontmatter.js";
import { loadWorkspaceConfig } from "../lib/workspace.js";
import { writeFileAtomic } from "../lib/fs-atomic.js";
import { isValidIsoDate } from "../lib/dates.js";
import { resolveInsideWorkspace, PathOutsideWorkspaceError } from "../lib/paths.js";
import { slugify, generateTaskPage, EmptySlugError } from "../lib/page.js";
import { ExitCode } from "../lib/output.js";
import { runCli, runCliFail } from "./harness.js";

describe("frontmatter parser line-anchoring", () => {
  it("does not truncate frontmatter at a --- inside a YAML value", () => {
    const content = `---
title: a---
status: backlog
---

Body here.
`;
    const parsed = parseFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.data.title).toBe("a---");
    expect(parsed!.data.status).toBe("backlog");
    expect(parsed!.body).toContain("Body here.");
  });

  it("round-trips a --- value through setFrontmatterField without corruption", () => {
    const content = `---
title: a---
---

Body.
`;
    const updated = setFrontmatterField(content, "status", "done");
    const parsed = parseFrontmatter(updated);
    expect(parsed!.data.title).toBe("a---");
    expect(parsed!.data.status).toBe("done");
    expect(parsed!.body).toContain("Body.");
  });

  it("still parses empty frontmatter", () => {
    const parsed = parseFrontmatter("---\n---\n\nBody only.\n");
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!.data)).toHaveLength(0);
  });

  it("does not treat an indented --- as the closing delimiter", () => {
    const content = `---
title: Test
note: |
  ---
  block content
---
`;
    const parsed = parseFrontmatter(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.data.title).toBe("Test");
    expect(String(parsed!.data.note)).toContain("---");
  });
});

describe("loadWorkspaceConfig uses the shared parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-durability-ws-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses workspace.md whose values contain ---", () => {
    fs.writeFileSync(
      path.join(tmpDir, "workspace.md"),
      `---\nname: my---vault\nversion: "3.0"\ncreated: "2026-01-01"\n---\n\n# Workspace\n`,
      "utf-8"
    );
    const config = loadWorkspaceConfig(tmpDir);
    expect(config.name).toBe("my---vault");
    expect(config.version).toBe("3.0");
  });

  it("throws on workspace.md without frontmatter", () => {
    fs.writeFileSync(path.join(tmpDir, "workspace.md"), "# No frontmatter\n", "utf-8");
    expect(() => loadWorkspaceConfig(tmpDir)).toThrow(/no YAML frontmatter/);
  });
});

describe("isValidIsoDate", () => {
  const valid = ["2026-01-01", "2024-02-29", "1999-12-31"];
  const invalid = [
    "2026-02-30", // not a real day
    "2026-13-01", // month 13
    "2026-00-10", // month 00
    "2026-01-00", // day 00
    "2023-02-29", // non-leap year
    "26-01-01",
    "2026/01/01",
    "2026-1-1",
    "../../etc",
    "2026-01-01x",
    "",
  ];

  for (const value of valid) {
    it(`accepts ${value}`, () => {
      expect(isValidIsoDate(value)).toBe(true);
    });
  }

  for (const value of invalid) {
    it(`rejects "${value}"`, () => {
      expect(isValidIsoDate(value)).toBe(false);
    });
  }
});

describe("resolveInsideWorkspace", () => {
  const root = "/tmp/fake-workspace";

  it("resolves a normal relative path", () => {
    expect(resolveInsideWorkspace(root, "wiki/tasks/a.md")).toBe(
      path.join(root, "wiki/tasks/a.md")
    );
  });

  it("rejects ../ escapes", () => {
    expect(() => resolveInsideWorkspace(root, "../../outside.md")).toThrow(
      PathOutsideWorkspaceError
    );
  });

  it("rejects absolute paths outside the root", () => {
    expect(() => resolveInsideWorkspace(root, "/etc/passwd")).toThrow(
      PathOutsideWorkspaceError
    );
  });
});

describe("writeFileAtomic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-atomic-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes content and leaves no temp files behind", () => {
    const target = path.join(tmpDir, "sub", "file.md");
    writeFileAtomic(target, "hello\n");
    expect(fs.readFileSync(target, "utf-8")).toBe("hello\n");
    const entries = fs.readdirSync(path.dirname(target));
    expect(entries).toEqual(["file.md"]);
  });

  it("replaces existing content", () => {
    const target = path.join(tmpDir, "file.md");
    writeFileAtomic(target, "one");
    writeFileAtomic(target, "two");
    expect(fs.readFileSync(target, "utf-8")).toBe("two");
  });
});

describe("slug guard", () => {
  it("slugify still returns empty string for symbol-only input", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("generateTaskPage throws EmptySlugError for symbol-only titles", () => {
    expect(() => generateTaskPage("!!!")).toThrow(EmptySlugError);
  });

  it("generateTaskPage throws EmptySlugError for non-ASCII titles", () => {
    expect(() => generateTaskPage("日本語")).toThrow(EmptySlugError);
  });
});

describe("CLI durability rejections", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-durability-cli-"));
    runCli(["--json", "init", tmpDir]);
    runCli(["--json", "page", "create", "task", "Fix bug"], tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("task start rejects a malformed --date with InvalidInput", () => {
    const { stdout, status } = runCliFail(
      ["--json", "task", "start", "wiki/tasks/fix-bug.md", "--date", "not-a-date"],
      tmpDir
    );
    expect(status).toBe(ExitCode.InvalidInput);
    const result = JSON.parse(stdout);
    expect(result.success).toBe(false);
    expect(result.error).toContain("--date");
  });

  it("task close rejects an impossible calendar date with InvalidInput", () => {
    const { status } = runCliFail(
      ["--json", "task", "close", "wiki/tasks/fix-bug.md", "--date", "2026-02-30"],
      tmpDir
    );
    expect(status).toBe(ExitCode.InvalidInput);
  });

  it("page create daily rejects a malformed date with InvalidInput", () => {
    const { status } = runCliFail(
      ["--json", "page", "create", "daily", "2026-99-99"],
      tmpDir
    );
    expect(status).toBe(ExitCode.InvalidInput);
  });

  it("page create weekly rejects a malformed --date with a clear error", () => {
    const { stdout, status } = runCliFail(
      ["--json", "page", "create", "weekly", "--date", "garbage"],
      tmpDir
    );
    expect(status).toBe(ExitCode.InvalidInput);
    const result = JSON.parse(stdout);
    expect(result.error).toContain("YYYY-MM-DD");
  });

  it("task start rejects a path escaping the workspace with InvalidInput", () => {
    const { stdout, status } = runCliFail(
      ["--json", "task", "start", "../../outside.md"],
      tmpDir
    );
    expect(status).toBe(ExitCode.InvalidInput);
    const result = JSON.parse(stdout);
    expect(result.error).toContain("escapes the workspace");
  });

  it("page create task rejects a symbol-only title with InvalidInput", () => {
    const { stdout, status } = runCliFail(
      ["--json", "page", "create", "task", "!!!"],
      tmpDir
    );
    expect(status).toBe(ExitCode.InvalidInput);
    const result = JSON.parse(stdout);
    expect(result.error).toContain("slug");
  });

  it("frontmatter set rejects an out-of-vault file when run inside a workspace", () => {
    const outside = path.join(os.tmpdir(), `rd-outside-${process.pid}.md`);
    fs.writeFileSync(outside, "---\ntitle: X\n---\n", "utf-8");
    try {
      const { status } = runCliFail(
        ["--json", "frontmatter", "set", outside, "title", "Y"],
        tmpDir
      );
      expect(status).toBe(ExitCode.InvalidInput);
      // Untouched:
      expect(fs.readFileSync(outside, "utf-8")).toContain("title: X");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("frontmatter set on an out-of-vault file works with --outside-vault", () => {
    const outside = path.join(os.tmpdir(), `rd-outside2-${process.pid}.md`);
    fs.writeFileSync(outside, "---\ntitle: X\n---\n", "utf-8");
    try {
      const output = runCli(
        ["--json", "frontmatter", "set", outside, "title", "Y", "--outside-vault"],
        tmpDir
      );
      expect(JSON.parse(output).success).toBe(true);
      expect(fs.readFileSync(outside, "utf-8")).toContain("title: Y");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("frontmatter set inside the vault still works without flags", () => {
    const output = runCli(
      ["--json", "frontmatter", "set", "wiki/tasks/fix-bug.md", "priority", "high"],
      tmpDir
    );
    expect(JSON.parse(output).success).toBe(true);
  });
});
