import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { findJiraCandidates, type JiraCandidate } from "../lib/triage-candidates.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function seedVault(root: string): void {
  fs.mkdirSync(path.join(root, "wiki", "tasks"), { recursive: true });
}

function writeTaskPage(
  root: string,
  filename: string,
  opts: {
    source: string;
    status?: string;
    jira_ref?: string | null;
    jira_needed?: string | null;
    description?: string;
    comments?: string;
    activityLog?: string;
  }
): void {
  const fm: Record<string, unknown> = {
    title: "Task",
    type: "task",
    ref: opts.source === "asana" ? "https://app.asana.com/0/proj/123" : `WEB-${filename.replace(/\.md$/, "")}`,
    source: opts.source,
    status: opts.status ?? "backlog",
    priority: null,
    assignee: null,
    tags: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    closed: null,
    pushed: null,
    due: null,
    jira_ref: opts.jira_ref ?? null,
    asana_ref: opts.source === "asana" ? "https://app.asana.com/0/proj/123" : null,
    gh_ref: null,
    jira_needed: opts.jira_needed ?? null,
    asana_status_raw: null,
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

  const prefix = opts.source === "asana" ? "Asana" : "Jira";
  const body = [
    `## ${prefix} description`,
    "",
    opts.description ?? "",
    "",
    `## ${prefix} comments`,
    "",
    opts.comments ?? "",
    "",
    "## Activity log",
    "",
    opts.activityLog ?? "",
    "",
    "## See also",
    "",
  ].join("\n");

  fs.writeFileSync(
    path.join(root, "wiki", "tasks", filename),
    `---\n${yaml}\n---\n${body}`
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-cand-"));
  seedVault(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findJiraCandidates", () => {
  it("finds a WEB-NNN mention in the Asana description", () => {
    writeTaskPage(tmpDir, "ECOMM-100.md", {
      source: "asana",
      description: "This relates to WEB-297 in Jira.",
    });
    writeTaskPage(tmpDir, "WEB-297.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-100.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].jiraKey).toBe("WEB-297");
    expect(candidates[0].location).toBe("description");
  });

  it("finds a WEB-NNN mention in the Asana comments section", () => {
    writeTaskPage(tmpDir, "ECOMM-200.md", {
      source: "asana",
      comments: "Comment referencing WEB-501.",
    });
    writeTaskPage(tmpDir, "WEB-501.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-200.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].jiraKey).toBe("WEB-501");
    expect(candidates[0].location).toBe("comments");
  });

  it("finds a WEB-NNN mention in the activity log", () => {
    writeTaskPage(tmpDir, "ECOMM-300.md", {
      source: "asana",
      activityLog: "- 2026-01-01 — Linked WEB-42 manually",
    });
    writeTaskPage(tmpDir, "WEB-42.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-300.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].jiraKey).toBe("WEB-42");
    expect(candidates[0].location).toBe("activity log");
  });

  it("returns multiple candidates when several Jira keys are mentioned", () => {
    writeTaskPage(tmpDir, "ECOMM-400.md", {
      source: "asana",
      description: "See WEB-10 and WEB-20 for context.",
    });
    writeTaskPage(tmpDir, "WEB-10.md", { source: "jira" });
    writeTaskPage(tmpDir, "WEB-20.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-400.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(2);
    const keys = candidates.map((c) => c.jiraKey).sort();
    expect(keys).toEqual(["WEB-10", "WEB-20"]);
  });

  it("excludes Jira keys not present in the vault", () => {
    writeTaskPage(tmpDir, "ECOMM-500.md", {
      source: "asana",
      description: "Mentions WEB-999 which does not exist in vault.",
    });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-500.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(0);
  });

  it("deduplicates the same key mentioned in multiple sections", () => {
    writeTaskPage(tmpDir, "ECOMM-600.md", {
      source: "asana",
      description: "Related to WEB-77.",
      comments: "Also mentions WEB-77.",
      activityLog: "- WEB-77 linked",
    });
    writeTaskPage(tmpDir, "WEB-77.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-600.md"),
      tmpDir
    );

    // One candidate, but the location should reflect the first/best mention
    expect(candidates).toHaveLength(1);
    expect(candidates[0].jiraKey).toBe("WEB-77");
    // description is the highest-priority location
    expect(candidates[0].location).toBe("description");
  });

  it("handles case-insensitive Jira key matching (web-123 → WEB-123)", () => {
    writeTaskPage(tmpDir, "ECOMM-700.md", {
      source: "asana",
      description: "See web-123 for details.",
    });
    writeTaskPage(tmpDir, "WEB-123.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-700.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].jiraKey).toBe("WEB-123");
  });

  it("returns empty array when the page body has no WEB-NNN mentions", () => {
    writeTaskPage(tmpDir, "ECOMM-800.md", {
      source: "asana",
      description: "No Jira mentions here.",
    });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-800.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(0);
  });

  it("matches keys with different project prefixes present in vault", () => {
    writeTaskPage(tmpDir, "ECOMM-900.md", {
      source: "asana",
      description: "See PROJ-55 for details.",
    });
    writeTaskPage(tmpDir, "PROJ-55.md", { source: "jira" });

    const candidates = findJiraCandidates(
      path.join(tmpDir, "wiki", "tasks", "ECOMM-900.md"),
      tmpDir
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].jiraKey).toBe("PROJ-55");
  });
});
