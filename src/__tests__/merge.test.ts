import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  runMerge,
  type MergeOptions,
  type MergeResult,
} from "../lib/merge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedWorkspace(root: string): void {
  fs.mkdirSync(path.join(root, "wiki", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki", "daily"), { recursive: true });
  fs.mkdirSync(path.join(root, "wiki", "projects"), { recursive: true });

  fs.writeFileSync(
    path.join(root, "workspace.md"),
    [
      "---",
      "name: Test",
      "purpose: Testing",
      'version: "0.5.0"',
      'created: "2026-01-01"',
      "backends:",
      "  - type: asana",
      '    workspace_id: "123"',
      '    identifier_field: "ECOMM ID"',
      "  - type: jira",
      '    server_url: "https://jira.example.com"',
      '    project_key: "WEB"',
      "---",
      "# Test Workspace",
    ].join("\n")
  );
}

function writeAsanaPage(
  root: string,
  filename: string,
  opts: {
    ref?: string;
    asana_ref?: string;
    jira_ref?: string | null;
    status?: string;
    priority?: string | null;
    assignee?: string | null;
    title?: string;
    description?: string;
    comments?: string;
    tags?: string[];
    asana_status_raw?: string | null;
    activityLog?: string;
    seeAlso?: string;
    attachments?: string;
  }
): void {
  const fm: Record<string, unknown> = {
    title: opts.title ?? "Asana Task",
    type: "task",
    ref: opts.ref ?? "https://app.asana.com/0/proj/123",
    source: "asana",
    status: opts.status ?? "backlog",
    priority: opts.priority ?? null,
    assignee: opts.assignee ?? null,
    tags: opts.tags ?? [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: opts.jira_ref ?? null,
    asana_ref: opts.asana_ref ?? "https://app.asana.com/0/proj/123",
    gh_ref: null,
    jira_needed: null,
    asana_status_raw: opts.asana_status_raw ?? null,
    jira_status_raw: null,
    comment_count: 0,
  };

  const yaml = Object.entries(fm)
    .map(([k, v]) => {
      if (v === null) return `${k}: null`;
      if (Array.isArray(v))
        return v.length === 0
          ? `${k}: []`
          : `${k}:\n${v.map((t) => `  - "${t}"`).join("\n")}`;
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${v}`;
    })
    .join("\n");

  const bodyParts = [
    "## Asana description",
    "",
    opts.description ?? "Asana description content",
    "",
    "## Asana comments",
    "",
    opts.comments ?? "",
    "",
  ];

  if (opts.attachments) {
    bodyParts.push("## Attachments", "", opts.attachments, "");
  }

  bodyParts.push(
    "## Activity log",
    "",
    opts.activityLog ?? "- 2026-01-01T00:00:00.000Z \u2014 Ingested from asana (ECOMM-3585)",
    "",
    "## See also",
    "",
    opts.seeAlso ?? "",
    ""
  );

  fs.writeFileSync(
    path.join(root, "wiki", "tasks", filename),
    `---\n${yaml}\n---\n${bodyParts.join("\n")}`
  );
}

function writeJiraPage(
  root: string,
  filename: string,
  opts: {
    ref?: string;
    jira_ref?: string;
    status?: string;
    priority?: string | null;
    assignee?: string | null;
    title?: string;
    description?: string;
    comments?: string;
    tags?: string[];
    jira_status_raw?: string | null;
    activityLog?: string;
    seeAlso?: string;
    attachments?: string;
  }
): void {
  const fm: Record<string, unknown> = {
    title: opts.title ?? "Jira Task",
    type: "task",
    ref: opts.ref ?? "WEB-297",
    source: "jira",
    status: opts.status ?? "backlog",
    priority: opts.priority ?? null,
    assignee: opts.assignee ?? null,
    tags: opts.tags ?? [],
    created: "2026-01-02T00:00:00.000Z",
    updated: "2026-01-02T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: opts.jira_ref ?? "https://jira.example.com/browse/WEB-297",
    asana_ref: null,
    gh_ref: null,
    jira_needed: null,
    asana_status_raw: null,
    jira_status_raw: opts.jira_status_raw ?? null,
    comment_count: 0,
  };

  const yaml = Object.entries(fm)
    .map(([k, v]) => {
      if (v === null) return `${k}: null`;
      if (Array.isArray(v))
        return v.length === 0
          ? `${k}: []`
          : `${k}:\n${v.map((t) => `  - "${t}"`).join("\n")}`;
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${v}`;
    })
    .join("\n");

  const bodyParts = [
    "## Jira description",
    "",
    opts.description ?? "Jira description content",
    "",
    "## Jira comments",
    "",
    opts.comments ?? "",
    "",
  ];

  if (opts.attachments) {
    bodyParts.push("## Attachments", "", opts.attachments, "");
  }

  bodyParts.push(
    "## Activity log",
    "",
    opts.activityLog ?? "- 2026-01-02T00:00:00.000Z \u2014 Ingested from jira (WEB-297)",
    "",
    "## See also",
    "",
    opts.seeAlso ?? "",
    ""
  );

  fs.writeFileSync(
    path.join(root, "wiki", "tasks", filename),
    `---\n${yaml}\n---\n${bodyParts.join("\n")}`
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runMerge", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-ducky-merge-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates merged page with correct filename ECOMM-XXXX (WEB-NNN).md", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {
      ref: "https://app.asana.com/0/proj/3585",
      asana_ref: "https://app.asana.com/0/proj/3585",
    });
    writeJiraPage(tmpDir, "WEB-297.md", {
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
    });

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(true);
    expect(result.mergedFilename).toBe("ECOMM-3585 (WEB-297).md");
    expect(
      fs.existsSync(
        path.join(tmpDir, "wiki", "tasks", "ECOMM-3585 (WEB-297).md")
      )
    ).toBe(true);
  });

  it("deletes the orphan Jira page after merge", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {});
    writeJiraPage(tmpDir, "WEB-297.md", {});

    runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))
    ).toBe(false);
  });

  it("deletes the original Asana page after merge (replaced by merged page)", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {});
    writeJiraPage(tmpDir, "WEB-297.md", {});

    runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    // Original is gone — merged file has the new name
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-3585.md"))
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(tmpDir, "wiki", "tasks", "ECOMM-3585 (WEB-297).md")
      )
    ).toBe(true);
  });

  it("merged page retains source: asana, ref from Asana, jira_ref populated", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {
      ref: "https://app.asana.com/0/proj/3585",
      asana_ref: "https://app.asana.com/0/proj/3585",
    });
    writeJiraPage(tmpDir, "WEB-297.md", {
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
    });

    runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    const merged = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-3585 (WEB-297).md"),
      "utf-8"
    );
    expect(merged).toContain("source: asana");
    expect(merged).toContain("asana_ref:");
    expect(merged).toContain("jira_ref:");
    expect(merged).toMatch(/jira_needed: "?yes"?/);
  });

  it("rewrites [[WEB-NNN]] wikilinks across the vault to [[ECOMM-XXXX (WEB-NNN)]]", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {});
    writeJiraPage(tmpDir, "WEB-297.md", {});

    // Daily page references the Jira key
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-04-01.md"),
      "---\ntitle: 2026-04-01\ntype: daily\n---\n## Work log\n- Worked on [[WEB-297]] today\n"
    );

    // Project page references both
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "projects", "launch.md"),
      "---\ntitle: Launch\ntype: project\n---\n## Tasks\n- [[ECOMM-3585]]\n- [[WEB-297]]\n"
    );

    runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    const daily = fs.readFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-04-01.md"),
      "utf-8"
    );
    expect(daily).toContain("[[ECOMM-3585 (WEB-297)]]");
    expect(daily).not.toContain("[[WEB-297]]");

    const project = fs.readFileSync(
      path.join(tmpDir, "wiki", "projects", "launch.md"),
      "utf-8"
    );
    expect(project).toContain("[[ECOMM-3585 (WEB-297)]]");
    // Both old refs should be rewritten
    expect(project).not.toMatch(/\[\[WEB-297\]\]/);
    expect(project).not.toMatch(/\[\[ECOMM-3585\]\](?! \()/);
  });

  it("appends merge operation to wiki/log.md", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {});
    writeJiraPage(tmpDir, "WEB-297.md", {});

    runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    const log = fs.readFileSync(
      path.join(tmpDir, "wiki", "log.md"),
      "utf-8"
    );
    expect(log).toContain("Merged ECOMM-3585 + WEB-297");
  });

  it("returns conflicts when status differs and no resolution provided", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", { status: "in-progress" });
    writeJiraPage(tmpDir, "WEB-297.md", { status: "done" });

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.conflicts!.length).toBeGreaterThanOrEqual(1);
    expect(result.conflicts!.find((c) => c.field === "status")).toBeDefined();
  });

  it("succeeds when conflicts exist but resolutions are provided", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", { status: "in-progress" });
    writeJiraPage(tmpDir, "WEB-297.md", { status: "done" });

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
      resolutions: { status: "done" },
    });

    expect(result.success).toBe(true);
    expect(result.conflicts).toBeUndefined();

    const merged = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-3585 (WEB-297).md"),
      "utf-8"
    );
    expect(merged).toContain("status: done");
  });

  it("fails when Asana page not found", () => {
    seedWorkspace(tmpDir);
    writeJiraPage(tmpDir, "WEB-297.md", {});

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECOMM-3585");
  });

  it("fails when Jira page not found", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {});

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("WEB-297");
  });

  it("fails many-to-one: Jira key already linked to another ECOMM page", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {});
    writeAsanaPage(tmpDir, "ECOMM-1000.md", {
      ref: "https://app.asana.com/0/proj/1000",
      asana_ref: "https://app.asana.com/0/proj/1000",
      jira_ref: "https://jira.example.com/browse/WEB-297",
    });
    writeJiraPage(tmpDir, "WEB-297.md", {});

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECOMM-1000");
    expect(result.error).toContain("WEB-297");
  });

  it("merged page body has all backend-scoped sections", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {
      description: "Feature description from Asana",
      comments: "**Alice** \u2014 2026-01-01:\nGreat work!",
    });
    writeJiraPage(tmpDir, "WEB-297.md", {
      description: "Bug fix from Jira",
      comments: "**Bob** \u2014 2026-01-02:\nShipped it!",
    });

    runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    const merged = fs.readFileSync(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-3585 (WEB-297).md"),
      "utf-8"
    );

    expect(merged).toContain("## Asana description");
    expect(merged).toContain("Feature description from Asana");
    expect(merged).toContain("## Jira description");
    expect(merged).toContain("Bug fix from Jira");
    expect(merged).toContain("## Asana comments");
    expect(merged).toContain("Great work!");
    expect(merged).toContain("## Jira comments");
    expect(merged).toContain("Shipped it!");
    expect(merged).toContain("## Activity log");
    expect(merged).toContain("## See also");
  });

  it("returns writeActions for back-link comments in Asana and Jira", () => {
    seedWorkspace(tmpDir);
    writeAsanaPage(tmpDir, "ECOMM-3585.md", {
      ref: "https://app.asana.com/0/proj/3585",
      asana_ref: "https://app.asana.com/0/proj/3585",
    });
    writeJiraPage(tmpDir, "WEB-297.md", {
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
    });

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(true);
    expect(result.writeActions).toBeDefined();
    expect(result.writeActions).toHaveLength(2);

    const asanaWrite = result.writeActions!.find(
      (w) => w.backend === "asana"
    );
    const jiraWrite = result.writeActions!.find(
      (w) => w.backend === "jira"
    );

    expect(asanaWrite).toBeDefined();
    expect(asanaWrite!.action).toBe("comment");
    expect(jiraWrite).toBeDefined();
    expect(jiraWrite!.action).toBe("comment");
  });

  it("integration: full merge with filesystem assertions", () => {
    seedWorkspace(tmpDir);

    writeAsanaPage(tmpDir, "ECOMM-3585.md", {
      ref: "https://app.asana.com/0/proj/3585",
      asana_ref: "https://app.asana.com/0/proj/3585",
      title: "Implement dark mode",
      description: "Add dark mode to the app",
      comments:
        "**Alice** \u2014 2026-01-01T10:00:00.000Z:\nLooking great!",
      status: "in-progress",
      asana_status_raw: "In Progress",
      tags: ["frontend"],
      seeAlso: "- [[project-alpha]]",
    });

    writeJiraPage(tmpDir, "WEB-297.md", {
      ref: "WEB-297",
      jira_ref: "https://jira.example.com/browse/WEB-297",
      title: "Dark mode bug",
      description: "Fix dark mode rendering",
      comments:
        "**Bob** \u2014 2026-01-02T10:00:00.000Z:\nFixed in v2",
      status: "in-progress",
      jira_status_raw: "In Progress",
      tags: ["bug"],
      seeAlso: "- [[sprint-review]]",
    });

    // References scattered across vault
    fs.writeFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-04-01.md"),
      "---\ntitle: 2026-04-01\ntype: daily\n---\n## Work log\n- [[WEB-297]] fix deployed\n- Also [[ECOMM-3585|dark mode]]\n"
    );

    const result = runMerge({
      asanaRef: "ECOMM-3585",
      jiraRef: "WEB-297",
      workspaceRoot: tmpDir,
    });

    expect(result.success).toBe(true);

    // Merged file exists
    const mergedPath = path.join(
      tmpDir,
      "wiki",
      "tasks",
      "ECOMM-3585 (WEB-297).md"
    );
    expect(fs.existsSync(mergedPath)).toBe(true);

    // Orphans gone
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-3585.md"))
    ).toBe(false);

    // Content
    const merged = fs.readFileSync(mergedPath, "utf-8");
    expect(merged).toContain("source: asana");
    expect(merged).toContain("Add dark mode to the app");
    expect(merged).toContain("Fix dark mode rendering");
    expect(merged).toContain("Looking great!");
    expect(merged).toContain("Fixed in v2");
    expect(merged).toContain("## Asana description");
    expect(merged).toContain("## Jira description");
    expect(merged).toContain("[[project-alpha]]");
    expect(merged).toContain("[[sprint-review]]");

    // Wikilinks rewritten
    const daily = fs.readFileSync(
      path.join(tmpDir, "wiki", "daily", "2026-04-01.md"),
      "utf-8"
    );
    expect(daily).toContain("[[ECOMM-3585 (WEB-297)]]");
    expect(daily).toContain("[[ECOMM-3585 (WEB-297)|dark mode]]");
    expect(daily).not.toMatch(/\[\[WEB-297\]\]/);

    // Log entry
    const log = fs.readFileSync(
      path.join(tmpDir, "wiki", "log.md"),
      "utf-8"
    );
    expect(log).toContain("Merged ECOMM-3585 + WEB-297");
  });
});
