# 03 — Testing, CI & Observability Review

**Date:** 2026-04-08 | **Scope:** `src/__tests__/` (~130 files), CI workflows (13), `src/metrics.ts`, `src/logger.ts`, `src/diagnostics.ts`, `src/events.ts`, `src/sse-writer.ts`, `src/sse-limiter.ts`, `src/error-categories.ts`, `src/retry.ts`, `src/transcript.ts`, `src/jsonl-watcher.ts`, `src/memory-bridge.ts`, `src/memory-routes.ts`

---

## 1. Test Coverage Analysis

### 1.1 Module Coverage

The `src/__tests__/` directory contains ~130 test files covering ~50 TypeScript source modules.

| Tier | Example modules | Coverage |
|------|-----------------|---------|
| Heavily tested | `auth.ts`, `metrics.ts`, `events.ts`, `session.ts`, `tmux.ts`, `monitor.ts`, `permission-*.ts`, `sse-*.ts` | 5–7 test files each |
| Well tested (1–2 files) | `error-categories.ts`, `retry.ts`, `transcript.ts`, `jsonl-watcher.ts`, `memory-bridge.ts`, `pipeline.ts` | ✓ |
| Thin or no dedicated tests | `cli.ts`, `startup.ts`, `verification.ts`, `template-store.ts`, `model-router.ts` | ⚠️ |

**Untested modules:**
- `src/cli.ts` — no unit test; CLI argument parsing and startup wiring untested.
- `src/startup.ts` — no dedicated test; sequencing tested only via UAT smoke script.
- `src/verification.ts` — no dedicated test file; only tested indirectly through hook flows.
- `src/template-store.ts` — only a single edge-case file covers it.

### 1.2 Coverage Threshold — DANGEROUSLY LOW

```ts
// vitest.config.ts
thresholds: { lines: 50 },
```

A **50% line threshold** is the only configured dimension — no `branches`, `functions`, or `statements` thresholds. CI passes even if half the codebase is uncovered. Branch coverage is especially critical for error paths and edge cases.

**Recommendation:** Raise to `{ lines: 70, branches: 60, functions: 70 }` and track regressions.

### 1.3 Test Quality Assessment

Most tests are **unit-level with heavy mocking** — not true integration tests.

**Positive patterns observed:**
- Back-pressure in SSE (3-failure destroy logic) ✓
- Event ID overflow guard (`Number.MAX_SAFE_INTEGER` reset) ✓
- TOCTOU fix in `readNewEntries` (single `fd` for stat + read) ✓
- Permission timer cleanup on session kill ✓
- Debounce coalescing in `JsonlWatcher` ✓
- Race conditions in session creation (mutex tests) ✓
- Real file I/O in `jsonl-watcher.test.ts` and `memory-bridge.test.ts` ✓

**Critical gaps:**
- `integration/session-lifecycle.test.ts` builds a **hand-rolled Fastify mock** — it does not exercise `session.ts`, `tmux.ts`, or any real route handler. Tests only JS object manipulation. This is **not** integration testing.
- `integration/sse-events.test.ts` calls `reply.raw.end()` immediately — no actual streaming tested.
- No test for actual tmux session creation failure and recovery.
- No test for `fs.watch()` error recovery/reconnect (watcher stops on error, never restarts — this behavior is untested).
- No test for token cost calculation with unrecognized model names.
- `avg_duration_sec: 0` is hardcoded in `getGlobalMetrics` — a metrics bug not caught by any test.

---

## 2. CI/CD Pipeline

### 2.1 Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PRs/pushes to `main`/`develop` | Primary quality gate |
| `codeql.yml` | Push/PR to `main`, weekly | SAST security scanning |
| `release.yml` | Tags `v*` | Build, test, publish, SBOM |
| `release-please.yml` | Push to `main` | Automated release PRs |
| `graduation-check.yml` | Weekly Mon 06:00 | Phase graduation assessment |
| `ci-failure-alert.yml` | CI completion on `main` | Discord alert on failure |
| `discord-notify.yml` | Stars, issues, PRs | Community notifications |
| `rollback.yml` | Manual dispatch | Revert tooling |
| `stale.yml`, `auto-label.yml`, `auto-triage.yml`, `issue-state-sync.yml` | GitHub events | Project management |
| `pages.yml` | — | Docs deployment |

### 2.2 Quality Gates Enforced

**Positive (enforced on PRs):**
- `npm audit --audit-level=high` ✓
- `lockfile-lint --validate-https` ✓
- `npx tsc --noEmit` ✓
- `npm run build` ✓
- Bundle size threshold (2048 KB on `dist/*.js`) ✓
- UAT smoke (spawns real Aegis process, hits `/v1/health`) ✓
- `vitest run --coverage` ✓
- Semantic PR title enforcement ✓
- `feat:` minor-bump gate (blocks without `approved-minor-bump` label) ✓

### 2.3 CI Gaps

**[CI-1] CodeQL runs only on `main`, not `develop`.** The main development branch has no static security scanning. A security vulnerability introduced in a feature branch and merged to `develop` will not be scanned until it reaches `main`.

**[CI-2] `develop` PRs validated on ubuntu-only.** Full matrix (ubuntu + windows + macOS, Node 20 + 22) runs only on `main`. **A PR on `develop` is never validated on macOS or Windows before merge.** Platform-specific regressions are only discovered post-merge to `main`.

**[CI-3] No coverage enforcement on `develop`.** Coverage artifacts are only uploaded; no threshold failure blocks the PR.

**[CI-4] Bundle size check is Linux-only** (`if: runner.os != 'Windows'`) — no Windows/macOS bundle size validation.

**[CI-5] No dependency vulnerability workflow.** Dependabot is not configured; Snyk/Socket not present. `npm audit` catches known CVEs but provides no proactive upgrade alerting.

**[CI-6] No DAST (Dynamic Application Security Testing).** No automated fuzzing or API security scanning.

**[CI-7] No performance/regression testing.** Latency budgets exist in the metrics model (p50/p95 tracking capacity), but no CI step measures or gates on them.

**[CI-8] SBOM generated only on release tags,** not on PRs. Component inventory not continuously maintained.

**[CI-9] `package.json` `"name"` is `"aegis-bridge"`.** `CLAUDE.md` states package name is `@onestepat4time/aegis` and CLI binary is `aegis`. This discrepancy means the published npm package identity documented in `CLAUDE.md` does not match the actual `package.json`.

---

## 3. Observability

### 3.1 Metrics (`src/metrics.ts`)

**What is tracked:**

| Dimension | Fields |
|-----------|--------|
| Global counters | `sessionsCreated/Completed/Failed`, `totalMessages`, `totalToolCalls`, `autoApprovals`, `webhooksSent/Failed`, `screenshotsTaken`, `pipelinesCreated`, `batchesCreated`, `promptsSent/Delivered/Failed` |
| Per-session | `messages`, `toolCalls`, `approvals`, `autoApprovals`, `statusChanges[]`, `tokenUsage` (input/output/cache tokens + estimated USD cost) |
| Latency (per-session, rolling 100 samples) | `hook_latency_ms`, `state_change_detection_ms`, `permission_response_ms`, `channel_delivery_ms` |

**Positive:**
- Token cost estimation with per-model pricing (haiku/sonnet/opus tiers).
- Rolling window latency with min/max/avg aggregation.
- Disk persistence of global counters on save/shutdown.
- `cleanupSession()` removes per-session data on kill.

**Critical gaps:**

**[OBS-1] No Prometheus exposition format.** Metrics exposed only via `/v1/health` (summary) and presumably `/v1/metrics` (JSON). No `text/plain; version=0.0.4` scrape endpoint. Prometheus, Grafana, and virtually all APM tooling cannot scrape Aegis directly.

**[OBS-2] No cardinality/labels.** Counters are bare integers. No session-level labels, no per-model breakdown, no per-endpoint breakdown. Impossible to trace which session or model drove metric changes.

**[OBS-3] No percentile tracking.** Only min/max/avg stored for latency. p50/p95/p99 requires histogram buckets — these don't exist.

**[OBS-4] `avg_duration_sec` is hardcoded to `0`** in `getGlobalMetrics`. Session duration is tracked but never aggregated. This is an active data quality bug that misleads any consumer of the health endpoint.

**[OBS-5] Cost model is stale.** Only `haiku`, `sonnet`, `opus` tiers. Claude 3.5 Sonnet, Claude 3.7 Sonnet, and other recently released models fall through to a silent `sonnet` default — producing incorrect cost estimates.

**[OBS-6] Per-session metrics are not persisted.** Only global counters survive a restart. Token usage tracking, per-session latency, and status change history are lost on process restart.

### 3.2 Logging (`src/logger.ts` + `src/diagnostics.ts`)

**Positive:**
- Structured JSON output — machine-parseable.
- Pluggable sink interface (`setStructuredLogSink`) for test overriding.
- PII redaction in `DiagnosticsBus` via `sanitizeDiagnosticsAttributes` — forbidden key fragments include `token`, `password`, `secret`, `auth`, `prompt`, `transcript`, `payload`, `workdir`.
- Bounded in-memory buffer (100 events) in `DiagnosticsBus`.

**Gaps:**

**[OBS-7] No request/correlation ID.** `StructuredLogRecord` has no `requestId`, `traceId`, or `spanId`. Correlating logs for a single API call across components is impossible.

**[OBS-8] No `debug` level.** Only `info`, `warn`, `error`. Verbose diagnostic detail cannot be toggled at runtime.

**[OBS-9] No child logger / context propagation.** Every call to `logger.info()` must manually pass `component`, `operation`, `sessionId`. No scoped child logger to carry fixed fields.

**[OBS-10] DiagnosticsBus buffer is 100 events.** On a moderately active server (10 sessions at 1 event/sec), this buffer fills in ~10 seconds. Backends polling `/v1/diagnostics` at >10s intervals permanently miss events.

**[OBS-11] No log shipping integration.** Logs go to stdout only. No Fluentd, Loki, CloudWatch, or structured log forwarding hooks.

**[OBS-12] `workdir` is in the forbidden list** — `workDir` attributes in log records are stripped. This makes debugging filesystem issues harder than intended.

### 3.3 SSE Event System (`src/events.ts`)

**Event types emitted per-session:**  
`status`, `message`, `system`, `approval`, `ended`, `heartbeat`, `stall`, `dead`, `hook`, `subagent_start`, `subagent_stop`, `verification`, `permission_denied`

**Global events:**  
`session_status_change`, `session_message`, `session_approval`, `session_ended`, `session_created`, `session_stall`, `session_dead`, `session_subagent_start`, `session_subagent_stop`, `session_verification`

**Positive:**
- Incrementing event IDs for `Last-Event-ID` replay ✓
- Ring buffer (50 events per session) for reconnect replay ✓
- LRU eviction of session buffers at 10,000 session cap ✓
- `emittedAt` timestamp on every event ✓
- Overflow guard for ID counter at `Number.MAX_SAFE_INTEGER` ✓

**Gaps:**

**[OBS-13] No message persistence.** Server restart loses all buffered events. Clients reconnecting after a restart cannot replay missed events.

**[OBS-14] `hook` events map to `session_message` in global stream.** Global-stream consumers cannot distinguish hook lifecycle events from content messages without inspecting `data`.

**[OBS-15] 50-event ring buffer is very small** for long-running sessions. A session with a 5-minute coding task at 1 event/sec evicts all events before a slow client can reconnect.

### 3.4 Distributed Tracing — ABSENT

No OpenTelemetry SDK, no Jaeger/Zipkin integration, no `traceparent` header extraction or propagation. Request flows through Fastify → `session.ts` → `tmux.ts` → `monitor.ts` cannot be correlated by a tracing backend.

### 3.5 Alerting

The only production alerting is `ci-failure-alert.yml` posting to Discord when CI on `main` fails. There is no:
- Alert on session failure rate exceeding a threshold
- Alert on tmux process crash
- Alert on API error rate spike
- PagerDuty/OpsGenie/Alertmanager integration

---

## 4. Error Handling System

### 4.1 `error-categories.ts` — Heuristic Classification

`categorize()` uses message-string pattern matching:

```ts
if (lower.includes('session not found') || lower.includes('no session with id')) { ... }
if (lower.includes('permission denied') || lower.includes('permission rejected')) { ... }
if (lower.includes('tmux')) { ... }
```

**[ERR-1] `SESSION_CREATE_FAILED` is dead code.** The enum member exists but no message pattern triggers it. Any session creation failure routes to `TMUX_ERROR` or `INTERNAL_ERROR`.

**[ERR-2] Heuristics are fragile.** A tmux error whose message includes `"invalid"` would be classified as `VALIDATION_ERROR` rather than `TMUX_ERROR` — `"invalid"` matches the validation branch before the tmux branch. Future tmux version changes silently re-categorize errors.

**[ERR-3] Non-Error primitives fall through to `INTERNAL_ERROR` (non-retryable).** If a library throws a plain string, it becomes `INTERNAL_ERROR` and is never retried, even if it should be.

### 4.2 `retry.ts` — Missing Defaults

```ts
export async function retryWithJitter<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T>
```

Design: 3 attempts, 250ms base, 3000ms cap, 50–100% jitter. Caller provides `shouldRetry`.

**[ERR-4] No default `shouldRetry`.** If a caller omits `shouldRetry`, every error retries up to `maxAttempts` — including auth failures and validation failures. Most callsites in the codebase rely on caller discipline alone with no linting enforcement.

**[ERR-5] No circuit breaker.** Repeated failures retry individually — no global failure counter to open a circuit and fail fast.

**[ERR-6] No `onRetry` hook used in most callsites.** Retry events are silent in production logs unless the caller wires `onRetry` manually.

### 4.3 Retry Policy Consistency

Some modules (webhook delivery, `WebhookChannel`) implement their own bespoke retry loops rather than using `retryWithJitter`. Integration with `error-categories.ts` is left to each caller. No CI-level enforcement of consistent retry policy.

---

## 5. Transcript & JSONL Pipeline

### 5.1 `transcript.ts`

**Positive:**
- `parseLine()` handles blank lines and non-JSON prefixes gracefully.
- `readNewEntries()` uses single `fd` for stat + read (TOCTOU fix).
- Backward scan to find newline boundary before reading.
- Truncation detection (`newOffset < previousOffset`).

**Memory concern:**

```ts
const chunks: Buffer[] = [];
const stream = createReadStream(filePath, { fd: fd.fd, start: effectiveOffset, autoClose: false });
stream.on('data', (chunk) => { chunks.push(chunk); });
stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
```

The **entire slice from `effectiveOffset` to EOF** is read into a single `Buffer.concat()` before any parsing. For a long-running session not polled for minutes, this can be megabytes. No chunk size limit or streaming parser exists.

**[TRANS-1] Malformed JSON lines are silently dropped** — logged to `console.error` but no event emitted, no metric incremented, no caller notification. Data loss is only visible in stderr.

### 5.2 `jsonl-watcher.ts`

**Positive:**
- `fs.watch()` replaces polling ✓
- 100ms debounce prevents duplicate reads on rapid writes ✓
- `rename` event handled (file deletion/rotation) ✓

**[TRANS-2] On `fsWatcher.on('error', ...)` the watcher stops and is never restarted.** A transient `EMFILE` or permission error permanently stops monitoring that session's JSONL file. No alert emitted, no metric incremented — the session goes dark with no observable signal.

---

## 6. Enterprise Observability Gaps

| Capability | Status | Notes |
|-----------|--------|-------|
| Structured JSON logging | ✅ Partial | stdout only; no shipping; 3 levels only |
| Request correlation IDs | ❌ Absent | No `requestId`/`traceId` in logs |
| Distributed tracing (OTel) | ❌ Absent | No spans, no W3C traceparent |
| Prometheus `/metrics` endpoint | ❌ Absent | JSON-only via REST API |
| Histogram / percentiles | ❌ Absent | Only min/max/avg |
| Real-time alerting | ❌ Absent | Only CI failure → Discord |
| Audit trail for auth events | ❌ Absent | No auth-failure audit log |
| Audit trail for permission decisions | ❌ Absent | No decision audit log |
| Log shipping integration | ❌ Absent | stdout only |
| SAST on develop branch | ❌ Absent | CodeQL only on `main` |
| Session failure alerts | ❌ Absent | No threshold-based alerting |
| Dead-letter queue visibility | ✅ Tested | `webhook-dlq.test.ts` exists |
| SBOM | ✅ Release-only | CycloneDX on tag publish |
| Per-session metrics persistence | ⚠️ Partial | Global counters only; per-session lost on restart |

---

## 7. Prioritised Testing & Observability Findings

| ID | Severity | Finding |
|----|----------|---------|
| OBS-1 | 🔴 HIGH | No Prometheus endpoint — APM tooling cannot scrape Aegis |
| CI-1 | 🔴 HIGH | CodeQL not running on `develop` — security regressions undetected until `main` |
| CI-2 | 🔴 HIGH | `develop` PRs not validated on macOS/Windows — platform regressions post-merge |
| OBS-4 | 🟠 MEDIUM | `avg_duration_sec` hardcoded to `0` — active data quality bug |
| OBS-7 | 🟠 MEDIUM | No request/correlation ID — impossible to trace single API call across components |
| TRANS-2 | 🟠 MEDIUM | `JsonlWatcher` stops on error and never restarts — session goes dark silently |
| ERR-4 | 🟠 MEDIUM | `retryWithJitter` has no default `shouldRetry` — auth failures retried inadvertently |
| OBS-3 | 🟠 MEDIUM | No percentile tracking — p50/p95/p99 impossible for SLO tracking |
| CI-3 | 🟠 MEDIUM | Coverage not enforced on `develop` PRs |
| TRANS-1 | 🟠 MEDIUM | Malformed JSONL silently dropped with no metric/event |
| OBS-5 | 🟡 LOW | Cost model missing Claude 3.5/3.7 model pricing |
| OBS-6 | 🟡 LOW | Per-session metrics lost on restart |
| OBS-13 | 🟡 LOW | SSE ring buffer (50 events) too small for long-running sessions |
| CI-9 | 🟡 LOW | `package.json` name/bin mismatch vs. CLAUDE.md |
| ERR-1 | 🟡 LOW | `SESSION_CREATE_FAILED` is dead code in `error-categories.ts` |
