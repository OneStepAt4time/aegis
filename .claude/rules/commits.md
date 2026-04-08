# Commit Conventions

**Your commit type determines the release version bump.**

```
fix / refactor / perf / chore / docs / test / ci  →  patch bump  (2.4.1 → 2.4.2)
feat                                               →  minor bump  (2.4.x → 2.5.0)  ← USE RARELY
feat! / BREAKING CHANGE                            →  major bump  (2.x.x → 3.0.0)  ← NEVER without approval
```

## Decision tree

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

## feat: Gate

`feat:` commits are allowed only for genuine user-facing features. CI enforces this:

1. Open the PR with `feat:` title only if the change is truly user-visible
2. Ask for the `approved-minor-bump` label
3. Without the label, the PR stays blocked

**When in doubt → `fix:` or `refactor:`.**
