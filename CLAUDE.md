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

## Branch naming

```
fix/<issue-number>-<short-description>
feat/<issue-number>-<short-description>
refactor/<issue-number>-<short-description>
docs/<topic>
chore/<topic>
```

---

## What NOT to do

- ❌ Never push directly to `main` — always use a PR
- ❌ Never merge your own PR — Argus reviews and merges
- ❌ Never use `feat:` for internal improvements, type safety, or refactors
- ❌ Never open a PR with failing CI
- ❌ Never use `any` types — use `unknown` + type guards
