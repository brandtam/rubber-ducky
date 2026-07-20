import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter, validateFrontmatter } from "./frontmatter.js";

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
  /**
   * Default stale threshold (in days) applied to any task whose status is
   * not overridden by `staleDaysPerStatus`. Default: 7.
   */
  staleDays?: number;
  /**
   * Per-status stale thresholds. When a status appears here, its value
   * overrides `staleDays` for tasks with that status. Useful for instances
   * that want, say, 14 days for in-progress but 27 for blocked.
   * Status keys use the controlled vocabulary (e.g. `in-progress`, `blocked`,
   * `in-review`).
   */
  staleDaysPerStatus?: Record<string, number>;
  /**
   * When true, orphan-page findings split by task status:
   *   - `orphan-page-active` — orphaned task pages with non-done status
   *     (more urgent — these were likely created and forgotten)
   *   - `orphan-page-done`   — orphaned task pages with `done` status
   *     (cleanup hint — closed tasks that were never linked anywhere)
   * Default false: a single `orphan-page` rule covers all orphans uniformly.
   */
  splitOrphansByStatus?: boolean;
  /**
   * When true, scan `wiki/asap.md` (if it exists) for hygiene issues:
   * malformed lines, stale unresolved items, and resolved items that
   * weren't cleared. Default false — workspaces without an ASAP list
   * need not opt in.
   */
  checkAsapHygiene?: boolean;
  /**
   * Day threshold for "stale" ASAP items. Pending items older than this
   * are flagged. Default 14.
   */
  asapStaleDays?: number;
}

const DEFAULT_ASAP_STALE_DAYS = 14;
const ASAP_PENDING_LINE_RE = /^- \[ \] (\S+) — (.+)$/;
const ASAP_RESOLVED_LINE_RE = /^- \[x\] (\S+) — (.+?)\s+\(resolved: (\S+)\)$/;

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

  findings.push(
    ...checkStaleTasks(
      pages,
      options?.staleDays ?? DEFAULT_STALE_DAYS,
      options?.staleDaysPerStatus
    )
  );
  findings.push(
    ...checkOrphanPages(workspaceRoot, pages, options?.splitOrphansByStatus ?? false)
  );
  findings.push(...checkBrokenWikilinks(workspaceRoot, pages));
  findings.push(...checkFrontmatter(pages));
  findings.push(...checkVocabulary(pages, vocabulary));
  findings.push(...checkEmptyDailyPages(pages));
  if (options?.checkAsapHygiene) {
    findings.push(
      ...checkAsapHygiene(
        workspaceRoot,
        options.asapStaleDays ?? DEFAULT_ASAP_STALE_DAYS
      )
    );
  }

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

function checkStaleTasks(
  pages: PageEntry[],
  staleDays: number,
  staleDaysPerStatus?: Record<string, number>
): LintFinding[] {
  const findings: LintFinding[] = [];
  const now = Date.now();

  // Statuses worth checking for staleness. Other statuses (backlog, done,
  // deferred) aren't expected to update — checking would just generate noise.
  const trackedStatuses = new Set(
    staleDaysPerStatus
      ? ["in-progress", ...Object.keys(staleDaysPerStatus)]
      : ["in-progress"]
  );

  for (const page of pages) {
    if (page.type !== "task") continue;
    const status = page.data.status as string | undefined;
    if (!status || !trackedStatuses.has(status)) continue;

    const thresholdDays = staleDaysPerStatus?.[status] ?? staleDays;
    const threshold = thresholdDays * 24 * 60 * 60 * 1000;

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
        message: `Task "${page.data.title}" has been ${status} for ${daysSince} days with no update`,
      });
    }
  }

  return findings;
}

/**
 * Flag daily pages that have no wikilinks to any task. A daily file with no
 * task references usually indicates a missed ingest or a forgotten work-log
 * update — the day's work isn't traceable from the temporal spine.
 *
 * Daily pages with `morning_brief: false` AND no wikilinks are skipped (they
 * were created but the day hasn't been worked yet).
 */
function checkEmptyDailyPages(pages: PageEntry[]): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const page of pages) {
    if (page.type !== "daily") continue;

    const morningBrief = page.data.morning_brief;
    const wrapUp = page.data.wrap_up;
    const hasMorningBrief =
      morningBrief !== false && morningBrief !== null && morningBrief !== undefined;
    const hasWrapUp =
      wrapUp !== false && wrapUp !== null && wrapUp !== undefined;
    // Only check pages where the day actually began or ended — empty fresh
    // daily pages aren't a problem.
    if (!hasMorningBrief && !hasWrapUp) continue;

    const wikilinkCount = (page.body.match(WIKILINK_REGEX) || []).length;
    const tasksTouched = Array.isArray(page.data.tasks_touched)
      ? (page.data.tasks_touched as unknown[]).length
      : 0;

    if (wikilinkCount === 0 && tasksTouched === 0) {
      findings.push({
        rule: "empty-daily-page",
        severity: "warning",
        file: page.relativePath,
        message: `Daily page has no task wikilinks or tasks_touched entries — likely a missed ingest`,
      });
    }
  }

  return findings;
}

function checkOrphanPages(
  workspaceRoot: string,
  pages: PageEntry[],
  splitByStatus: boolean
): LintFinding[] {
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
    if (isLinked) continue;

    if (splitByStatus && page.type === "task") {
      const status = page.data.status as string | undefined;
      const rule = status === "done" ? "orphan-page-done" : "orphan-page-active";
      const qualifier = status === "done" ? "(closed)" : "(active)";
      findings.push({
        rule,
        severity: "warning",
        file: page.relativePath,
        message: `Page "${page.data.title}" ${qualifier} is not linked from any other page`,
      });
    } else {
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

interface ControlledVocabulary {
  /** Term list from UBIQUITOUS_LANGUAGE.md `## Labels` section. */
  labels: string[] | null;
  /** Term list from UBIQUITOUS_LANGUAGE.md `## Brands` section. */
  brands: string[] | null;
}

/**
 * Extract a list of canonical terms from a markdown table under `## <heading>`.
 * The table's first column holds the canonical name; rows after the header
 * separator are returned. Returns null if the section is missing or empty.
 */
function extractTableTerms(content: string, heading: string): string[] | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `## ${escaped}\\s*\\n+\\|[^\\n]+\\|\\s*\\n\\|[-\\s|]+\\|\\s*\\n((?:\\|[^\\n]+\\|\\s*\\n?)*)`
  );
  const match = content.match(re);
  if (!match) return null;

  const terms: string[] = [];
  const rows = match[1].trim().split("\n");
  for (const row of rows) {
    const cellMatch = row.match(/\|\s*([^|]+?)\s*\|/);
    if (cellMatch) terms.push(cellMatch[1].trim());
  }
  return terms.length > 0 ? terms : null;
}

function loadVocabulary(workspaceRoot: string): ControlledVocabulary | null {
  const vocabPath = path.join(workspaceRoot, "UBIQUITOUS_LANGUAGE.md");
  if (!fs.existsSync(vocabPath)) return null;

  const content = fs.readFileSync(vocabPath, "utf-8");
  const labels = extractTableTerms(content, "Labels");
  const brands = extractTableTerms(content, "Brands");

  if (!labels && !brands) return null;
  return { labels, brands };
}

function checkVocabularyAxis(
  pages: PageEntry[],
  vocabulary: string[],
  opts: { field: string; itemLabel: string; sectionHeading: string }
): LintFinding[] {
  const findings: LintFinding[] = [];

  for (const page of pages) {
    const values = page.data[opts.field];
    if (!Array.isArray(values)) continue;

    for (const value of values) {
      const valueStr = String(value);
      if (!vocabulary.includes(valueStr)) {
        findings.push({
          rule: "vocabulary-violation",
          severity: "warning",
          file: page.relativePath,
          message: `${opts.itemLabel} "${valueStr}" is not in the controlled vocabulary (UBIQUITOUS_LANGUAGE.md ## ${opts.sectionHeading})`,
        });
      }
    }
  }

  return findings;
}

function checkVocabulary(
  pages: PageEntry[],
  vocabulary: ControlledVocabulary | null
): LintFinding[] {
  if (!vocabulary) return [];
  const findings: LintFinding[] = [];

  if (vocabulary.labels) {
    findings.push(
      ...checkVocabularyAxis(pages, vocabulary.labels, {
        field: "tags",
        itemLabel: "Tag",
        sectionHeading: "Labels",
      })
    );
  }
  if (vocabulary.brands) {
    findings.push(
      ...checkVocabularyAxis(pages, vocabulary.brands, {
        field: "brands",
        itemLabel: "Brand",
        sectionHeading: "Brands",
      })
    );
  }

  return findings;
}

/**
 * Inspect wiki/asap.md (if present) for hygiene issues.
 * - malformed lines (unrecognized format)
 * - stale unresolved items (older than `staleDays`)
 * - progress-rot: resolved items still in the file (suggest archiving)
 *
 * Workspaces without an asap.md silently skip this check.
 */
function checkAsapHygiene(workspaceRoot: string, staleDays: number): LintFinding[] {
  const findings: LintFinding[] = [];
  const asapPath = path.join(workspaceRoot, "wiki", "asap.md");
  if (!fs.existsSync(asapPath)) return findings;

  const content = fs.readFileSync(asapPath, "utf-8");
  const lines = content.split("\n");
  const now = Date.now();
  const staleThreshold = staleDays * 24 * 60 * 60 * 1000;

  let pendingCount = 0;
  let staleCount = 0;
  let resolvedCount = 0;
  let malformedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (line.startsWith("#")) continue; // header

    // Lines starting with "- [" must match one of the two formats
    if (!line.startsWith("- [")) continue;

    const pendingMatch = line.match(ASAP_PENDING_LINE_RE);
    const resolvedMatch = line.match(ASAP_RESOLVED_LINE_RE);

    if (pendingMatch) {
      pendingCount++;
      const created = new Date(pendingMatch[1]).getTime();
      if (!isNaN(created) && now - created > staleThreshold) {
        staleCount++;
        const daysOld = Math.floor((now - created) / (24 * 60 * 60 * 1000));
        findings.push({
          rule: "asap-stale",
          severity: "warning",
          file: "wiki/asap.md",
          message: `ASAP item is ${daysOld} days old without resolution: "${pendingMatch[2].slice(0, 60)}${pendingMatch[2].length > 60 ? "..." : ""}"`,
        });
      }
    } else if (resolvedMatch) {
      resolvedCount++;
    } else {
      malformedCount++;
      findings.push({
        rule: "asap-format",
        severity: "warning",
        file: "wiki/asap.md",
        message: `Line ${i + 1} doesn't match the ASAP format: ${line.trim().slice(0, 80)}`,
      });
    }
  }

  // Progress-rot: if more than half of items are resolved, suggest archiving
  if (resolvedCount > 0 && resolvedCount >= pendingCount && resolvedCount + pendingCount >= 4) {
    findings.push({
      rule: "asap-progress-rot",
      severity: "info",
      file: "wiki/asap.md",
      message: `${resolvedCount} resolved item(s) accumulating in asap.md — consider archiving them`,
    });
  }

  return findings;
}
