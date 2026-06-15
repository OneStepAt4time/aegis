# Branching Strategy

**Golden rule: all standard PRs target `develop`. `main` is release/promotion only.**

```
feature/fix branches ──PR──> develop ──PR──> main ──> Release Please ──> npm
                                              ↑
                              hotfix/* ───PR──┘ (+ cherry-pick to develop)
```

## Worktree workflow (required)

```bash
mkdir -p .claude/worktrees
git fetch origin
git worktree add .claude/worktrees/fix-123 -b fix/123-bug origin/develop
# Work, commit, push
git push origin fix/123-bug
gh pr create --base develop --title "fix: resolve session crash" --body "Closes #123"
```

## Branch naming

```
fix/<issue-number>-<short-description>
feat/<issue-number>-<short-description>
refactor/<issue-number>-<short-description>
docs/<topic>
chore/<topic>
hotfix/<issue-number>-<short-description>
```

## Rules

- ❌ Never push directly to `main`
- ❌ Never open a PR targeting `main` unless maintainer explicitly says so
- ❌ Never merge your own PR — Argus reviews and merges
- ❌ Never open a PR with failing CI
- ❌ Never open a bot-authored PR without a documented approval path — see
  the [Path (b) Fallback in CONTRIBUTING.md](../../CONTRIBUTING.md#path-b-fallback-boss-approves-via-cli-on-bot-authored-prs)

## Bot-authored PRs

If you are submitting a PR from a bot identity (e.g., `aegis-gh-agent[bot]`,
`dependabot[bot]`, or a per-agent App once registered), the PR cannot
self-approve. The [Path (b) Fallback in CONTRIBUTING.md](../../CONTRIBUTING.md#path-b-fallback-boss-approves-via-cli-on-bot-authored-prs)
documents the lane:

```bash
# Ema (or another authorized human) runs this from their machine
gh pr review --approve <PR_NUMBER>
```

The structural fix (a dedicated reviewer App / PAT) is tracked in
[#4725](https://github.com/OneStepAt4time/aegis/issues/4725). Until that lands,
Path (b) is the documented lane. Branch protection's
`required_approving_review_count: 1` is still enforced — the human click
counts as the approval; Argus's pre-stage review is the technical LGTM.

For unattended-merge scenarios (overnight, hotfix window), see
[#4728](https://github.com/OneStepAt4time/aegis/issues/4728) (fallback approver
chain — adds an owner-overridable bot approver).
