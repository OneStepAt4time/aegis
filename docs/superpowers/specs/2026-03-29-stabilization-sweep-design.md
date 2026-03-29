# Stabilization Sweep Design

**Date:** 2026-03-29
**Status:** Draft
**Scope:** 11 issues (7 critical + 3 build warnings + 1 dependabot PR)
**Approach:** Thematic clusters — 4 PRs grouped by root cause

## Context

22 issues were closed in the last 24 hours across security, bugs, MCP, and infrastructure. Analysis revealed systemic patterns:

1. **Input validation is inconsistent** — path traversal, XSS, and missing Zod schemas were fixed individually but the root cause (no systematic validation at API boundaries) persists. Issue #506 captures this.
2. **Race conditions in async lifecycle** — tmux naming (#403), memory leaks (#405), crash detection (#390) were fixed, but auth/lifecycle races remain (#503, #505).
3. **Error handling returns false positives** — DELETE 200 for non-existent sessions, POST null id for bad workDir. The API favors "don't crash" over "tell the caller."
4. **Infrastructure gaps allowed bugs to ship** — no version alignment guardrails, leading to TS/Vitest conflicts (#521, #522).
5. **Sync I/O blocks the CC event loop** — hook.ts uses readFileSync/writeFileSync.

## Cluster 1: Version Alignment & Build Health

**Issues:** #521, #522, #523, #524, #525, dependabot Zod PR

**Goal:** Make the monorepo build consistently across root and dashboard.

### Changes

- Align TypeScript to 6.0.2 in `dashboard/package.json`
- Align Vitest to 4.x in `dashboard/package.json`
- Move `@types/dompurify` from `dependencies` to `devDependencies` in `dashboard/package.json`
- Update release workflow (`.github/workflows/release.yml`) to run dashboard tests before publishing
- For dependabot Zod 3→4 PR (#486): run `cd dashboard && npx vitest run` with Zod 4. If dashboard schemas break, update them to Zod 4 API (`.nonempty()` → `.min(1)`, etc.) then merge. If the scope of schema changes is too large, close the PR and pin Zod 3 across both packages.

### Verification

- `npx tsc --noEmit` passes at root
- `cd dashboard && npx tsc --noEmit` passes
- `npm test` passes at root
- `cd dashboard && npx vitest run` passes
- `npm run build` succeeds

### Risks

- Zod 4 has breaking schema API changes (`.nonempty()` removed, `.refine()` behavior changed). Dashboard schemas may need updates.
- Vitest 3→4 may have test runner differences that break existing dashboard tests.

## Cluster 2: Input Validation & Type Safety

**Issues:** #506, #508

**Goal:** Systematic input validation at all external boundaries. No more whack-a-mole.

### Changes

1. **Audit all `JSON.parse` calls in `src/`:**
   - Categorize each: external boundary (API input, file reads, tmux output) vs. internal trusted data
   - Wrap every external-boundary parse with Zod schema validation
   - Internal trusted data can remain as-is (no over-engineering)

2. **Replace `catch (e: any)` with typed catches:**
   - Use `catch (e: unknown)` everywhere
   - Add type guards for known error types (ZodError, SystemError, etc.)
   - In `pipeline.ts` catch blocks specifically (issue #508)

3. **Add malformed-input test suite:**
   - Test each API endpoint returns 400 for malformed JSON bodies
   - Test each endpoint returns appropriate error codes for invalid field values
   - Test that no endpoint returns 200 with null/undefined for invalid inputs

### Verification

- All existing tests pass
- New malformed-input tests pass
- `grep -r "JSON.parse" src/` shows no unschemad external-boundary parses
- `grep -r "catch.*e.*any" src/` returns zero matches

### Files to modify

- `src/validation.ts` — add missing schemas
- `src/server.ts` — apply schemas at route handlers
- `src/pipeline.ts` — fix catch blocks
- `src/session.ts` — wrap file-read JSON.parse calls
- `src/transcript.ts` — wrap JSONL line parsing
- New test file: `src/__tests__/api-input-validation.test.ts`

## Cluster 3: Auth & Session Lifecycle Races

**Issues:** #503, #505

**Goal:** Auth failures are loud, not silent. Tokens never appear in URLs.

### Changes

1. **#503 — WebSocket auth token in URL:**
   - Remove token from WebSocket URL query parameter
   - Implement auth via first-message handshake: client connects, then sends `{ type: "auth", token: "..." }` as the first message. Server drops the connection if auth fails or times out (5s). This approach is preferred over subprotocol headers because it works with all WebSocket clients and doesn't leak tokens in HTTP headers that proxies may log.
   - Update `ws-terminal.ts` and dashboard `resilient-websocket.ts`

2. **#505 — SSE subscription silent failure:**
   - When SSE token creation fails in `events.ts`, return HTTP 500 (or 503) instead of creating a no-op subscription
   - Add logging at error level for the failure
   - Add test verifying the error response

### Verification

- WebSocket connection with invalid token is rejected
- WebSocket connection with no auth message within timeout is dropped
- SSE subscription returns error when token creation fails
- No token appears in any URL (grep test)

### Files to modify

- `src/ws-terminal.ts` — handshake auth
- `src/events.ts` — error propagation on token failure
- `dashboard/src/api/resilient-websocket.ts` — client-side handshake
- Test files for both modules

## Cluster 4: Sync I/O Blocking

**Issues:** #507

**Goal:** hook.ts never blocks the CC event loop.

### Changes

- Convert `hook.ts` from `fs` sync methods to `fs/promises` async methods
- Add proper error handling with non-zero exit codes on failure
- Add timeout wrapper: if hook takes longer than 5s, abort and exit with code 1
- Ensure the hook script remains a standalone Node script (no imports from the main aegis codebase)

### Verification

- Hook completes in <100ms for typical operations (no file contention)
- Hook exits with code 1 on file-not-found, permission denied, etc.
- Hook exits with code 1 if timeout is reached
- CC event loop is not measurably blocked during hook execution

### Files to modify

- `src/hook.ts` — async rewrite
- `src/__tests__/hook.test.ts` — add timeout and error-path tests

## Execution Order

```
Cluster 1 (build health)  →  blocks everything
    ↓
Cluster 2 (validation)    →  can run in parallel with 3 and 4
Cluster 3 (auth races)    →  can run in parallel with 2 and 4
Cluster 4 (sync I/O)      →  can run in parallel with 2 and 3
```

Cluster 1 must land first because version conflicts can mask type errors that the validation fixes depend on catching. Clusters 2-4 are independent and can be parallelized.

## Out of Scope

- 18 warning-level issues (unbounded caches, debounce ghosts, CORS wildcard, etc.)
- Feature work (Docker isolation, cost tracking, session persistence)
- MCP polish for 1.0
- Branch cleanup (~100 stale remote branches)
- Documentation (#450, #452)
- Dashboard UX redesign (#469)
