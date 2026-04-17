---
description: Review the current branch or a pull request for merge blockers, risk, and missing follow-up work.
allowed-tools: Bash(*),Read(*),Glob(*)
---

# /pr-reviewer

Review a pull request or local branch diff. `$ARGUMENTS` can be a PR number, a
comparison range, or a custom review focus such as `security` or `docs only`.

## When to Use

- Before requesting review from a teammate
- Before merging a hotfix or release branch
- When you want a fast "what could still go wrong?" pass on a diff

## Customize This Template

- Replace the Git or forge commands with the ones your team actually uses.
- Add repository-specific risk checks such as migrations, feature flags, or API
  compatibility.
- Tighten the allowed tools if you want a stricter review sandbox.
- Adjust the output format for GitHub comments, Slack, or release notes.

## Review Workflow

1. Resolve the review target from `$ARGUMENTS`; default to the current branch if
   nothing is passed.
2. Read the diff, commit log, and any touched tests or docs.
3. Look for correctness issues, risky assumptions, missing tests, and rollback
   concerns.
4. Group findings by severity and keep the summary concise.

## Output Format

- `Severity — file:line — issue`
- `Why it matters now`
- `Suggested follow-up`
