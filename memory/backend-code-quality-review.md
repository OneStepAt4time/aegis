# Backend Code Quality Review — Aegis develop branch

**Date:** 2026-04-13 15:42 UTC
**Reviewer:** Hephaestus
**Branch:** develop (379e644)
**Method:** Manual analysis + grep-based scanning + Aegis CC session (transcript read failed — bug found)
**Note:** Aegis CC dogfooding blocked by tmux session issue (see Critical Finding #1)

---

## CRITICAL FINDINGS

### C1: Aegis reports tmux healthy but tmux session doesn't exist
- **Severity:** P0
- **File:** Server health check logic
- **Description:** `GET /health` reports `tmux: healthy: true` and 6 active sessions, but actual tmux only has 1 session (`0`). CC sessions are "ghost sessions" — they appear active in Aegis state but have no tmux backing. This means CC is writing to non-existent panes, transcripts return empty, and prompt delivery is silently failing.
- **Impact:** ALL dogfooding is broken. Session creation succeeds (returns 201) but CC never actually runs.
- **Fix:** Health check should verify tmux session existence with `tmux has-session -t <sessionName>`, not just check if the TmuxManager was initialized.

### C2: Transcript read returns 0 messages despite byteOffset advancing
- **Severity:** P0
- **File:** Transcript reading logic (likely `src/session.ts` or `src/tmux.ts`)
- **Description:** `GET /v1/sessions/:id/read` returns `{messages: []}` even though `byteOffset` is advancing (39785 bytes). The byte offset tracker increments but no messages are extracted.
- **Impact:** Cannot read CC output via API. Blocks all dogfooding workflows.
- **Fix:** Investigate the byteOffset → message parsing pipeline. Likely a parsing issue where Claude Code's output format changed.

### C3: 87 sync file operations blocking the event loop
- **Severity:** P1
- **Files:** Multiple (see scan results)
- **Description:** 87 calls to `writeFileSync`, `readFileSync`, `unlinkSync`, `renameSync`, `existsSync`, `statSync` across the codebase. These block the Node.js event loop during I/O operations.
- **Impact:** Under concurrent load, every sync operation stalls ALL other requests. For a server handling multiple sessions, this is a performance bottleneck.
- **Fix:** Replace with async equivalents (`fs.promises.writeFile`, `fs.promises.readFile`, etc.). Already identified in ready issues (#1643 — memory-bridge.ts sync ops).

### C4: 5 sync exec operations blocking the event loop
- **Severity:** P1
- **Files:** Multiple
- **Description:** 5 calls to `execFileSync`/`execSync`. These are even worse than sync file ops because they spawn child processes synchronously.
- **Fix:** Replace with `execFile` (async) or `child_process.exec` with proper error handling.

---

## HIGH FINDINGS

### H1: server.ts monolith — 2,691 lines
- **Severity:** P2
- **File:** `src/server.ts`
- **Description:** Single file with 2,691 lines containing all route definitions, middleware, and business logic. Violates single-responsibility principle. Already tracked as issue #1650.
- **Fix:** Decompose into Fastify route plugins (routes/sessions.ts, routes/pipelines.ts, etc.)

### H2: session.ts monolith — 1,904 lines
- **Severity:** P2
- **File:** `src/session.ts`
- **Description:** Single file with 1,904 lines. Second largest file.
- **Fix:** Extract session lifecycle, transcript parsing, and state management into separate modules.

### H3: tmux.ts — 1,042 lines
- **Severity:** P2
- **File:** `src/tmux.ts`
- **Description:** Single file with 1,042 lines. All tmux CLI wrapping in one place.
- **Fix:** Consider splitting into tmux-session.ts, tmux-capture.ts, tmux-env.ts.

### H4: 18 source files without tests
- **Severity:** P2
- **Files:** See list below
- **Description:** 18 of 79 source files (23%) have no corresponding test files.
- **Untested files:**
  - `src/channels/email.ts` — Email channel (no tests at all)
  - `src/channels/slack.ts` — Slack channel (no tests at all)
  - `src/services/auth/AuthManager.ts` — Core auth (no tests)
  - `src/services/auth/RateLimiter.ts` — Rate limiting (no tests)
  - `src/prometheus.ts` — Metrics endpoint (no tests)
  - `src/memory-routes.ts` — Memory API routes (no tests)
  - `src/permission-request-manager.ts` — Permission handling (no tests)
  - `src/api-contracts.ts` — API validation (no tests)
  - Plus 10 more (mostly types/index files)
- **Fix:** Prioritize tests for AuthManager, RateLimiter, and prometheus (critical paths).

### H5: 7 promises without .catch()
- **Severity:** P2
- **Description:** 7 `.then()` calls without corresponding `.catch()` or `.finally()`. Unhandled promise rejections can crash the process.
- **Fix:** Add `.catch()` handlers or convert to async/await with try/catch.

---

## MEDIUM FINDINGS

### M1: 42 empty catch blocks
- **Severity:** P3
- **Description:** 42 catch blocks that silently swallow errors. Some may be intentional (cleanup code), but many likely hide bugs.
- **Fix:** Audit each empty catch. At minimum, add `logger.debug` or `logger.warn` to make failures observable.

### M2: 7 non-null assertions (!.)
- **Severity:** P3
- **Files:** telegram.ts (3), ws-terminal.ts (2), evaluator.ts (1), memory-bridge.ts (1)
- **Description:** Non-null assertions bypass TypeScript's null safety. If the value is actually null/undefined, runtime crash.
- **Fix:** Replace with proper null checks or optional chaining.

### M3: 2 'as any' casts
- **Severity:** P3
- **Files:** config.ts, events.ts (in comments only)
- **Description:** Minimal usage. Both appear in JSDoc comments, not actual code.
- **Fix:** No action needed — these are documentation strings.

---

## SUMMARY

| Category | Count | Severity |
|----------|-------|----------|
| Critical (P0) | 2 | Aegis dogfooding broken, transcript read broken |
| High (P1) | 2 | Sync file/exec ops blocking event loop |
| High (P2) | 5 | Monolith files, untested critical paths |
| Medium (P3) | 3 | Empty catches, non-null assertions |

**Top priorities:**
1. **C1+C2:** Fix tmux health check and transcript read — without these, dogfooding is impossible
2. **C3+C4:** Replace sync file/exec ops — already tracked in ready issues (#1643, #1642)
3. **H4:** Add tests for AuthManager, RateLimiter, prometheus — critical untested code
4. **H1+H2+H3:** Decompose monolith files — tracked as #1650

**Positive notes:**
- Only 7 non-null assertions — excellent type safety discipline
- Only 2 `as any` casts (both in comments)
- 0 void async calls without await
- 61 of 79 source files (77%) have test coverage
