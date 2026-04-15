/**
 * Jira issue ingest orchestration.
 *
 * Fetches issues + comments via the REST client, checks for dedup,
 * writes fully populated task pages, rebuilds the index, and appends
 * to the log.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { JiraClient, JiraIssue } from "./jira-client.js";
import { VALID_STATUSES, type Status } from "./backend.js";
import { jiraIssueToPage } from "./jira-backend.js";
import { slugifyPreserveCase } from "./page.js";
import { loadMapping, translateStatus } from "./status-mapping.js";
import {
  type IngestResult,
  type BulkIngestResult,
  type DedupIndex,
  buildDedupIndex,
  findExistingByRef,
  checkMergedPage,
  updateMergedPageSections,
  generateIngestedTaskPage,
  postIngestProcess,
  finalizeBulkIngest,
  mapWithConcurrency,
} from "./ingest-shared.js";

// Re-export shared types so consumers don't need to import from two places
export type { IngestResult, BulkIngestResult } from "./ingest-shared.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface IngestJiraOptions {
  client: JiraClient;
  ref: string;
  workspaceRoot: string;
  serverUrl: string;
  statusMapping?: Record<string, Status>;
  /** Pre-fetched issue data from bulk search — avoids redundant API request. */
  prefetchedIssue?: JiraIssue;
  /** Pre-built dedup index — avoids re-scanning wiki/tasks/ per issue in bulk. */
  dedupIndex?: DedupIndex;
  /** Skip index rebuild and log append — caller handles these after the loop. */
  skipPostProcess?: boolean;
}

export interface IngestJiraProjectOptions {
  client: JiraClient;
  projectKey: string;
  workspaceRoot: string;
  serverUrl: string;
  statusMapping?: Record<string, Status>;
  scope?: "mine" | "all";
}

// ---------------------------------------------------------------------------
// Single-issue ingest
// ---------------------------------------------------------------------------

/**
 * Ingest a single Jira issue into the workspace.
 *
 * 1. Fetch issue + comments via REST client (or use prefetched data)
 * 2. Dedup check (jira_ref in wiki/tasks/)
 * 3. Write fully populated task page
 * 4. Optionally rebuild index and append log
 * 5. Return structured result
 */
export async function ingestJiraIssue(
  options: IngestJiraOptions
): Promise<IngestResult> {
  const {
    client,
    ref,
    workspaceRoot,
    serverUrl,
    statusMapping,
    prefetchedIssue,
    dedupIndex,
    skipPostProcess,
  } = options;

  // Fetch data — use prefetched issue if available, parallelize comments
  const [issue, comments] = await Promise.all([
    prefetchedIssue ?? client.getIssue(ref),
    client.getComments(ref),
  ]);

  // Convert to TaskPage (uses real Jira timestamps, not ingest time)
  const taskPage = jiraIssueToPage(issue, comments, serverUrl, statusMapping);

  // Translate status via workspace status-mapping config if available
  if (taskPage.jira_status_raw) {
    const mapping = loadMapping(workspaceRoot);
    const canonical = translateStatus(mapping, "jira", taskPage.jira_status_raw);
    if (canonical && VALID_STATUSES.includes(canonical as Status)) {
      taskPage.status = canonical as Status;
    }
  }

  // Dedup check
  if (!taskPage.jira_ref) {
    throw new Error(`Internal error: jira_ref is null after conversion for issue ${ref}`);
  }
  const existingFile = findExistingByRef(
    workspaceRoot,
    "jira_ref",
    taskPage.jira_ref,
    dedupIndex
  );
  if (existingFile) {
    // Check if the existing file is a merged page (both asana_ref + jira_ref)
    const mergedInfo = checkMergedPage(workspaceRoot, existingFile);
    if (mergedInfo.isMerged) {
      // Determine canonical status for the merged page update
      let canonicalStatus: string | undefined;
      if (taskPage.jira_status_raw) {
        const mapping = loadMapping(workspaceRoot);
        const translated = translateStatus(mapping, "jira", taskPage.jira_status_raw);
        if (translated && VALID_STATUSES.includes(translated as Status)) {
          canonicalStatus = translated;
        }
      }

      // Update only Jira-side sections in place
      updateMergedPageSections({
        workspaceRoot,
        existingRelativePath: existingFile,
        backendName: "Jira",
        taskPage,
        canonicalStatus,
      });

      if (!skipPostProcess) {
        postIngestProcess(
          workspaceRoot,
          `Re-ingested Jira issue on merged page: ${taskPage.title} (${ref})`
        );
      }

      return {
        success: true,
        skipped: false,
        filePath: existingFile,
        taskPage,
      };
    }

    return {
      success: true,
      skipped: true,
      reason: "already ingested",
      existingFile,
    };
  }

  // Write task page — use issue key as filename, preserving case (e.g., ECOMM-4643.md)
  const filename = `${slugifyPreserveCase(issue.key) || issue.key}.md`;
  const relativePath = path.join("wiki", "tasks", filename);
  const fullPath = path.join(workspaceRoot, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const content = generateIngestedTaskPage(taskPage, { source: "Jira", backendName: "Jira" });
  fs.writeFileSync(fullPath, content, "utf-8");

  // Post-processing (skipped in bulk mode — caller handles it)
  if (!skipPostProcess) {
    postIngestProcess(
      workspaceRoot,
      `Ingested Jira issue: ${taskPage.title} (${taskPage.ref})`
    );
  }

  return {
    success: true,
    skipped: false,
    filePath: relativePath,
    taskPage,
  };
}

// ---------------------------------------------------------------------------
// Bulk ingest
// ---------------------------------------------------------------------------

/**
 * Ingest all issues from a Jira project.
 *
 * Optimizations over naive per-issue ingest:
 * - Builds dedup index once before the loop
 * - Passes prefetched issue data from search results
 * - Rebuilds index and appends log once after the loop
 */
export async function ingestJiraProject(
  options: IngestJiraProjectOptions
): Promise<BulkIngestResult> {
  const { client, projectKey, workspaceRoot, serverUrl, statusMapping, scope } = options;

  // Build JQL
  let jql = `project = "${projectKey}"`;
  if (scope === "mine") {
    jql += " AND assignee = currentUser()";
  }
  jql += " ORDER BY created DESC";

  // Search for issues
  const searchResult = await client.searchIssues(jql);

  // Build dedup index once before the loop
  const dedupIndex = buildDedupIndex(workspaceRoot, "jira_ref");

  // Process issues with bounded concurrency (5 concurrent API calls)
  const results = await mapWithConcurrency(searchResult.issues, 5, (issue) =>
    ingestJiraIssue({
      client,
      ref: issue.key,
      workspaceRoot,
      serverUrl,
      statusMapping,
      prefetchedIssue: issue,
      dedupIndex,
      skipPostProcess: true,
    })
  );

  return finalizeBulkIngest(results, workspaceRoot, "Jira issue(s)");
}
