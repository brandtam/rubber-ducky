import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter, validateFrontmatter } from "./frontmatter.js";
import { loadWorkspaceConfig } from "./workspace.js";
import { getBackend } from "./backend.js";
import { mapGitHubStateToStatus } from "./github-backend.js";

export type Severity = "error" | "warning" | "info";

export interface LintFinding {
  rule: string;
  severity: Severity;
  file: string | null;
  message: string;
}

export interface LintResult {
  findings: LintFinding[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    total: number;
  };
}

export interface LinterOptions {
  backendExec?: (args: string[]) => string;
  staleDays?: number;
}

const DEFAULT_STALE_DAYS = 7;

const WIKILINK_REGEX = /\[\[([^\]|\\]+)(?:\\?\|[^\]]+)?\]\]/g;

interface PageEntry {
  filePath: string;
  relativePath: string;
  type: string;
  data: Record<string, unknown>;
  body: string;
}

/**
 * Run all linter checks against a workspace.
 */
export function runLinter(
  workspaceRoot: string,
  options?: LinterOptions
): LintResult {
  const findings: LintFinding[] = [];
  const pages = scanAllPages(workspaceRoot);
  const vocabulary = loadVocabulary(workspaceRoot);

  findings.push(...checkStaleTasks(pages, options?.staleDays ?? DEFAULT_STALE_DAYS));
  findings.push(...checkOrphanPages(workspaceRoot, pages));
  findings.push(...checkBrokenWikilinks(workspaceRoot, pages));
  findings.push(...checkFrontmatter(pages));
  findings.push(...checkVocabulary(pages, vocabulary));
  findings.push(...checkBackendDrift(workspaceRoot, pages, options));

  return {
    findings,
    summary: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      info: findings.filter((f) => f.severity === "info").length,
      total: findings.length,
    },
  };
}

function scanAllPages(workspaceRoot: string): PageEntry[] {
  const pages: PageEntry[] = [];
  const wikiDir = path.join(workspaceRoot, "wiki");

  const dirs = [
    { dir: "daily", type: "daily" },
    { dir: "tasks", type: "task" },
    { dir: "projects", type: "project" },
  ];

  for (const { dir, type } of dirs) {
    const fullDir = path.join(wikiDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = parseFrontmatter(content);
      if (parsed) {
        pages.push({
          filePath,
          relativePath: path.join("wiki", dir, file),
          type,
          data: parsed.data,
          body: parsed.body,
        });
      }
    }
  }

  return pages;
}

function checkStaleTasks(pages: PageEntry[], staleDays: number): LintFinding[] {
  const findings: LintFinding[] = [];
  const now = Date.now();
  const threshold = staleDays * 24 * 60 * 60 * 1000;

  for (const page of pages) {
    if (page.type !== "task") continue;
    const status = page.data.status as string | undefined;
    if (status !== "in-progress") continue;

    const updated = page.data.updated as string | undefined;
    if (!updated) continue;

    const updatedTime = new Date(updated).getTime();
    if (isNaN(updatedTime)) continue;

    if (now - updatedTime > threshold) {
      const daysSince = Math.floor((now - updatedTime) / (24 * 60 * 60 * 1000));
      findings.push({
        rule: "stale-task",
        severity: "warning",
        file: page.relativePath,
        message: `Task "${page.data.title}" has been in-progress for ${daysSince} days with no update`,
      });
    }
  }

  return findings;
}

function checkOrphanPages(workspaceRoot: string, pages: PageEntry[]): LintFinding[] {
  const findings: LintFinding[] = [];

  // Collect all wikilink targets across all wiki files (including index.md)
  const linkedPaths = new Set<string>();
  const allFiles = collectAllWikiFiles(workspaceRoot);

  for (const filePath of allFiles) {
    const content = fs.readFileSync(filePath, "utf-8");
    let match;
    const regex = new RegExp(WIKILINK_REGEX.source, "g");
    while ((match = regex.exec(content)) !== null) {
      linkedPaths.add(match[1]);
    }
  }

  // Check task and project pages — daily pages are exempt
  for (const page of pages) {
    if (page.type === "daily") continue;

    const isLinked = linkedPaths.has(page.relativePath);
    if (!isLinked) {
      findings.push({
        rule: "orphan-page",
        severity: "warning",
        file: page.relativePath,
        message: `Page "${page.data.title}" is not linked from any other page`,
      });
    }
  }

  return findings;
}

function collectAllWikiFiles(workspaceRoot: string): string[] {
  const files: string[] = [];
  const wikiDir = path.join(workspaceRoot, "wiki");
  if (!fs.existsSync(wikiDir)) return files;

  // Top-level wiki files (index.md, log.md)
  const topFiles = fs.readdirSync(wikiDir).filter((f) => f.endsWith(".md"));
  for (const f of topFiles) {
    files.push(path.join(wikiDir, f));
  }

  // Subdirectory files
  for (const subdir of ["daily", "tasks", "projects"]) {
    const dir = path.join(wikiDir, subdir);
    if (!fs.existsSync(dir)) continue;
    const subFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const f of subFiles) {
      files.push(path.join(dir, f));
    }
  }

  return files;
}

function checkBrokenWikilinks(workspaceRoot: string, pages: PageEntry[]): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const page of pages) {
    const content = fs.readFileSync(page.filePath, "utf-8");
    let match;
    const regex = new RegExp(WIKILINK_REGEX.source, "g");
    while ((match = regex.exec(content)) !== null) {
      const target = match[1];
      const targetPath = path.join(workspaceRoot, target);
      if (!fs.existsSync(targetPath)) {
        findings.push({
          rule: "broken-wikilink",
          severity: "error",
          file: page.relativePath,
          message: `Broken wikilink: [[${target}]] — target does not exist`,
        });
      }
    }
  }

  return findings;
}

function checkFrontmatter(pages: PageEntry[]): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const page of pages) {
    const errors = validateFrontmatter(page.data, page.type);
    for (const error of errors) {
      findings.push({
        rule: "frontmatter-error",
        severity: "error",
        file: page.relativePath,
        message: `${error.field}: ${error.message}`,
      });
    }
  }

  return findings;
}

function loadVocabulary(workspaceRoot: string): string[] | null {
  const vocabPath = path.join(workspaceRoot, "UBIQUITOUS_LANGUAGE.md");
  if (!fs.existsSync(vocabPath)) return null;

  const content = fs.readFileSync(vocabPath, "utf-8");

  // Find the Labels table and extract terms
  const labelsMatch = content.match(/## Labels\s*\n+\|[^\n]+\|\s*\n\|[-\s|]+\|\s*\n((?:\|[^\n]+\|\s*\n?)*)/);
  if (!labelsMatch) return null;

  const terms: string[] = [];
  const rows = labelsMatch[1].trim().split("\n");
  for (const row of rows) {
    const cellMatch = row.match(/\|\s*([^|]+?)\s*\|/);
    if (cellMatch) {
      terms.push(cellMatch[1].trim());
    }
  }

  return terms.length > 0 ? terms : null;
}

function checkVocabulary(pages: PageEntry[], vocabulary: string[] | null): LintFinding[] {
  if (!vocabulary) return [];
  const findings: LintFinding[] = [];

  for (const page of pages) {
    const tags = page.data.tags;
    if (!Array.isArray(tags)) continue;

    for (const tag of tags) {
      const tagStr = String(tag);
      if (!vocabulary.includes(tagStr)) {
        findings.push({
          rule: "vocabulary-violation",
          severity: "warning",
          file: page.relativePath,
          message: `Tag "${tagStr}" is not in the controlled vocabulary (UBIQUITOUS_LANGUAGE.md)`,
        });
      }
    }
  }

  return findings;
}

interface GhIssueJson {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  labels: { name: string }[];
  comments: { body: string; author: { login: string }; createdAt: string }[];
}

function checkBackendDrift(
  workspaceRoot: string,
  pages: PageEntry[],
  options?: LinterOptions
): LintFinding[] {
  const findings: LintFinding[] = [];

  let config;
  try {
    config = loadWorkspaceConfig(workspaceRoot);
  } catch {
    return findings;
  }

  if (config.backends.length === 0) return findings;

  const hasGitHub = config.backends.some((b) => b.type === "github");
  if (!hasGitHub) return findings;

  // Check each task that has a gh_ref
  for (const page of pages) {
    if (page.type !== "task") continue;
    const ghRef = page.data.gh_ref as string | undefined;
    if (!ghRef) continue;

    try {
      const exec = options?.backendExec;
      if (!exec) continue; // Skip if no exec provided (can't check without gh CLI mock)

      const jsonFields = "number,title,body,state,url,labels,comments";
      // Extract issue/PR number from URL
      const refMatch = ghRef.match(/\/(\d+)$/);
      if (!refMatch) continue;
      const ref = refMatch[1];

      const output = exec(["issue", "view", ref, "--json", jsonFields]);
      const data: GhIssueJson = JSON.parse(output);

      // Check status mismatch
      const labels = data.labels.map((l) => l.name);
      const remoteStatus = mapGitHubStateToStatus(data.state, labels);
      const localStatus = page.data.status as string;

      if (localStatus !== remoteStatus) {
        findings.push({
          rule: "backend-drift",
          severity: "warning",
          file: page.relativePath,
          message: `Status mismatch: wiki says "${localStatus}", GitHub says "${remoteStatus}"`,
        });
      }

      // Check comment count
      const localComments = (page.data.comment_count as number) ?? 0;
      const remoteComments = data.comments.length;

      if (remoteComments > localComments) {
        findings.push({
          rule: "backend-drift",
          severity: "warning",
          file: page.relativePath,
          message: `New comments: wiki has ${localComments}, GitHub has ${remoteComments} (${remoteComments - localComments} new)`,
        });
      }
    } catch {
      // Skip individual task drift checks on error
    }
  }

  return findings;
}
