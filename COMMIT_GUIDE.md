# COMMIT GUIDE — Hephaestus

## The Rule

**Your commit type determines the release version bump. Think before you type.**

```
fix/refactor/perf/chore/docs/test/ci  →  patch bump  (2.4.1 → 2.4.2)
feat                                   →  minor bump  (2.4.x → 2.5.0)  ← USE RARELY
feat! / BREAKING CHANGE                →  major bump  (2.x.x → 3.0.0)  ← NEVER without Emanuele
```

---

## When to use each type

### `fix:` — Bug fix
Something was broken. Now it's not.
```
fix: prevent crash when session ID is null
fix(api): return 404 instead of 500 for missing session
fix(security): validate UUID format on hookSessionId header
```

### `refactor:` — Code restructuring, no behavior change
Same behavior, cleaner code. Internal changes, type safety, removing dead code.
```
refactor: extract session cleanup into helper function
refactor: replace any cast with explicit type in applyEnvOverrides
refactor: eliminate duplicate /v1 route handlers
```

### `perf:` — Performance improvement
Faster, less memory, fewer calls. No behavior change.
```
perf: add shared tmux capture-pane cache to deduplicate reads
perf: clear pipeline poll interval when no pipelines remain
```

### `chore:` — Build, CI, tooling, deps
Doesn't touch production code.
```
chore: update dependencies
chore: add bundle size check to CI pipeline
chore: clean up stale worktrees
```

### `test:` — Adding or fixing tests
```
test: add unit tests for session cleanup
test: fix flaky timeout in heartbeat test
```

### `docs:` — Documentation only
```
docs: update README with new API endpoint
docs: add JSDoc to createSession function
```

### `ci:` — CI/CD changes only
```
ci: add explicit ClawHub login before skill publish
ci: fix Node 22 matrix in test workflow
```

### `feat:` — NEW user-visible feature ⚠️ USE SPARINGLY
A real feature that a USER of Aegis can SEE and USE. Not internal improvements.
```
✅ feat: add session list pagination to dashboard
✅ feat: add /v1/sessions/search endpoint
✅ feat: add WebSocket reconnect support with backoff

❌ feat(resilience): add structured error categorization  → use refactor:
❌ feat: improve internal retry logic                     → use fix: or refactor:
❌ feat: add bounds validation                            → use fix(security):
❌ feat: add overflow guard to event ID counter           → use fix:
```

### `feat!:` / `BREAKING CHANGE` — API-breaking change 🚨 NEVER without approval
Reserved for changes that break existing integrations. Requires explicit approval from Emanuele.

---

## Quick decision tree

```
Does it fix a bug?                    → fix:
Does it improve speed/memory?         → perf:
Does it restructure code internally?  → refactor:
Does it add/fix tests?                → test:
Does it touch CI/build only?          → ci: or chore:
Does it touch docs only?              → docs:
Can a USER of Aegis see/use the new thing?
  YES → feat:
  NO  → refactor: or fix: or chore:
```

---

## Scope (optional but useful)

Add scope in parentheses for context:
```
fix(api): ...
fix(security): ...
fix(terminal): ...
perf(cache): ...
refactor(types): ...
```

---

## Examples from this codebase

```
✅ fix: replace unsafe (e as Error).message with instanceof guard
✅ fix(security): add rate limiting for batch session creation
✅ refactor: eliminate duplicate /v1 and unversioned route handlers
✅ perf: add shared tmux capture-pane cache to deduplicate reads
✅ ci: add bundle size check to CI pipeline
✅ fix(type-safety): replace non-null assertion with typeof guard

❌ feat(resilience): add structured error categorization  (this bumped minor — wrong)
```

---

## The impact

Every `feat:` you write triggers a **minor version bump** in the next release.
- 10 `fix:` in a week → one release, patch bump (2.4.1 → 2.4.2) ✅
- 1 `feat:` in a week → one release, minor bump (2.4.x → 2.5.0) ⚠️

We went from v2.0.0 to v2.4.0 in 48 hours because `feat:` was used too liberally.
Be conservative. When in doubt → `fix:` or `refactor:`.
