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

- 2-5 bullet points covering what the PR does and why
- Always use `Closes #N` to reference GitHub issues that should auto-close on merge. Only `Closes`, `Fixes`, and `Resolves` are GitHub closing keywords — words like "Implements", "Addresses", or "Related to" will NOT auto-close the issue. If a PR fully addresses an issue, use `Closes`. If it only partially addresses it, don't use a closing keyword at all — just reference it as `#N` inline
- Lead with the user-facing or system-level impact, not implementation details

### What changed

- Organize by logical area, not by file
- Use subsections (### headings) when the PR touches multiple concerns
- For refactors or code review fixes, use a **table** with columns: Problem | Fix
- Include brief code snippets or SQL only when they clarify a non-obvious approach
- Describe the architecture/pattern, not every line changed

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
- **Never use comma-separated lists for GitHub issues or groups of related items.** Always use bullet points. For example, write:
  ```
  - Closes #148
  - Closes #149
  - Closes #150
  ```
  Not: "Closes #148, #149, #150"
- If updating an existing PR, use `gh pr edit <number> --body "..."` with a HEREDOC
- NEVER create a PR. Only write or update the description.
