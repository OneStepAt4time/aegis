# `ci-runner`

- **Type:** slash-command
- **Scaffolds:** `.claude/commands/ci-runner.md`
- **Command:** `ag init --from-template ci-runner`

Use this starter when you want a reusable slash command that runs your local
quality gate, stops on the first real failure, and reports the next fix.

The generated command is intentionally generic so you can replace the default
command ladder with the checks your repository already uses.
