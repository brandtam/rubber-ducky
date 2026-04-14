# Prompt: Code Review

Review the pending work as a principal engineer building enterprise-grade software that other teams should copy. Every finding you raise is a claim that "if we merged this as-is, another team would learn the wrong pattern from it." If a finding doesn't clear that bar, don't raise it. If a finding does clear it, don't downgrade it because fixing feels annoying.

Solve root causes, not symptoms. If you see a workaround, ask what the underlying failure is and whether the right fix is deeper. Do not dismiss findings as "pre-existing" or "out of scope" — the `feedback_fix_everything.md` memory says we fix what we find.

## The mandate (apply per finding, not just overall)

Before presenting any finding, answer honestly for *that specific finding*:

> Would I merge this as-is and confidently point another engineering team at it as a reference example of how to do this well?

If the answer is "it works but no," raise the finding. If the answer is "yes, this is reference-grade," drop it — noise reduces signal.

## Inputs

Default scope: `git diff main...<current branch>`. If the current branch is `main`, ask the user what to diff. Always run `git fetch --all --prune` first so the diff reflects current remote state.

## Process

### 1. Environment hygiene (before reading a single line of diff)

Sandcastle and other agents can leave state behind that invalidates assumptions about the diff. Check:

- `git remote -v` — flag any embedded credentials (`x-access-token:ghp_*`, basic auth in URLs). These are live secrets and must be stripped and rotated.
- `git worktree list` — note stale sandcastle worktrees under `.sandcastle/worktrees/`.
- `git branch --no-merged <current-branch> | grep sandcastle/issue-` — flag unmerged issue branches whose code may have been orphaned (GitHub closes issues on `closes #N` in *any* pushed commit, even ones that never reach the target branch).
- Grep the diff for `.env`, `_TOKEN=`, `_KEY=`, `ghp_`, `sk-` — any secret in version control violates `feedback_env_local_only.md`.

### 2. Read the diff, then read the surroundings

A principal review reads more than the diff:

- The functions the diff *calls*.
- The callers of the functions the diff *changes*.
- Any parallel implementation. This codebase has two REST backends (Asana, Jira) that should stay symmetric — if one changes, check the other.
- The relevant PRD (if any — see `gh issue list --label PRD`) to verify the diff honors its explicit decisions.

### 3. Triage each candidate finding

Assign severity explicitly:

- **Critical** — security (credential exposure, injection, unauthenticated endpoints), data loss, correctness bugs that will fire in production, architectural choices that foreclose future work.
- **High** — coupling that will rot (mutable closure state across async boundaries, asymmetric APIs between parallel implementations, broken abstraction boundaries), missing observability on hot paths, missing test coverage for the changed surface, dependencies that aren't idiomatic for the codebase.
- **Medium** — duplicated logic that should be factored, comments that narrate or describe *what* rather than explain *why*, defensive error handling for cases that can't occur, non-ergonomic APIs.
- **Low** — naming, redundant checks, unnecessary local variables, slightly awkward control flow.
- **Nit** — subjective style. Don't raise unless the user explicitly asked for an exhaustive pass.

### 4. Self-audit (this is the step that catches the real issues)

Before presenting the report, re-read your own findings and ask:

- *Am I dismissing anything as "minor" that another team would actually copy as a bad pattern?* If yes, upgrade the severity.
- *Am I rationalizing anything away because I wrote it earlier in this session, or because the fix looks tedious?* If yes, raise it honestly. "I already thought about that" is not a reason to skip a finding.
- *Am I flagging my personal style preferences as issues?* If yes, downgrade to Nit or drop.
- *Did I apply the mandate question to each finding individually?* If not, go back and do that.

This step catches more real issues than the initial read-through. Don't skip it.

### 5. Present the report

Ordered Critical → High → Medium → Low. Use the item format below.

### 6. If the user asks you to fix

- Fix in severity order (Critical first).
- After every fix, run `npm run typecheck` and `npm test`. Both must pass before moving on.
- Do not commit. The user owns commits (`feedback_no_commits.md`).
- Do not estimate time (`feedback_no_time_estimates.md`).

## Repo-specific checks

These recur in this codebase. Scan for them explicitly.

### Comments

- Flag section-divider banners like `/* ---- */` — this codebase treats them as AI-generated noise.
- Flag JSDoc/docstrings that restate what a well-named identifier already conveys ("Parses X from Y" above `function parseX(y)`).
- Flag comments that reference tasks, issues, or callers ("fix for #123", "used by the X flow", "added during code review"). They rot. That context belongs in the PR description or commit message.
- Keep comments that explain *why*: hidden constraints, subtle invariants, workarounds for specific bugs, behavior that would surprise a reader, references to external specs.

### Architecture

- **Backend symmetry.** Asana and Jira clients should expose symmetric APIs (same limiter defaults, same throttling hooks, same auth validation timing). Asymmetry between parallel implementations is a principal-grade smell — pick one pattern and apply it to both.
- **Shared ingest infrastructure.** REST backends use `src/lib/ingest-shared.ts` for dedup, page generation, and concurrency. New backends should reuse rather than reimplement.
- **Rate-limited HTTP is mandatory.** All backend API calls route through `src/lib/http/rate-limited-client.ts`. CDN/asset downloads are the documented exception — see `asana-client.ts:downloadFile` for the WHY-comment pattern that explains a justified bypass.
- **No closure-state coupling.** Mutable flags shared between a callback and its outer catch block are a smell. Prefer typed errors + `instanceof` classification.
- **No premature abstraction.** Three similar lines beats a premature helper. But two near-identical functions differing only by a few constants IS factoring-worthy.

### HTTP / retry code

When the diff touches `src/lib/http/` or either REST client, check:

- `AbortSignal` passthrough — caller's `init.signal` must reach `fetch`.
- Per-attempt timeout — a single hung socket must not drain the whole retry budget.
- POST retry rule — POSTs must not retry on 5xx (no idempotency keys in Asana/Jira, so retries create duplicates).
- `Retry-After` honored with exact timing, not stacked on top of p-retry's jittered backoff.
- 429 retry budget separate from 5xx/network retry budget — server-directed waits must not cannibalize transient-error retries.

### Tests

- Mocks must structurally conform to the real type. A `Response` mock missing `headers: new Headers()` will pass `as Response` type-casts but crash at runtime. Flag any `as Response` with incomplete shape.
- Tests must inject `fetch`, `sleep`, and limiters for determinism — no real timers, no real wall-clock dependence.
- For changes to `src/lib/`, verify there's a corresponding test file in `src/__tests__/`.

### Dependencies

- PRD #74 fixed `bottleneck` and `p-retry` as the retry stack. Don't introduce `got` or `axios` for HTTP; don't introduce a competing retry library.
- New dependencies should appear in the PR description with a one-line justification.

## What NOT to flag

- Choices already settled by user feedback memories: no auto-commits, no time estimates, no shell-profile credential storage, `.env.local`-only secrets, `Closes/Fixes/Resolves` (not `Implements`) for issue linking.
- Explicit PRD decisions. If PRD #74 says "remove `Promise.all([stories, attachments])` and let the limiter interleave," don't flag the serial awaits as a missed parallelism opportunity.
- Pre-existing issues unrelated to the diff — *unless* they're security-critical (leaked secrets, unauthenticated endpoints), in which case flag them with a note that they're pre-existing and out of the diff scope.
- Your own personal style preferences dressed up as principles.

## Item format

⏺ Issue N of M: <short title>

Severity: Critical | High | Medium | Low | Nit
Location: `path/to/file.ts:line`

What: <the observation — what is wrong>

Why this matters: <the principal-engineering justification — what pattern will propagate, what teams will copy that they shouldn't, what constraint or invariant is violated>

Recommendation: <the concrete fix>

Pros:
- <>
- <>

Cons / Trade-offs:
- <>

What's your call — fix now, skip, or file a GitHub issue?
