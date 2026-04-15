# Prompt: Write PR Description

Write a pull request description for the current branch. If a PR number is provided as an argument ($ARGUMENTS), read that PR and update its description. Otherwise, output the description for me to copy.

## Steps

1. Run `git log main..HEAD --oneline` and `git diff main...HEAD --stat` to understand the full scope of the branch
2. Run `git diff main...HEAD` to read the actual changes
3. Read `git log main..HEAD` (full messages) for context on intent
4. If a PR number was provided, read the existing PR with `gh pr view`

## Format

Fill in the template from `.github/pull_request_template.md` with these rules:

### Summary

- Lead with 2–5 bullets covering the user-facing or system-level impact of the PR, not implementation details
- **Then list every issue this PR closes as its own flat bullet at the bottom of the Summary section.** Each issue gets its own line. Never bury issue references in prose ("Delivers the 8 child issues of #82") and never group them in a nested "Referenced issues" subsection.
- Use a closing keyword: `- Closes #N` (or `Fixes` / `Resolves`). These are the only GitHub closing keywords — `Implements`, `Addresses`, `Related to` do NOT auto-close.
- A Summary bullet may optionally combine the closing keyword with a short hook when the headline role of the issue is worth calling out: `- Closes #82 — PRD: cross-backend task page linking`. Default to naked `- Closes #N` for ordinary child issues.
- Example Summary shape:
  ```
  - <impact bullet 1>
  - <impact bullet 2>
  - Closes #82 — PRD: cross-backend task page linking
  - Closes #83
  - Closes #84
  ```

### Follow-ups

Use a dedicated `## Follow-ups` section (between `## Summary` and `## What changed`) for issues the PR does NOT close — partial addresses, or explicit follow-up work that stays open. One bullet per issue, no closing keyword, short hook after an em dash:

```
## Follow-ups

- #92 — wire `rubber-ducky merge` back-link writes through to `backend.comment()`
- #93 — make `rubber-ducky merge` resumable with a sentinel file
```

Omit the section entirely when there are no follow-ups. Never mix follow-up bullets into Summary, and never bury them in prose.

### What changed

- Organize by logical area, not by file
- Use subsections (### headings) when the PR touches multiple concerns
- For refactors or code review fixes, use a **table** with columns: Problem | Fix
- Include brief code snippets or SQL only when they clarify a non-obvious approach
- Describe the architecture/pattern, not every line changed
- **Do not add a "Referenced issues" subsection here.** All issue references live as Summary bullets.

### Migration notes

- State whether `db:generate` / `db:migrate` is needed
- Note any new environment variables
- If nothing: "No migrations or env changes needed."

### Test plan

- Checkboxes for each test suite that covers the changes (checked = passing)
- Manual verification steps as unchecked items for the reviewer
- Be specific: "upload an image, verify counter increments" not "test the feature"

## Rules

- Describe the **result**, not the journey. No "During code review we found..." or "After investigating..."
- Write for a reviewer who hasn't seen the conversation — they should understand the PR from the description alone
- Keep it concise but complete. A senior engineer should be able to review the PR using only the description and the diff
- **Each GitHub issue reference gets its own bullet.** This applies everywhere in the PR body — Summary, What changed, Referenced issues, test plan, any bulleted list. Never cram multiple issues into a single bullet, whether via comma-separated lists, inline prose ("follow-ups remain open — #92 and #93"), or parenthetical lists. One issue per line, always.

  Write:
  ```
  - Closes #148
  - Closes #149
  - #92 — wire merge back-link writes
  - #93 — make merge resumable
  ```

  Not:
  ```
  - Closes #148, #149
  - Two follow-ups remain open — #92 and #93
  - Closes #148 (and also see #149)
  ```

  In the Summary section, if a bullet would otherwise need to mention multiple issues, split it into multiple bullets with shared context instead of packing them together.
- If updating an existing PR, use `gh pr edit <number> --body "..."` with a HEREDOC
- NEVER create a PR. Only write or update the description.
