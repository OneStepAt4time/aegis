# CLAUDE.md — Instructions for Claude Code

## Commit Convention — READ THIS BEFORE EVERY COMMIT

**Your commit type determines the release version bump.**

```
fix / refactor / perf / chore / docs / test / ci  →  patch bump  (2.4.1 → 2.4.2)
feat                                               →  minor bump  (2.4.x → 2.5.0)  ← USE RARELY
feat! / BREAKING CHANGE                            →  major bump  (2.x.x → 3.0.0)  ← NEVER without approval
```

### Decision tree

```
Does it fix a bug?                          → fix:
Does it improve speed/memory?               → perf:
Does it restructure code (no behavior change)? → refactor:
Does it add/fix tests?                      → test:
Does it touch CI/build/deps only?           → ci: or chore:
Does it touch docs only?                    → docs:
Can a USER of Aegis see/use the new thing?
  YES → feat:
  NO  → refactor: or fix: or chore:
```

### Examples

```
✅ fix: prevent crash when session ID is null
✅ fix(security): validate UUID format on hookSessionId header
✅ refactor: extract session cleanup into helper function
✅ refactor: replace any cast with explicit type in applyEnvOverrides
✅ perf: add shared tmux capture-pane cache to deduplicate reads
✅ ci: add bundle size check to CI pipeline

❌ feat(resilience): add structured error categorization  → use refactor:
❌ feat: improve internal retry logic                     → use fix: or refactor:
❌ feat: add bounds validation                            → use fix(security):
```

### Why this matters

Every `feat:` triggers a **minor version bump** in the next release.
We went from v2.0.0 to v2.4.0 in 48 hours from overuse of `feat:`. Be conservative.
**When in doubt → `fix:` or `refactor:`.**

---

## Quality Gate — MANDATORY before opening a PR

```bash
npx tsc --noEmit    # must pass
npm run build       # must pass
npm test            # must pass
```

Never open a PR with a failing quality gate.

---

## PR Body — REQUIRED fields

Every PR must include:

```markdown
## Aegis version
**Developed with:** vX.Y.Z   ← get from: curl -s http://localhost:9100/v1/health | jq .version
```

---

## Branching Strategy — GitHub Flow + develop

**Golden rule: All new agent PRs target `develop`, never `main` (except maintainer-directed bootstrap or hotfix work).**

> Transition note: during the Week 1 rollout, maintainers may temporarily relax or move branch protection checks while `develop` is being bootstrapped. As soon as the rollout PR lands, re-enable protection and send all new agent PRs to `develop`.

```
feature/fix branches ──PR──> develop ──PR──> main ──> Release Please ──> npm
                                              ↑
                              hotfix/* ───PR──┘ (+ cherry-pick to develop)
```

### Worktree workflow (required for all agents)

```bash
# 0. Ensure the shared worktree folder exists
mkdir -p .claude/worktrees

git fetch origin

# 1. Create worktree from develop
git worktree add .claude/worktrees/fix-123 -b fix/123-bug origin/develop

# 2. Work, commit, push
git push origin fix/123-bug

# 3. Open PR targeting develop (NEVER main unless maintainer explicitly says so)
gh pr create --base develop --title "fix: resolve session crash" --body "Closes #123"
```

### Hotfix workflow (critical production bugs only)

```bash
# Exception: branch from main, PR to main
git worktree add .claude/worktrees/hotfix-999 -b hotfix/999-critical origin/main
# Fix, push, PR to main
# After merge: cherry-pick to develop
```

---

## Branch naming

```
fix/<issue-number>-<short-description>
feat/<issue-number>-<short-description>
refactor/<issue-number>-<short-description>
docs/<topic>
chore/<topic>
hotfix/<issue-number>-<short-description>
```

---

## What NOT to do

- ❌ Never push directly to `main` — always use a PR
- ❌ Never open a PR targeting `main` — target `develop` (exceptions: hotfixes or maintainer-directed bootstrap PRs)
- ❌ Never merge your own PR — Argus reviews and merges
- ❌ Never use `feat:` for internal improvements, type safety, or refactors
- ❌ Never open a PR with failing CI
- ❌ Never use `any` types — use `unknown` + type guards
