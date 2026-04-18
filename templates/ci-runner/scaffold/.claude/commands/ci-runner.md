---
description: Run the repository's local quality gate and summarize the first real failure.
allowed-tools: Bash(*),Read(*),Glob(*)
---

# /ci-runner

Run the repo's local CI-style checks. Use `$ARGUMENTS` to override the default
command ladder or to add context such as `frontend only`.

## When to Use

- Before pushing or opening a pull request
- After a risky refactor, dependency bump, or prompt-driven edit
- When you need a quick "what is red?" pass without opening CI

## Customize This Template

- Replace the default command ladder with the checks your repo actually uses.
- Narrow `allowed-tools` once you know the exact commands you want to permit.
- Add project-specific failure hints, log paths, or cleanup steps.
- Decide whether this command should fix issues or only report them.

## Default Command Ladder

1. If `$ARGUMENTS` is present, run that exact command first.
2. Otherwise try the first available of:
   - `npm run gate`
   - `npm run lint && npm test`
   - `npx tsc --noEmit && npm run build && npm test`
3. Stop on the first failing command and capture the useful error output.

## Reporting Rules

- Print the command that ran.
- Summarize the first real failure instead of dumping the entire log.
- End with the next concrete fix or rerun command.
