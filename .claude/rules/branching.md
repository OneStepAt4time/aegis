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
