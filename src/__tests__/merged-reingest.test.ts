/**
 * Integration test: seed a merged vault, re-run ingest on both backends,
 * assert only the appropriate sections changed. (Issue #89)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parseFrontmatter } from "../lib/frontmatter.js";
import { ingestJiraIssue } from "../lib/jira-ingest.js";
import { ingestAsanaTask } from "../lib/asana-ingest.js";
import type { JiraClient, JiraIssue } from "../lib/jira-client.js";
import type { AsanaClient } from "../lib/asana-client.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function setupWorkspace(tmpDir: string): void {
  fs.mkdirSync(path.join(tmpDir, "wiki", "daily"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "wiki", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "wiki", "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, "workspace.md"),
    "---\nname: test\npurpose: testing\nversion: 0.1.0\ncreated: 2024-01-01\nbackends: []\n---\n"
  );
}

/** Seed a realistic merged page produced by `rubber-ducky merge`. */
function seedMergedVault(tmpDir: string): void {
  const mergedPage = [
    "---",
    "title: Fix checkout flow",
    "type: task",
    "ref: ECOMM-4643",
    "source: asana",
    "status: in-progress",
    "priority: High",
    "assignee: Alice Smith",
    "tags:",
    "  - bug",
    "  - checkout",
    "created: 2024-01-10T00:00:00.000Z",
    "updated: 2024-01-16T12:00:00.000Z",
    "closed: null",
    "pushed: null",
    "due: 2024-02-15",
    "jira_ref: https://myorg.atlassian.net/browse/WEB-297",
    "asana_ref: https://app.asana.com/0/project/1234567890",
    "gh_ref: null",
    "jira_needed: yes",
    "comment_count: 3",
    "asana_status_raw: In Progress",
    "jira_status_raw: To Do",
    "---",
    "## Asana description",
    "",
    "Asana description: the checkout form crashes on mobile.",
    "",
    "## Jira description",
    "",
    "Jira description: checkout crash on iOS 17.",
    "",
    "## Asana comments",
    "",
    "**Alice** (2024-01-11T10:00:00.000Z)",
    "",
    "I can reproduce on iPhone 15.",
    "",
    "**Bob** (2024-01-12T10:00:00.000Z)",
    "",
    "Same on iPad.",
    "",
    "## Jira comments",
    "",
    "**Charlie** (2024-01-13T10:00:00.000Z)",
    "",
    "Fix deployed to staging.",
    "",
    "## Attachments",
    "",
    "![crash.png](../../raw/assets/ECOMM-4643/crash.png)",
    "",
    "## Activity log",
    "",
    "- 2024-01-10T00:00:00.000Z — Ingested from Asana (ECOMM-4643)",
    "- 2024-01-13T00:00:00.000Z — Ingested from Jira (WEB-297)",
    "- 2024-01-16T00:00:00.000Z — Merged ECOMM-4643 + WEB-297",
    "",
    "## See also",
    "",
    "- [[Daily 2024-01-10]]",
    "",
  ].join("\n");

  fs.writeFileSync(
    path.join(tmpDir, "wiki", "tasks", "ECOMM-4643 (WEB-297).md"),
    mergedPage
  );

  // Also seed a wikilink reference in a daily page
  fs.writeFileSync(
    path.join(tmpDir, "wiki", "daily", "2024-01-10.md"),
    [
      "---",
      "title: 2024-01-10",
      "type: daily",
      "created: 2024-01-10",
      "---",
      "",
      "Worked on [[ECOMM-4643 (WEB-297)]] today.",
    ].join("\n")
  );
}

// ---------------------------------------------------------------------------
// Integration test
// ---------------------------------------------------------------------------

describe("merged vault re-ingest integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "rubber-ducky-merged-reingest-integration-")
    );
    setupWorkspace(tmpDir);
    seedMergedVault(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("re-ingests both backends on a merged page with correct isolation", async () => {
    // ---- Step 1: Re-ingest Jira side (WEB-297) ----
    const jiraIssue: JiraIssue = {
      key: "WEB-297",
      fields: {
        summary: "Fix checkout flow",
        description: "UPDATED Jira: checkout crash fixed in build 42",
        status: { name: "Done" },
        priority: { name: "High" },
        assignee: { displayName: "Alice Smith" },
        labels: ["bug", "checkout"],
        created: "2024-01-13T00:00:00.000+0000",
        updated: "2024-01-20T00:00:00.000+0000",
        resolutiondate: "2024-01-20T00:00:00.000+0000",
        duedate: "2024-02-15",
        attachment: [],
      },
    } as JiraIssue;

    const jiraClient: JiraClient = {
      getMyself: async () => ({
        displayName: "Test User",
        emailAddress: "test@example.com",
      }),
      getIssue: async () => jiraIssue,
      getComments: async () => [
        {
          id: "30001",
          body: "Verified fix on production",
          author: { displayName: "Dave" },
          created: "2024-01-21T10:00:00.000+0000",
        },
      ],
      searchIssues: async () => ({ issues: [jiraIssue] }),
    } as JiraClient;

    const jiraResult = await ingestJiraIssue({
      client: jiraClient,
      ref: "WEB-297",
      workspaceRoot: tmpDir,
      serverUrl: "https://myorg.atlassian.net",
    });

    expect(jiraResult.success).toBe(true);
    expect(jiraResult.skipped).toBe(false);
    expect(jiraResult.filePath).toContain("ECOMM-4643 (WEB-297).md");

    // Read after Jira re-ingest
    const afterJira = fs.readFileSync(
      path.join(tmpDir, jiraResult.filePath!),
      "utf-8"
    );
    const parsedAfterJira = parseFrontmatter(afterJira);
    const fmJira = parsedAfterJira!.data;
    const bodyJira = parsedAfterJira!.body;

    // Jira sections updated
    expect(bodyJira).toContain("UPDATED Jira: checkout crash fixed in build 42");
    expect(bodyJira).not.toContain("Jira description: checkout crash on iOS 17.");
    expect(bodyJira).toContain("**Dave**");
    expect(bodyJira).toContain("Verified fix on production");
    expect(bodyJira).not.toContain("Fix deployed to staging.");

    // Asana sections preserved
    expect(bodyJira).toContain(
      "Asana description: the checkout form crashes on mobile."
    );
    expect(bodyJira).toContain("**Alice**");
    expect(bodyJira).toContain("I can reproduce on iPhone 15.");
    expect(bodyJira).toContain("**Bob**");
    expect(bodyJira).toContain("Same on iPad.");

    // Frontmatter: Jira raw status updated, Asana raw status preserved
    expect(fmJira.jira_status_raw).toBe("Done");
    expect(fmJira.asana_status_raw).toBe("In Progress");
    expect(fmJira.source).toBe("asana");
    expect(fmJira.ref).toBe("ECOMM-4643");
    expect(fmJira.asana_ref).toBe("https://app.asana.com/0/project/1234567890");
    expect(fmJira.jira_ref).toBe("https://myorg.atlassian.net/browse/WEB-297");

    // Shared sections preserved
    expect(bodyJira).toContain("![crash.png]");
    expect(bodyJira).toContain("## Activity log");
    expect(bodyJira).toContain("Re-ingested Jira side (WEB-297)");
    expect(bodyJira).toContain("## See also");
    expect(bodyJira).toContain("[[Daily 2024-01-10]]");

    // No orphan
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))
    ).toBe(false);

    // ---- Step 2: Re-ingest Asana side (ECOMM-4643) ----
    const asanaTask = {
      gid: "1234567890",
      name: "Fix checkout flow",
      notes: "UPDATED Asana: root cause was a race condition in cart state",
      completed: true,
      completed_at: "2024-01-22T00:00:00.000Z",
      assignee: { name: "Alice", gid: "111" },
      due_on: "2024-02-15",
      memberships: [{ section: { name: "Done", gid: "s1" } }],
      tags: [{ name: "bug" }, { name: "urgent" }],
      permalink_url: "https://app.asana.com/0/project/1234567890",
      custom_fields: [
        { name: "Ticket ID", display_value: "ECOMM-4643" },
      ],
    };

    const asanaClient: AsanaClient = {
      getMe: async () => ({
        gid: "me-gid",
        name: "Test User",
        email: "test@example.com",
      }),
      getTask: async () => asanaTask,
      getTaskByCustomId: async () => asanaTask,
      getStories: async () => [
        {
          gid: "s10",
          type: "comment",
          text: "Root cause identified: race in cart state machine",
          created_by: { name: "Alice", gid: "111" },
          created_at: "2024-01-22T10:00:00.000Z",
        },
      ],
      getAttachments: async () => [],
      downloadFile: async () => Buffer.from(""),
      getTasksForProject: async () => [],
      getTasksForSection: async () => [],
    } as AsanaClient;

    const asanaResult = await ingestAsanaTask({
      client: asanaClient,
      ref: "1234567890",
      workspaceRoot: tmpDir,
      identifierField: "Ticket ID",
    });

    expect(asanaResult.success).toBe(true);
    expect(asanaResult.skipped).toBe(false);
    expect(asanaResult.filePath).toContain("ECOMM-4643 (WEB-297).md");

    // Read after both re-ingests
    const afterBoth = fs.readFileSync(
      path.join(tmpDir, asanaResult.filePath!),
      "utf-8"
    );
    const parsedAfterBoth = parseFrontmatter(afterBoth);
    const fmBoth = parsedAfterBoth!.data;
    const bodyBoth = parsedAfterBoth!.body;

    // Asana sections now updated (from step 2)
    expect(bodyBoth).toContain(
      "UPDATED Asana: root cause was a race condition in cart state"
    );
    expect(bodyBoth).not.toContain(
      "Asana description: the checkout form crashes on mobile."
    );
    expect(bodyBoth).toContain("**Alice**");
    expect(bodyBoth).toContain("Root cause identified");

    // Jira sections still from step 1 (not touched by Asana re-ingest)
    expect(bodyBoth).toContain(
      "UPDATED Jira: checkout crash fixed in build 42"
    );
    expect(bodyBoth).toContain("**Dave**");
    expect(bodyBoth).toContain("Verified fix on production");

    // Frontmatter: both raw statuses updated
    expect(fmBoth.asana_status_raw).toBe("Done");
    expect(fmBoth.jira_status_raw).toBe("Done");
    expect(fmBoth.source).toBe("asana");
    expect(fmBoth.jira_needed).toBe("yes");

    // Activity log has both re-ingest entries
    expect(bodyBoth).toContain("Re-ingested Jira side (WEB-297)");
    expect(bodyBoth).toContain("Re-ingested Asana side (ECOMM-4643)");

    // Original log entries preserved
    expect(bodyBoth).toContain("Ingested from Asana (ECOMM-4643)");
    expect(bodyBoth).toContain("Merged ECOMM-4643 + WEB-297");

    // No orphan files
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "WEB-297.md"))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(tmpDir, "wiki", "tasks", "ECOMM-4643.md"))
    ).toBe(false);

    // Daily page wikilink preserved
    const daily = fs.readFileSync(
      path.join(tmpDir, "wiki", "daily", "2024-01-10.md"),
      "utf-8"
    );
    expect(daily).toContain("[[ECOMM-4643 (WEB-297)]]");
  });
});
