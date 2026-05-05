# 01 — Architecture & Core Systems Review

**Date:** 2026-04-23 | **Scope:** `src/server.ts`, `src/session.ts`, `src/tmux.ts`, `src/pipeline.ts`, `src/config.ts`, `src/monitor.ts`, `src/terminal-parser.ts`, `src/startup.ts`, `src/shutdown-utils.ts`, `src/session-cleanup.ts`, `src/swarm-monitor.ts`, `src/worktree-lookup.ts`, `src/continuation-pointer.ts`, `src/handshake.ts`, `src/process-utils.ts`, `src/mcp/`, `src/services/state/`

---

## 1. Architecture Overview

Aegis is a **single-process, single-node** Node.js application structured as:

```
HTTP Client
    │
    ▼
server.ts (Fastify ~2300 lines — God file)
    ├── session.ts ─── tmux.ts (global serialize queue)
    │       └── terminal-parser.ts
    ├── monitor.ts ─── session.ts, channels, eventBus
    │       └── jsonl-watcher.ts
    ├── pipeline.ts ──► session.ts (batch / DAG)
    └── swarm-monitor.ts ──► tmux (separate socket)
```

### Module Responsibility Map

| Module | Role |
|--------|------|
| `server.ts` | Fastify HTTP API — all routes, auth middleware, rate limiting, reaper timers, graceful shutdown, `main()` |
| `session.ts` | Session lifecycle: create → persist → discover → poll → cleanup |
| `tmux.ts` | Low-level tmux CLI wrapper; global serialize queue; window creation; env injection |
| `monitor.ts` | Background poll loop; stall detection; stop-signal watcher; JSONL watcher bridge |
| `pipeline.ts` | Batch session creation; DAG-based pipeline orchestration |
| `config.ts` | Config loading with AEGIS_*/MANUS_* env override; defaults |
| `terminal-parser.ts` | Regex-based UI state detection from raw tmux pane captures |
| `startup.ts` | PID file; EADDRINUSE recovery with stale-process kill |
| `shutdown-utils.ts` | Parse shutdown timeout; detect Windows shutdown message |
| `session-cleanup.ts` | Thin helper: delegates to monitor/metrics/toolRegistry |
| `swarm-monitor.ts` | Scans tmux swarm sockets for CC teammate windows |
| `worktree-lookup.ts` | Multi-dir JSONL fanout for worktree setups |
| `continuation-pointer.ts` | TTL-aware session_map.json reader/writer |
| `handshake.ts` | Protocol version + capability negotiation |
| `process-utils.ts` | Cross-platform PID-on-port and parent-PID lookup |

---

## 2. Session Lifecycle

### Create Flow
1. `POST /v1/sessions` → `createSessionHandler` (server.ts)
2. Validate workDir; check CC version; reuse idle session if found (mutex-guarded)
3. `sessions.createSession()` → validate env vars → generate `hookSecret` → write hook settings → call `tmux.createWindow()`
4. `tmux.createWindow()`: serialized queue → resolve unique window name → create window → inject env → archive stale `.jsonl` files → launch `claude --session-id <uuid>` → poll until pane command changes from shell
5. Write `SessionInfo` to in-memory state → `save()` (queued atomic rename) → start discovery polling

### Discover Flow
- `startDiscoveryPolling`: fast-path via `session_map.json` (written by hook); filesystem scan fallback; worktree fanout option
- Once `claudeSessionId` and `jsonlPath` known → `jsonlWatcher.watch()` for near-real-time detection

### Monitor Flow
- `SessionMonitor.loop()`: adaptive poll (30s or 5s if hooks quiet) → `checkSession()` → `detectUIState(paneText)` → stall checks → dead-window checks → tmux health check
- 5 stall types: JSONL stall, permission stall, unknown stall, extended-state stall, extended-working stall

### Cleanup
- `killSession()` → `tmux.killWindow()` → `delete this.state.sessions[id]` → `save()`  
- `cleanupTerminatedSessionState()`: delegates to `monitor.removeSession()`, `metrics.cleanupSession()`, `toolRegistry.cleanupSession()`

---

## 3. Concurrency Model

### What Is Serialized

| Mechanism | Scope | Location |
|-----------|-------|----------|
| `TmuxManager.serialize()` promise chain | All tmux CLI calls (global) | `tmux.ts` |
| `SessionManager.saveQueue` promise chain | All disk writes to `state.json` | `session.ts` |
| `sessionAcquireMutex` (async-mutex) | `findIdleSessionByWorkDir` — session reuse TOCTOU guard | `session.ts` |
| `saveDebounceTimer` | Coalesces rapid offset-only saves (5s) | `session.ts` |

### Race Conditions & Gaps

**[C-1] Unsynchronized in-memory state mutations.** All `this.state.sessions[id]` field mutations (status, offsets, subagents, etc.) happen directly on the shared object without any lock. Concurrent HTTP requests (`/approve` and `/kill` for the same session) can interleave. The `saveQueue` only serializes disk I/O, not memory mutations.

**[C-2] `lastCleanupTime` and `lastCleanupWorkDir` are module globals.** Two sessions with different `workDir`s created within the 30-second TTL window — the second workDir skips hook cleanup, potentially leaving stale hooks.

```typescript
// session.ts — single global, not per-workDir
let lastCleanupTime = 0;
let lastCleanupWorkDir = '';
```

**[C-3] `listSessions()` cache hands out the mutable internal array.** Any caller holding the reference past the next mutation sees a stale snapshot.

**[C-4] Pipeline stage-completion relies only on `session.status === 'idle'`.** A stage session that crashes, errors, or stalls never transitions to `idle`, blocking the pipeline permanently with no timeout.

---

## 4. Pipeline & Consensus

### Pipeline

- `PipelineManager.createPipeline()` validates dependency graph with cycle-detection (DFS) — correctly implemented.
- `advancePipeline()` starts sessions whose dependencies are met. Uses `retryWithJitter` for session creation — good.
- Polling every 5s via `setInterval`. Completed/failed pipelines cleaned up after 30s.

**[P-1] No stage timeout.** A `running` stage with a crashed/stalled session blocks the pipeline forever. No `stageTimeoutMs` field; no escalation path.

**[P-2] `transitionPipelineStage()` has no version guard against concurrent `pollPipelines()` calls.** Two consecutive `setInterval` fires before the first resolves can double-advance state.

**[P-3] `PipelineManager` has no persistence.** *(RESOLVED in v0.3.3 — pipeline state is now persisted to disk and restored on restart. See PR #1585.)*

### Consensus

> **[RESOLVED]** Consensus Review feature was removed in v0.3.3 — it was aspirational middleware that never worked correctly. See PR #1583.

---

## 5. Configuration Surface

### Complete AEGIS_* Env Var Inventory

| Env Var | Default | Notes |
|---------|---------|-------|
| `AEGIS_PORT` | `9100` | |
| `AEGIS_HOST` | `127.0.0.1` | |
| `AEGIS_AUTH_TOKEN` | `''` (no auth) | Master token |
| `AEGIS_TMUX_SESSION` | `'aegis'` | |
| `AEGIS_STATE_DIR` | `~/.aegis` | |
| `AEGIS_CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | |
| `AEGIS_MAX_SESSION_AGE_MS` | `7200000` (2h) | |
| `AEGIS_REAPER_INTERVAL_MS` | `300000` (5m) | |
| `AEGIS_CONTINUATION_POINTER_TTL_MS` | `86400000` (24h) | |
| `AEGIS_TG_TOKEN` | `''` | Telegram |
| `AEGIS_TG_GROUP` | `''` | |
| `AEGIS_TG_ALLOWED_USERS` | `[]` | |
| `AEGIS_TG_TOPIC_TTL_MS` | `86400000` | |
| `AEGIS_WEBHOOKS` | `[]` | |
| `AEGIS_SSE_MAX_CONNECTIONS` | `100` | |
| `AEGIS_SSE_MAX_PER_IP` | `10` | |
| `CLAUDE_STREAM_IDLE_TIMEOUT_MS` | none | Feeds `computeStallThreshold()` |

### Configuration Gaps

**[CFG-1] `MAX_CONCURRENT_SESSIONS = 200` is a hardcoded magic number** in `server.ts`. Not in `Config`, cannot be set via env var, no comment tracking its origin.

**[CFG-2] `ZOMBIE_REAP_DELAY_MS` / `ZOMBIE_REAP_INTERVAL_MS` use raw `parseIntSafe`** from unguarded env vars with `ZOMBIE_` prefix — not in the `Config` interface, not documented.

**[CFG-3] `defaultPermissionMode` accepts any string.** No Zod `.enum()` constraint — an invalid value (e.g., `"yolo"`) is silently passed to `claude --permission-mode yolo`.


**[CFG-4] `CORS_ORIGIN` wildcard rejection happens at runtime** after partial initialization (channels, auth, sessions may already be starting).

**[CFG-5] `TRUST_PROXY` must be the exact string `"true"` — typos silently disable it.**

---

## 6. Critical Enterprise Deficiencies

### 6.1 Missing Retry / Graceful Degradation

**[E-1] No retry on `sendMessage` / `sendKeys`.** After the initial prompt retry loop (with 2 retries), subsequent `sendMessage` calls have zero retry logic. A transient tmux CLI hiccup silently loses the message.

**[E-2] Monitor loop exception swallowing.** Individual `checkSession()` calls are caught by `suppressedCatch` which suppresses errors entirely — a consistently failing session will never surface in logs.

**[E-3] `runVerification()` has no overall timeout.** A hanging test suite holds the HTTP request open indefinitely, potentially blocking Fastify's connection pool.

**[E-4] `listenWithRetry` has `maxRetries = 1`.** On EADDRINUSE it tries once to kill the stale process, then throws. In containerized restart scenarios, insufficient.

### 6.2 Graceful Shutdown Gaps

**[S-1] `jsonlWatcher` left open.** `fs.watch` handles are never explicitly released on SIGTERM/SIGINT.

**[S-2] `PipelineManager.destroy()` is never called during shutdown.** The polling `setInterval` remains active until `process.exit(0)`.

**[S-3] `SwarmMonitor.stop()` is called but in-flight scan promises are not awaited.** Any in-flight scan generates spurious errors against a departed tmux session.

**[S-4] `MemoryBridge.stopReaper()` is not called during shutdown.** Its internal reaper interval is never cleared in `gracefulShutdown()`.

### 6.3 Session Isolation Gaps

**[I-1] `hookSettingsFile` written to `workDir/.claude/settings.local.json`.** Multiple sessions for the same `workDir` can stomp each other's settings file.

**[I-2] `permissionGuard` patches the same `settings.local.json` per workDir without locking.** Concurrent sessions in the same workDir can corrupt each other's settings patches.

**[I-3] Session env vars are not stored in `SessionInfo`.** After a server restart and reconcile, adopted sessions have no env context — operators cannot inspect what env was used.

**[I-4] `archiveStaleSessionFiles()` races with the new session starting.** For concurrent `createWindow()` calls to the same `workDir`, the second archival hits a directory partially populated by the first session.

### 6.4 tmux Dependency Risks

**[T-1] `tmuxShellBatch` uses POSIX `sh` — fails on Windows.** `tmux.ts` has Windows-aware helpers but `tmuxShellBatch` does not.

**[T-2] Single tmux socket per Aegis process.** A tmux server crash affects every session simultaneously.

**[T-3] `TMUX_DEFAULT_TIMEOUT_MS = 10_000` is global for all commands.** A slow `capture-pane` on a large pane blocks the serialize queue for up to 10 seconds — stalling all concurrent session operations.

**[T-4] `paneCommand` heuristic is fragile.** If CC is launched via a shell wrapper or alias, `paneCommand` may remain a shell name indefinitely, causing spurious "Claude may not have started" warnings.

---

## 7. Scalability Assessment

**[SC-1] Single-process, single-node (default). Optional Redis-backed state store for horizontal scaling.** Default mode: single-node, in-process + flat JSON file. Optional: enable `AEGIS_STATE_STORE=redis` for Redis-backed session state, enabling multi-node deployments with shared state. Redis hash keys: `aegis:session:<id>`. Single-node file-based storage remains the default.

**[SC-2] No state persistence for transient objects.** Rate-limit buckets, SSE subscriptions, and tool registry are ephemeral. Pipeline state is persisted to disk and restored on restart (v0.3.3).

**[SC-3] All monitor polling runs serially in a single event loop.** With 200 sessions, each `poll()` runs `checkSession()` serially. Even with the 500ms TTL cache, at peak this is ~200 tmux calls per 5-second cycle.

**[SC-4] `sessions.listSessions()` is O(n)** on every API request needing pagination. No index.

**[SC-5] Rate-limit state is in-memory only.** Behind a load balancer with multiple instances, limits are per-instance, not global.

**[SC-6] Transcript reads JSONL from `byteOffset` on every request.** For long-running sessions with large transcripts, this means frequent file I/O with no streaming parser.

---

## 8. Memory Concerns

**[M-1] `TmuxCaptureCache` has no eviction loop.** Dead sessions' entries remain in the map indefinitely. With many short-lived sessions, the map grows without bound.

**[M-2] `authFailLimits` filter is O(n) per failure.** Allocates a new array on every auth check call.

**[M-3] `ipRateLimits` eviction is O(n).** When the map exceeds `MAX_IP_ENTRIES`, the eviction loop iterates the full map to find the oldest entry — O(n) per insertion at capacity.

**[M-4] `parsedEntriesCache` per session.** Capped at `MAX_CACHE_ENTRIES_PER_SESSION = 10_000` per session. With 200 sessions at capacity, that is 2,000,000 cached entries — potentially gigabytes.

**[M-5] `processedStopSignals` prune is O(n).** `[...this.processedStopSignals].slice(0, toRemove)` spreads the entire Set into an array on cleanup — runs every 30 seconds.

---

## 9. Code Quality Issues

**[Q-1] `server.ts` is ~2300 lines** — contains HTTP setup, auth middleware, rate limiting, all 50+ route handlers, reaper timers, graceful shutdown, channel wiring, plugin registration, and `main()`. This makes the file untestable as a unit.

**[Q-2] `addActionHints()` returns `Record<string, unknown>`.** Loses `SessionInfo` typing at all call sites.

**[Q-3] `(config as { verificationProtocol?: {...} })` cast in `server.ts`.** Implies the type is incomplete.

**[Q-4] Package naming mismatch.** `package.json` has `name: "aegis-bridge"` and `bin: { "aegis-bridge": "dist/cli.js" }`. `CLAUDE.md` states the package name is `@onestepat4time/aegis` and the CLI binary is `aegis`. Published consumers would get `aegis-bridge` command, not `aegis`.

**[Q-5] `@tanstack/react-virtual` is in production `dependencies`.** A React virtual-list component used only in the dashboard frontend increases the npm install footprint for server-only deployments.

---

## 10. Summary — Architecture Findings

| ID | Severity | Finding |
|----|----------|---------|
| CON-1 | ✅ RESOLVED | Consensus Review removed — was aspirational, never worked (v0.3.3, PR #1583) |
| P-3 | ✅ RESOLVED | Pipeline state now persisted to disk and restored on restart (v0.3.3, PR #1585) |
| SC-1 | ✅ RESOLVED | Redis-backed state store enables horizontal scaling via `AEGIS_STATE_STORE=redis` (v0.6, PR #2133) |
| C-1 | 🟠 MEDIUM | In-memory state mutations unsynchronized — concurrent request races |
| P-1 | ✅ RESOLVED | Pipeline stage timeout now configurable via `AEGIS_DEFAULT_STAGE_TIMEOUT_MS` (v0.3.3, PR #1606) |
| S-1–S-4 | 🟠 MEDIUM | Graceful shutdown gaps (jsonlWatcher, PipelineManager, MemoryBridge) |
| I-1–I-4 | 🟠 MEDIUM | Session isolation gaps for same-workDir sessions |
| M-1–M-5 | 🟡 LOW-MEDIUM | Memory growth: TmuxCaptureCache, ipRateLimits O(n), parsedEntriesCache |
| CFG-1–CFG-5 | 🟡 LOW-MEDIUM | Configuration gaps: undocumented limits, weak validation |
| T-1–T-4 | 🟡 LOW-MEDIUM | tmux fragility: shell-batch POSIX-only, single socket, global timeout |
| Q-1–Q-5 | 🟡 LOW | Code quality: god-file, type casts, naming mismatch |
