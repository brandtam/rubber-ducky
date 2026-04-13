# Prompt: Commit Message

Always run `git diff HEAD` and `git status` fresh — never reuse results from earlier in the conversation. Review the diff and any untracked files, then write a bulleted commit message that I can review and use when I make my commit.

## Format

1. A single summary line (imperative mood, under 70 characters)
2. A blank line
3. A bulleted list of the current state of changes — what the code does NOW, not the journey to get here

## Rules

- Describe the **result**, not the process. No "Fix bug that was introduced when..." or "Refactor after code review found..."
- Each bullet should describe a discrete capability, integration, or architectural change as it exists in the final code
- Use clear, concise language in the imperative mood ("Add X", "Extract Y", "Update Z")
- Group related changes into single bullets rather than listing every file touched
- Omit intermediate steps, failed approaches, and iterative fixes — only describe what the code does now
- Do NOT describe corrections to things that were never committed. If a value was wrong in the working tree but never made it into git history, the commit message should describe the current (correct) state, not "fix X to Y." The reader has no context for what X was.
- Keep it to 8-15 bullets for a large change, fewer for small ones
- Always run `git diff HEAD` and `git status` fresh on every invocation — never reuse results from earlier in the conversation, even if it looks like nothing changed
- NEVER commit yourself. Never run git commit. Never run git -C. I will want to review the message that you generate and decide if i want to use it on the commit that I create when I'm ready.
