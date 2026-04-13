# Verify PRD

Verify that a PRD has been fully implemented after a Sandcastle Ralph loop. This catches the class of bugs where issues get closed by commit messages on branches that were never merged, where user stories were covered by closed issues but the code doesn't actually exist, and where concurrent agents created conflicting database migrations.

## Process

### 1. Load the PRD

Ask the user for the PRD GitHub issue number. Fetch it with `gh issue view <number>`.

Identify:

- All numbered user stories in the PRD
- The feature branch name (ask the user if not obvious)

### 2. Find all child issues

Search for issues that reference the PRD:

```bash
gh issue list --search "<number> in:body" --state all --limit 100 --json number,title,state
```

Build a map of issue number → title → state.

### 3. Check for unmerged branches

This is the most critical check. Sandcastle creates `sandcastle/issue-*` branches for each issue. Verify every one was merged:

```bash
# Find sandcastle issue branches NOT merged into the feature branch
git branch --no-merged <feature-branch> | grep "sandcastle/issue-"
```

For each unmerged branch, check if it corresponds to a closed child issue — this is the orphan pattern where GitHub closed the issue (because the commit message said `closes #N`) but the code never reached the feature branch.

Cross-reference:

```bash
# What commits are on the unmerged branch that aren't on the feature branch?
git log --oneline <feature-branch>..<unmerged-branch>
```

Also check for orphaned session branches:

```bash
git branch --no-merged <feature-branch> | grep "sandcastle/claude-code"
```

For each, check what's on them that's not on the feature branch.

### 4. Check for Sandcastle side effects

Sandcastle may modify local git configuration during runs (e.g., embedding access tokens in remote URLs so Docker containers can push branches). Verify these haven't been left behind:

```bash
# Check if the git remote URL has credentials embedded
git remote -v
```

If the remote URL contains `x-access-token:` or any token/password, flag it:

```
⚠️ Git remote URL contains embedded credentials:
  origin  https://x-access-token:ghp_XXXX@github.com/org/repo.git

This was likely set by Sandcastle for container auth. Fix with:
  git remote set-url origin https://github.com/org/repo.git
```

Also check for any leftover Sandcastle worktree state:

```bash
# Check for stale worktrees
git worktree list
```

If there are worktrees beyond the main one, note them — they may be leftover from failed Sandcastle runs.

### 5. Audit database migration consistency

Sandcastle runs multiple agents concurrently in separate Docker containers. Each agent may generate Drizzle migrations independently. Since they all start from the same base state, they produce migrations with the **same sequence number** (e.g., two agents both generate `0003_*.sql`). When merged, this creates conflicts in the Drizzle journal and snapshot metadata.

Run these checks for every migration directory in the project (check `CLAUDE.md` or `drizzle.config.ts` for locations — typically `apps/bookbuilder/src/lib/server/migrations/` and `packages/platform/src/db/migrations/`):

#### 4a. Journal integrity

```bash
# Read the journal
cat <migrations-dir>/meta/_journal.json
```

Verify:

- **Valid JSON** — parse the journal with strict `JSON.parse`; trailing commas, missing brackets, etc. will break `drizzle-kit generate`. Fix any syntax errors immediately.
- **Sequential idx values** — entries should be 0, 1, 2, 3... with no gaps or duplicates
- **Unique tags** — no two entries share the same tag (filename)
- **Monotonic timestamps** — each entry's `when` should be greater than the previous
- **Matching files** — every tag in the journal has a corresponding `.sql` file and `meta/<idx>_snapshot.json`

#### 4b. Migration file consistency

```bash
# List migration SQL files
ls <migrations-dir>/0*.sql

# List snapshot files
ls <migrations-dir>/meta/0*_snapshot.json
```

Verify:

- **1:1 mapping** — every `.sql` file has a journal entry and a snapshot; every journal entry has a `.sql` file and a snapshot
- **No orphan files** — no `.sql` files or snapshots without journal entries (leftover from a merge conflict)
- **No duplicate sequence numbers** — no two `.sql` files with the same `NNNN_` prefix

#### 4c. Schema-migration drift

The Drizzle schema files (TypeScript) are the source of truth. The latest snapshot should match what `drizzle-kit generate` would produce. Check for drift:

```bash
# Dry-run generate to see if there are pending changes
pnpm --filter <package> db:generate --dry-run 2>&1
```

If this reports changes, either:

- The schema was modified after the last migration was generated (common after code review fixes)
- A migration from one agent included schema changes that another agent's migration didn't account for

When drift is detected, note what the pending changes are and whether they're intentional (e.g., a NOT NULL constraint added during code review) or accidental (merge artifact).

#### 4d. Cross-branch migration conflicts

Check whether unmerged branches (from step 3) contain their own migrations that would conflict:

```bash
# For each unmerged branch, check for migration files
git diff --name-only <feature-branch>...<unmerged-branch> | grep -E "migrations/[0-9]|_journal.json|snapshot"
```

If an unmerged branch has migrations at the same sequence number as migrations already on the feature branch, merging it will create a conflict. Document the conflict and recommend resolution (typically: merge the branch, then delete the conflicting migration and re-generate from the merged schema).

#### 4e. Migration content review

For each migration file added in this PRD branch (not on main):

```bash
git diff --name-only main...<feature-branch> | grep "migrations/0.*\.sql"
```

Read each migration and verify:

- **No hand-edited generated files** — Drizzle-generated migrations should not be manually modified. If the SQL looks different from what Drizzle would produce, it may have been hand-edited during a merge conflict resolution
- **Column additions match schema** — new columns in migrations should have the same nullability, defaults, and constraints as the schema TypeScript
- **Indexes exist** — any new indexes defined in the schema should appear in a migration
- **No DROP without intention** — watch for accidental column drops (can happen when two agents modify the same table and one agent's migration doesn't know about the other's new column)

### 6. Verify user stories against code

For each user story group in the PRD, verify the implementation actually exists in the codebase. Don't just trust that a closed issue means the code is there.

**Method:**

- Read the user story's acceptance criteria
- Search the codebase for evidence of implementation (grep for key terms, component names, API routes, schema fields, test files)
- Mark each user story as: ✅ Verified in code | ❌ Not found in code | ⚠️ Partially implemented

Focus on **high-value checks**:

- New components mentioned in the PRD — do they exist?
- New API routes — do they exist?
- New schema fields — are they in the schema AND the migration?
- New service methods — do they exist?
- UI behaviors described in user stories — is there evidence in components?

Don't exhaustively test every detail — look for the smoking guns that indicate a user story was or wasn't implemented.

### 7. Check for implementation gaps not covered by issues

Some PRD requirements may not have had a dedicated issue created. Scan the PRD for:

- Features mentioned in "Implementation Decisions" that don't map to any child issue
- User stories that aren't covered by any child issue's "User stories addressed" section
- Infrastructure or migration steps described in the PRD that may have been assumed but not tracked

### 8. Present findings

Organize findings into four categories:

#### 🔴 Unmerged branches (critical)

For each orphaned branch:

- Branch name
- Issue it implements (number + title)
- Issue state (likely "CLOSED" — the false positive)
- User stories affected
- Whether it contains migrations that will conflict
- What to do: merge it or reimplement

#### 🟠 Migration issues (critical if deploying)

For each migration problem found:

- What's wrong (duplicate sequence numbers, journal gaps, schema drift, orphan files)
- Which packages are affected
- Whether a re-generate is needed
- Recommended fix order (merge unmerged branches first, then re-generate)

#### 🟡 User stories not verified in code (needs investigation)

For each user story where code evidence is missing:

- User story number and text
- What was searched for
- Whether a closed issue claims to cover it
- Possible explanations (might be in an unmerged branch, might never have been built, might be covered by a different mechanism)

#### 🟠 Sandcastle side effects (if any)

For each side effect found:

- What changed (e.g., embedded credentials in git remote URL, stale worktrees)
- The fix command
- Whether it affects security (credential exposure) or just cleanup (stale worktrees)

#### 🟢 Verified complete

Summary count of user stories confirmed in code.

### 9. Recommend actions

For each gap found, recommend:

- **Merge** — if the code exists on an unmerged branch and just needs to be merged
- **Re-generate migrations** — if migration conflicts exist after merging
- **New issue** — if the user story was never implemented
- **Skip** — if the user story is low priority or out of scope for this release

Suggest an order of operations when multiple actions are needed. Typically:

1. Merge orphaned branches first
2. Delete conflicting migration files and snapshots
3. Re-generate migrations from the merged schema state
4. Run `pnpm check` to verify TypeScript
5. Run `pnpm test` to verify tests
6. Then address any remaining user story gaps

Ask the user how to proceed with each gap.

### 10. Fix all findings

**Do not stop at reporting.** Every issue surfaced in steps 3–8 must be resolved before the verification is complete. This includes cosmetic issues (trailing commas in JSON, duplicate object properties), not just functional gaps. Treat the findings like a code review checklist — iterate through each one, fix it, and confirm the fix.

After all fixes:

1. Run `pnpm test` — full suite must pass with zero new failures
2. Run `pnpm check` — TypeScript must be clean (or no new errors vs. baseline)
3. Run `pnpm db:generate` for each package — must succeed and report "nothing to migrate"
4. If any pre-existing test failures were encountered during verification, fix those too

**The verification is not complete until every finding is either fixed or explicitly deferred by the user.** Do not present a report and wait — present the report, then immediately begin fixing.

## Tips

- Always run `git fetch --all` first to make sure you have the latest branches
- Sandcastle session branches (`sandcastle/claude-code/*`) are the orchestrator — issue branches (`sandcastle/issue-*`) are the workers. The orchestrator merges workers. If a worker was never merged into any orchestrator session, its code is orphaned.
- GitHub closes issues when it sees `closes #N` or `fixes #N` in a commit message on ANY pushed branch — it does NOT verify the commit reached the default branch or the PR's target branch. This is the primary failure mode.
- The order list page and similar "secondary" UI that filters by a new entity (version, etc.) is commonly missed because it's a small change to an existing page rather than a new component.

### Migration-specific tips

- **Never hand-edit Drizzle-generated migration files.** If a migration is wrong, delete it and its snapshot, fix the schema, and re-generate. Hand-editing creates drift between the snapshot and the SQL that compounds over time.
- **Migration sequence numbers are just filenames.** Drizzle uses the journal's `idx` and `tag` fields to track order, not the `NNNN_` prefix. But duplicate prefixes still cause filesystem conflicts and human confusion.
- **The snapshot is the real state.** Each `NNNN_snapshot.json` captures the full schema state after that migration. If a snapshot is wrong (e.g., from a merge of two agents' conflicting views), all subsequent migrations generated from it will be wrong too. When in doubt, delete everything after the last known-good snapshot and re-generate.
- **Concurrent agents = concurrent schema views.** If agent A adds `versionId` to `bb_order` and agent B adds `priority` to `bb_order`, each generates a migration that only knows about its own column. The merged schema has both columns, but neither migration adds both. The fix: after merging both agents' schema changes, delete both migrations and generate a single new one that adds both columns.
- **Run migrations against a fresh database to verify.** After resolving conflicts: `pnpm --filter <package> db:migrate` against a clean database (or use `drizzle-kit push` for a quick check). If it fails, the journal/snapshot state is still inconsistent.
