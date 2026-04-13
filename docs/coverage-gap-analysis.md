# Coverage Gap Analysis — #1755

**Issue:** Remove vitest exclusions for `server.ts`, `session.ts`, `tmux.ts` and add minimum viable tests.

**Status:** These files are NOT explicitly excluded from coverage — they're measured but have very low coverage because they require full integration (tmux, HTTP server, etc.). The 70% threshold passes by averaging against well-covered utility modules.

---

## 1. `src/server.ts` — 1102 lines

**What it does:** Main entry point. Wires together Fastify server, session manager, tmux, channels, auth, monitoring.

### Coverage gaps

| Area | Lines | Test Status | What's Missing |
|------|-------|-------------|---------------|
| `main()` function | ~500 | **0%** | Full integration boot test (needs real tmux + config) |
| Auth helpers (`checkIpRateLimit`, `recordAuthFailure`, etc.) | ~30 | **0%** | Rate limit logic not exercised |
| Channel registration (`registerChannels`) | ~40 | **0%** | No channel initialization tests |
| Session reapers (`reapStaleSessions`, `reapZombieSessions`) | ~60 | **0%** | Timer-based cleanup never tested |
| `handleInbound` | ~100 | **0%** | Inbound command processing untested |

### Recommended approach
- Integration test: start server with test config, verify reapers fire on schedule
- Unit test: extract auth helpers into testable pure functions, test in isolation
- Use `server-core-coverage.test.ts` pattern: inject Fastify server, make HTTP calls

---

## 2. `src/session.ts` — 1464 lines

**What it does:** `SessionManager` class — session lifecycle (create, kill, send, monitor). Core orchestration.

### Coverage gaps

| Area | Lines | Test Status | What's Missing |
|------|-------|-------------|---------------|
| `SessionManager` constructor | ~50 | **Partial** | DI wiring untested |
| `createSession()` path | ~150 | **Partial** | Happy path exists in `server-core-coverage.test.ts` |
| `killSession()` error path | ~30 | **0%** | Kill failure when tmux already dead |
| `escape()` | ~40 | **0%** | Ctrl+C escape flow |
| `submitAnswer()` (AskUserQuestion) | ~30 | **0%** | Answer resolution |
| `getLatencyMetrics()` | ~20 | **0%** | Latency collection |
| `getSummary()` | ~40 | **0%** | Summary generation from JSONL |

### Recommended approach
- `session.test.ts`: unit test SessionManager methods with mocked tmux + JSONL watcher
- `server-core-coverage.test.ts` already covers session creation — extend for kill, send, interrupt
- Mock `TmuxManager` and `JsonlWatcher` to isolate SessionManager logic

---

## 3. `src/tmux.ts` — 1010 lines

**What it does:** `TmuxManager` class — low-level tmux operations (create window, send-keys, capture pane, detect UI state).

### Coverage gaps

| Area | Lines | Test Status | What's Missing |
|------|-------|-------------|---------------|
| `createWindow()` | ~80 | **Partial** | Happy path in session tests |
| `sendKeys()` | ~30 | **0%** | Escape sequence handling |
| `capturePane()` | ~50 | **0%** | Partial capture, large pane handling |
| `detectUiState()` | ~100 | **Partial** | Only "working" state covered |
| `waitForPaneStabilize()` | ~40 | **0%** | Idle detection timeout |
| `getWindowList()` error path | ~20 | **0%** | tmux not running |
| `parseWindowListLine()` | ~30 | **0%** | Line parsing edge cases |

### Recommended approach
- `tmux.test.ts`: mock `child_process.spawn`, test tmux command generation
- Test `parseWindowListLine()` with various tmux output formats
- Test UI state detection with sample pane outputs

---

## Files Currently Excluded from Coverage

These ARE explicitly excluded (vitest.config.ts):

```
src/startup.ts
src/verification.ts
src/screenshot.ts
src/channels/email.ts
src/channels/telegram.ts
src/channels/slack.ts
src/channels/index.ts
```

These are intentionally excluded — screenshot needs Playwright, channels need external credentials. Not a priority.

---

## Priority Recommendations

1. **High**: Add `killSession` error path test (session.ts) — prevents silent failures
2. **High**: Add `escape()` test (session.ts) — used in production
3. **Medium**: Add `parseWindowListLine()` unit test (tmux.ts) — pure function, easy to test
4. **Medium**: Add UI state detection test with known pane outputs (tmux.ts)
5. **Low**: Session reaper timer tests — require clock mocking or waits

---

## Test Infrastructure Needed

- **Mock `child_process`**: tmux.ts spawns `tmux -S ...`. Need process mock.
- **Mock `JsonlWatcher`**: session.ts watches JSONL files
- **Fastify injection**: server.ts routes need server instance
- **Clock mocking**: reaper timers use `Date.now()`
