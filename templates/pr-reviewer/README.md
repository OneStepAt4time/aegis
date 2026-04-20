# `pr-reviewer`

- **Type:** slash-command
- **Scaffolds:** `.claude/commands/pr-reviewer.md`
- **Command:** `ag init --from-template pr-reviewer`

Use this starter when you want a slash command that reviews a pull request or
local diff for merge blockers, release risk, and missing follow-up work.

The generated command accepts `$ARGUMENTS`, so you can pass a PR number, a diff
range, or a specific review focus and then tailor the workflow to your forge.
