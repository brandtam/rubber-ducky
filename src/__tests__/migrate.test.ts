import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runMigrate, type MigrateResult } from "../lib/migrate.js";

/**
 * Helper: seed a minimal workspace structure with workspace.md containing
 * backend config, plus task pages in old format.
 */
function seedWorkspace(
  root: string,
  opts?: {
    backends?: Array<{ type: string; [k: string]: unknown }>;
  }
): void {
  const backends = opts?.backends ?? [
    { type: "asana", workspace_id: "123", identifier_field: "ECOMM ID" },
    { type: "jira", server_url: "https://jira.example.com", project_key: "WEB" },
  ];

  fs.mkdirSync(path.join(root, "wiki", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki", "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki", "projects"), { recursive: true });

  // workspace.md with backend config
  const backendsYaml = backends
    .map((b) => {
      const entries = Object.entries(b)
        .map(([k, v]) => `    ${k}: ${typeof v === "string" ? `"${v}"` : v}`)
        .join("\n");
      return `  - ${entries.replace(/^    /, "")}`;
    })
    .join("\n");

  fs.writeFileSync(
    path.join(root, "workspace.md"),
    `---\nname: Test\npurpose: Testing\nversion: "0.5.0"\ncreated: "2026-01-01"\nbackends:\n${backendsYaml}\n---\n# Test Workspace\n`
  );
}

/** Write a task page in the old format (lowercase filename, generic headers). */
function writeOldTaskPage(
  root: string,
  filename: string,
  opts: {
    source: string;
    ref?: string;
    asana_ref?: string | null;
    jira_ref?: string | null;
    description?: string;
    comments?: string;
  }
): void {
  const fm: Record<string, unknown> = {
    title: opts.ref ?? filename.replace(".md", ""),
    type: "task",
    ref: opts.ref ?? null,
    source: opts.source,
    status: "backlog",
    priority: null,
    assignee: null,
    tags: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: opts.jira_ref ?? null,
    asana_ref: opts.asana_ref ?? null,
    gh_ref: null,
    comment_count: 0,
  };

  const yaml = Object.entries(fm)
    .map(([k, v]) => {
      if (v === null) return `${k}: null`;
      if (Array.isArray(v)) return `${k}: []`;
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${v}`;
    })
    .join("\n");

  const body = [
    `## Description`,
    "",
    opts.description ?? "Task description here.",
    "",
    `## Comments`,
    "",
    opts.comments ?? "",
    "",
    "## Activity log",
    "",
    "## See also",
    "",
  ].join("\n");

  fs.writeFileSync(
    path.join(root, "wiki", "tasks", filename),
    `---\n${yaml}\n---\n${body}`
  );
}

describe("runMigrate", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-migrate-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renames lowercase Asana task files to uppercase", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "ecomm-123.md", {
      source: "asana",
      ref: "https://app.asana.com/0/123/456",
      asana_ref: "https://app.asana.com/0/123/456",
    });

    const result = runMigrate(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ecomm-123.md"))).toBe(false);
    expect(result.filesRenamed).toBe(1);
  });

  it("renames lowercase Jira task files to uppercase", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "web-297.md", {
      source: "jira",
      ref: "WEB-297",
      jira_ref: "WEB-297",
    });

    const result = runMigrate(tmpDir);

    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "web-297.md"))).toBe(false);
    expect(result.filesRenamed).toBe(1);
  });

  it("rewrites generic section headers to backend-scoped (Asana)", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "ecomm-123.md", {
      source: "asana",
      asana_ref: "https://app.asana.com/0/123/456",
    });

    runMigrate(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md"),
      "utf-8"
    );
    expect(content).toContain("## Asana description");
    expect(content).toContain("## Asana comments");
    expect(content).not.toMatch(/^## Description$/m);
    expect(content).not.toMatch(/^## Comments$/m);
  });

  it("rewrites generic section headers to backend-scoped (Jira)", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "web-297.md", {
      source: "jira",
      jira_ref: "WEB-297",
    });

    runMigrate(tmpDir);

    const content = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "WEB-297.md"),
      "utf-8"
    );
    expect(content).toContain("## Jira description");
    expect(content).toContain("## Jira comments");
    expect(content).not.toMatch(/^## Description$/m);
    expect(content).not.toMatch(/^## Comments$/m);
  });

  it("rewrites wikilinks across the vault after renaming", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "ecomm-123.md", {
      source: "asana",
      asana_ref: "https://app.asana.com/0/123/456",
    });

    // Daily page referencing old name
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-01-01.md"),
      "---\ntitle: 2026-01-01\ntype: daily\n---\n## Work log\n- Worked on [[ecomm-123]]\n"
    );

    runMigrate(tmpDir);

    const daily = fs.readFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-01-01.md"),
      "utf-8"
    );
    expect(daily).toContain("[[ECOMM-123]]");
    expect(daily).not.toContain("[[ecomm-123]]");
  });

  it("is idempotent — second run is a no-op", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "ecomm-123.md", {
      source: "asana",
      asana_ref: "https://app.asana.com/0/123/456",
    });
    writeOldTaskPage(tmpDir, "web-297.md", {
      source: "jira",
      jira_ref: "WEB-297",
    });

    const first = runMigrate(tmpDir);
    expect(first.filesRenamed).toBe(2);
    expect(first.headersRewritten).toBe(2);

    // Second run
    const second = runMigrate(tmpDir);
    expect(second.filesRenamed).toBe(0);
    expect(second.headersRewritten).toBe(0);
    expect(second.alreadyMigrated).toBe(true);
  });

  it("skips title-based filenames (not identifier-based)", () => {
    seedWorkspace(tmpDir);
    // A manually-created task page with a title slug
    const filename = "implement-dark-mode.md";
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", filename),
      `---\ntitle: "Implement dark mode"\ntype: task\nsource: null\nstatus: backlog\n---\n## Description\n\n## Comments\n`
    );

    const result = runMigrate(tmpDir);

    // Should NOT rename title-based filenames
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", filename))).toBe(true);
    expect(result.filesRenamed).toBe(0);
  });

  it("handles already-uppercase files without renaming", () => {
    seedWorkspace(tmpDir);
    // Already in uppercase (new format)
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md"),
      `---\ntitle: "ECOMM-123"\ntype: task\nsource: asana\nstatus: backlog\nasana_ref: "https://app.asana.com/0/123/456"\n---\n## Asana description\n\n## Asana comments\n`
    );

    const result = runMigrate(tmpDir);

    expect(result.filesRenamed).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md"))).toBe(true);
  });

  it("migrates multiple files in one run", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "ecomm-100.md", {
      source: "asana",
      asana_ref: "https://app.asana.com/0/123/100",
    });
    writeOldTaskPage(tmpDir, "ecomm-200.md", {
      source: "asana",
      asana_ref: "https://app.asana.com/0/123/200",
    });
    writeOldTaskPage(tmpDir, "web-10.md", {
      source: "jira",
      jira_ref: "WEB-10",
    });

    const result = runMigrate(tmpDir);

    expect(result.filesRenamed).toBe(3);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-100.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-200.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-10.md"))).toBe(true);
  });

  it("does not rewrite headers that are already backend-scoped", () => {
    seedWorkspace(tmpDir);
    // A lowercase file but already has backend-scoped headers
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "ecomm-123.md"),
      `---\ntitle: "ECOMM-123"\ntype: task\nsource: asana\nstatus: backlog\nasana_ref: "https://app.asana.com/0/123/456"\n---\n## Asana description\n\nSome content\n\n## Asana comments\n\n## Activity log\n`
    );

    const result = runMigrate(tmpDir);

    // File should still be renamed (uppercase)
    expect(result.filesRenamed).toBe(1);
    // Headers should NOT be rewritten (already correct)
    expect(result.headersRewritten).toBe(0);

    const content = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-123.md"),
      "utf-8"
    );
    expect(content).toContain("## Asana description");
    expect(content).toContain("## Asana comments");
  });

  it("does not touch GitHub-sourced pages", () => {
    seedWorkspace(tmpDir, {
      backends: [{ type: "github", repos: ["owner/repo"] }],
    });
    // GitHub pages use title-based naming, not identifier-based
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "tasks", "fix-login-bug.md"),
      `---\ntitle: "Fix login bug"\ntype: task\nsource: github\nstatus: backlog\ngh_ref: "https://github.com/owner/repo/issues/1"\n---\n## Description\n\n## Comments\n`
    );

    const result = runMigrate(tmpDir);

    expect(result.filesRenamed).toBe(0);
    // GitHub pages don't get backend-scoped headers (no convention defined)
    expect(result.headersRewritten).toBe(0);
  });

  it("returns a summary with rename details", () => {
    seedWorkspace(tmpDir);
    writeOldTaskPage(tmpDir, "ecomm-123.md", {
      source: "asana",
      asana_ref: "https://app.asana.com/0/123/456",
    });

    const result = runMigrate(tmpDir);

    expect(result.filesRenamed).toBe(1);
    expect(result.headersRewritten).toBe(1);
    expect(result.wikilinksRewritten).toBeGreaterThanOrEqual(0);
    expect(result.alreadyMigrated).toBe(false);
    expect(result.renames).toEqual([
      { from: "ecomm-123.md", to: "ECOMM-123.md" },
    ]);
  });

  it("handles empty tasks directory gracefully", () => {
    seedWorkspace(tmpDir);
    // Tasks dir exists but is empty

    const result = runMigrate(tmpDir);

    expect(result.filesRenamed).toBe(0);
    expect(result.headersRewritten).toBe(0);
    expect(result.alreadyMigrated).toBe(true);
  });

  it("integration: seeds vault in old format, runs migrate, asserts final state", () => {
    seedWorkspace(tmpDir);

    // Old-format Asana page
    writeOldTaskPage(tmpDir, "ecomm-3585.md", {
      source: "asana",
      ref: "https://app.asana.com/0/proj/3585",
      asana_ref: "https://app.asana.com/0/proj/3585",
      description: "Implement feature X",
      comments: "- Comment from team",
    });

    // Old-format Jira page
    writeOldTaskPage(tmpDir, "web-297.md", {
      source: "jira",
      ref: "WEB-297",
      jira_ref: "WEB-297",
      description: "Bug fix for login",
      comments: "- Jira comment",
    });

    // Daily page with wikilinks to both
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-04-01.md"),
      [
        "---",
        "title: 2026-04-01",
        "type: daily",
        "---",
        "## Work log",
        "- Worked on [[ecomm-3585]] and [[web-297]]",
        "- Also mentioned [[ecomm-3585|ECOMM ticket]] in passing",
        "",
      ].join("\n")
    );

    // Project page with a wikilink
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "projects", "q2-launch.md"),
      [
        "---",
        "title: Q2 Launch",
        "type: project",
        "---",
        "## Tasks",
        "- [[ecomm-3585]]",
        "- [[web-297]]",
        "",
      ].join("\n")
    );

    // --- Run migration ---
    const result = runMigrate(tmpDir);

    // Assertions: files renamed
    expect(result.filesRenamed).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-3585.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ecomm-3585.md"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "wiki", "tasks", "web-297.md"))).toBe(false);

    // Assertions: headers rewritten
    const asanaContent = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-3585.md"),
      "utf-8"
    );
    expect(asanaContent).toContain("## Asana description");
    expect(asanaContent).toContain("## Asana comments");
    expect(asanaContent).toContain("Implement feature X");
    expect(asanaContent).toContain("- Comment from team");

    const jiraContent = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "WEB-297.md"),
      "utf-8"
    );
    expect(jiraContent).toContain("## Jira description");
    expect(jiraContent).toContain("## Jira comments");
    expect(jiraContent).toContain("Bug fix for login");
    expect(jiraContent).toContain("- Jira comment");

    // Assertions: wikilinks rewritten
    const daily = fs.readFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-04-01.md"),
      "utf-8"
    );
    expect(daily).toContain("[[ECOMM-3585]]");
    expect(daily).toContain("[[WEB-297]]");
    expect(daily).toContain("[[ECOMM-3585|ECOMM ticket]]");
    expect(daily).not.toContain("[[ecomm-3585]]");
    expect(daily).not.toContain("[[web-297]]");

    const project = fs.readFileSync(
      path.join(tmpDir, "wiki", "projects", "q2-launch.md"),
      "utf-8"
    );
    expect(project).toContain("[[ECOMM-3585]]");
    expect(project).toContain("[[WEB-297]]");

    // Assertions: idempotent
    const second = runMigrate(tmpDir);
    expect(second.filesRenamed).toBe(0);
    expect(second.headersRewritten).toBe(0);
    expect(second.alreadyMigrated).toBe(true);
  });
});
