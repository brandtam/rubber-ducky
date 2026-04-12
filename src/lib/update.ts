import * as fs from "node:fs";
import * as path from "node:path";

export interface BundledTemplate {
  relativePath: string;
  content: string;
  description: string;
}

export type FileStatus = "unchanged" | "modified" | "new";

export interface FileComparison {
  relativePath: string;
  status: FileStatus;
  description: string;
  localContent: string | null;
  bundledContent: string;
  diff: string | null;
}

export interface UpdateScanResult {
  comparisons: FileComparison[];
  unchanged: FileComparison[];
  modified: FileComparison[];
  newFiles: FileComparison[];
}

export type UpdateAction = "keep" | "overwrite" | "skip";

export interface UpdateFileResult {
  relativePath: string;
  action: UpdateAction;
  applied: boolean;
}

/**
 * Returns all templates bundled with the current CLI version.
 * These are skill and agent files that ship with rubber-ducky.
 */
export function getBundledTemplates(): BundledTemplate[] {
  return [
    {
      relativePath: ".claude/commands/good-morning.md",
      content: `# Good Morning

Start the day with a prioritized brief.

## Behavior

### Step 1 — Ensure today's daily page exists

Run via Bash:

\`\`\`
rubber-ducky page create daily
\`\`\`

If the page already exists, this is a no-op (the CLI will report it exists). Continue either way.

### Step 2 — Gather context

Read the following files to build situational awareness:

1. **Yesterday's daily page** — check \`wiki/daily/\` for the most recent page before today. Note any items in the "Carried over" section.
2. **Active tasks** — scan \`wiki/tasks/\` for tasks with status \`in-progress\`, \`to-do\`, or \`blocked\`. Read their frontmatter (especially \`status\`, \`priority\`, \`due\`).
3. **ASAP items** — check \`wiki/tasks/\` for any task with \`priority: asap\` or tagged \`asap\`. These must be surfaced first.
4. **Date-keyed reminders** — check \`wiki/tasks/\` for tasks with a \`due\` date matching today. These are deadline items that need attention.
5. **Upcoming deadlines** — check for tasks with \`due\` dates within the next 3 days to flag what's approaching.

### Step 3 — Present the morning brief

Output a prioritized summary in this order:

1. **ASAP items** — handle first, these are urgent
2. **Deadline items due today** — time-sensitive
3. **Upcoming deadlines (next 3 days)** — awareness items
4. **Carried-over items** — unfinished from yesterday
5. **In-progress tasks** — continue work
6. **Blocked tasks** — check if unblocked, escalate if still stuck
7. **To-do tasks** — pick up next if capacity allows

Suggest a focus task for the day based on priority and deadlines.

### Step 4 — Set the morning-brief flag

Run via Bash:

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md morning_brief true
\`\`\`

(Replace YYYY-MM-DD with today's date.)

### Step 5 — Set active task

If a focus task was suggested and the user agrees, run via Bash:

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md active_task "<task-slug>"
\`\`\`

## Redirect behavior

After handling any interruption during the day, remind the user of their active task by reading the \`active_task\` field from today's daily page frontmatter. If \`active_task\` is set, say: "Ready to get back to [active task]?" This keeps the user focused after context switches.

## Output

A concise, prioritized morning brief. Use short bullet points. Do not reproduce full task contents — just titles, statuses, and due dates. The goal is a quick scan, not a wall of text.
`,
      description: "Morning brief skill — prioritized daily summary",
    },
    {
      relativePath: ".claude/commands/wrap-up.md",
      content: `# Wrap Up

End-of-day summary and workspace update.

## Behavior

### Step 1 — Read today's daily page

Read today's daily page from \`wiki/daily/YYYY-MM-DD.md\`. If no daily page exists, create one first:

\`\`\`
rubber-ducky page create daily
\`\`\`

### Step 2 — Identify tasks touched today

Scan \`wiki/tasks/\` and read activity logs and frontmatter. A task was "touched" if:
- Its \`updated\` timestamp is from today
- It has an activity log entry dated today
- The user mentioned working on it during the session

### Step 3 — Update task pages

For each touched task, run via Bash:

\`\`\`
rubber-ducky frontmatter set wiki/tasks/<slug>.md status <new-status>
rubber-ducky frontmatter set wiki/tasks/<slug>.md updated <now-iso>
\`\`\`

If a task was completed, also set:

\`\`\`
rubber-ducky frontmatter set wiki/tasks/<slug>.md closed <now-iso>
\`\`\`

### Step 4 — Update daily log

Append a wrap-up entry to the workspace log:

\`\`\`
rubber-ducky log append "EOD wrap-up: <N> tasks touched, <M> completed"
\`\`\`

### Step 5 — Create status snapshot in daily page

Update today's daily page body sections by editing the file directly:

- **Completed today** — list tasks that moved to \`done\`
- **Carried over** — list in-progress or to-do tasks that weren't completed
- **Blockers** — note any blocked tasks and why
- **Work log** — add a brief narrative of the day's work

Also update the \`tasks_touched\` frontmatter array:

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md tasks_touched '["task-slug-1","task-slug-2"]'
\`\`\`

### Step 6 — Set the wrap-up flag

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md wrap_up true
\`\`\`

### Step 7 — Clear active task

\`\`\`
rubber-ducky frontmatter set wiki/daily/YYYY-MM-DD.md active_task null
\`\`\`

## Redirect behavior

If the user triggers this skill but has an \`active_task\` set in today's daily page, confirm they want to wrap up: "You still have [active task] marked as active — ready to wrap up for the day?" This prevents accidental wrap-up mid-flow.

## Output

A concise end-of-day summary:
- Tasks completed today (count + titles)
- Tasks carried over (count + titles)
- Blockers (if any)
- Suggested focus for tomorrow

Keep it brief — the daily page has the full record.
`,
      description: "End-of-day wrap-up skill — daily summary and status update",
    },
    {
      relativePath: ".claude/commands/lint.md",
      content: `# Lint

Check workspace health and consistency.

## Behavior

1. Verify \`workspace.md\` exists and has valid frontmatter
2. Scan \`wiki/tasks/\` for:
   - Stale tasks (in-progress for >7 days with no activity)
   - Missing required frontmatter fields
   - Broken wikilinks
3. Scan \`wiki/daily/\` for:
   - Gaps in daily pages
   - Pages with empty sections
4. Check \`UBIQUITOUS_LANGUAGE.md\` for:
   - Terms used in task pages but not defined
5. Report findings grouped by severity (error, warning, info)

## Output

A structured report of workspace health issues.
`,
      description: "Workspace linter skill — health and consistency checks",
    },
    {
      relativePath: ".claude/agents/work-historian.md",
      content: `# Work Historian

A read-only agent for querying work history across the workspace.

## Role

Answer questions about past work by searching daily pages, task pages, and activity logs. Never modify files — only read and synthesize.

## Tools

- Read files from \`wiki/daily/\`, \`wiki/tasks/\`, and \`wiki/projects/\`
- Use \`rubber-ducky frontmatter get\` to extract structured data
- Search across files for keywords and date ranges

## Examples

- "When did we first discuss the auth rewrite?"
- "What did I work on last week?"
- "Show me all tasks related to the API migration"
- "How many tasks did I close in March?"
`,
      description: "Work historian agent — read-only historical queries",
    },
  ];
}

/**
 * Scan a workspace and compare local files against bundled templates.
 */
export function scanWorkspace(workspacePath: string): UpdateScanResult {
  const templates = getBundledTemplates();
  const comparisons: FileComparison[] = [];

  for (const template of templates) {
    const fullPath = path.join(workspacePath, template.relativePath);
    let localContent: string | null = null;
    let status: FileStatus;
    let diff: string | null = null;

    if (fs.existsSync(fullPath)) {
      localContent = fs.readFileSync(fullPath, "utf-8");
      if (localContent === template.content) {
        status = "unchanged";
      } else {
        status = "modified";
        diff = generateDiff(localContent, template.content);
      }
    } else {
      status = "new";
    }

    comparisons.push({
      relativePath: template.relativePath,
      status,
      description: template.description,
      localContent,
      bundledContent: template.content,
      diff,
    });
  }

  return {
    comparisons,
    unchanged: comparisons.filter((c) => c.status === "unchanged"),
    modified: comparisons.filter((c) => c.status === "modified"),
    newFiles: comparisons.filter((c) => c.status === "new"),
  };
}

/**
 * Generate a unified-style diff between two strings using LCS.
 * Returns empty string if content is identical.
 */
export function generateDiff(localContent: string, bundledContent: string): string {
  if (localContent === bundledContent) return "";

  const localLines = localContent.split("\n");
  const bundledLines = bundledContent.split("\n");

  // Build LCS table
  const m = localLines.length;
  const n = bundledLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (localLines[i - 1] === bundledLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff operations
  const ops: Array<{ type: "+" | "-" | " "; line: string }> = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && localLines[i - 1] === bundledLines[j - 1]) {
      ops.unshift({ type: " ", line: localLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "+", line: bundledLines[j - 1] });
      j--;
    } else {
      ops.unshift({ type: "-", line: localLines[i - 1] });
      i--;
    }
  }

  return ops.map((op) => `${op.type}${op.line}`).join("\n");
}

/**
 * Apply an update action to a single file.
 */
export function applyFileUpdate(
  workspacePath: string,
  relativePath: string,
  bundledContent: string,
  action: UpdateAction
): UpdateFileResult {
  if (action === "keep" || action === "skip") {
    return { relativePath, action, applied: false };
  }

  const fullPath = path.join(workspacePath, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bundledContent, "utf-8");

  return { relativePath, action, applied: true };
}
