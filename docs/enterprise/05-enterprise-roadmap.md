# 05 — Enterprise Gap Roadmap

**Date:** 2026-04-08  
**Purpose:** Prioritised, executable backlog of all findings from the enterprise technical review. Items are grouped into milestones ordered by dependency and business impact.

---

## Milestone Overview

| Milestone | Theme | Approximate Scope |
|-----------|-------|------------------|
| **M-E1: Security Hardening** | Eliminate critical injection/bypass risks | 5–7 issues |
| **M-E2: Identity & Access** | RBAC, session ownership, key expiry | 6–8 issues |
| **M-E3: Observability** | Prometheus, tracing, alerting, audit log | 6–8 issues |
| **M-E4: Reliability** | Persistence, shutdown, consensus fix, retry policy | 6–8 issues |
| **M-E5: API & Integration** | OpenAPI, versioning, SDK, HMAC signing, missing channels | 5–7 issues |
| **M-E6: Dashboard & UX** | Login page, RBAC UI, audit trail UI, multi-tenant view | 4–6 issues |
| **M-E7: Scalability** | Horizontal scaling path, stateful session re-attach | 4–6 issues |

---

## M-E1 — Security Hardening 🔴

*Gate: All M-E1 issues must land before any enterprise deployment. These are blockers.*

### E1-1 — Env var injection denylist [SD-VAL-01] — HIGH

**Problem:** `CreateSessionRequest.env` accepts any key names, allowing override of `ANTHROPIC_API_KEY`, `PATH`, `LD_PRELOAD`, `HOME`, etc.  
**Fix:** Add a server-side denylist in `session.ts` / `server.ts` before env vars are injected into tmux.  
**File:** `src/session.ts` (env injection path), `src/validation.ts` (schema reinforcement)  
**Acceptance:** Attempt to create a session with `env: { "PATH": "/evil" }` → 400 rejected.

### E1-2 — Restrict `claudeCommand` field [SD-VAL-04, SD-INJ-03] — HIGH

**Problem:** `claudeCommand` accepts arbitrary strings up to 10,000 chars. If shell-spawned, this is RCE for any authenticated caller.  
**Fix:** Validate `claudeCommand` against a path-like regex forbidding shell metacharacters (`;&|$\`(){}`). OR remove the field and require the server's configured claude binary.  
**File:** `src/validation.ts`, `src/session.ts`  
**Acceptance:** Attempt `claudeCommand: "evil; rm -rf /"` → 400 rejected.

### E1-3 — Hook URL `?secret=` log redaction [SD-SEC-01] — MEDIUM

**Problem:** Fastify's URL redaction covers `token=` but not `secret=`. Hook secrets in query params appear in access logs.  
**Fix:** Extend the Fastify `serializers.req.url` redaction pattern to also strip `secret=<value>`.  
**File:** `src/server.ts` (serializer config)  
**Acceptance:** Confirm `secret=` is replaced with `secret=[REDACTED]` in Fastify access logs.

### E1-4 — `compareSemver` fail-closed [SD-VAL-05] — LOW

**Problem:** Unparseable CC version returns `0` (equal), silently passing minimum version checks.  
**Fix:** Return `-1` when either semver string is null, causing the check to fail.  
**File:** `src/validation.ts`  
**Acceptance:** `compareSemver(null, '1.0.0')` returns `-1`.

### E1-5 — Permission evaluator `realpath` [SD-PATH-01] — MEDIUM

**Problem:** `permission-evaluator.ts`'s `isPathAllowed()` uses `path.normalize()` but not `fs.realpath()`. Symlinks pointing outside the allowed prefix pass.  
**Fix:** Resolve symlinks with `fs.realpath()` before checking path prefix.  
**File:** `src/permission-evaluator.ts`  
**Acceptance:** A symlink `allowed_dir/link → /etc/passwd` is rejected by `isPathAllowed()`.

### E1-6 — `verification.ts` use `execFile` [SD-INJ-01] — MEDIUM

**Problem:** `verification.ts` uses `exec()` (shell-spawning) for `tsc/npm` commands — structurally fragile.  
**Fix:** Migrate to `execFile()` with array args.  
**File:** `src/verification.ts`  
**Acceptance:** TypeScript compiles; tests pass; no shell used.

### E1-7 — `hookBodySchema` strict mode [SD-VAL-03] — MEDIUM

**Problem:** `hookBodySchema` uses `.passthrough()`, forwarding unknown fields to all SSE subscribers.  
**Fix:** Remove `.passthrough()` and use `.strict()` or enumerate permitted extra fields explicitly.  
**File:** `src/validation.ts`  
**Acceptance:** A hook payload with unknown field `x_evil: 1` is stripped before SSE delivery.

---

## M-E2 — Identity & Access Control 🔴

*Gate: All M-E2 issues required before multi-user deployment.*

### E2-1 — Session ownership model [SD-AUTHZ-01] — HIGH

**Problem:** Any API key can operate on any session regardless of which key created it.  
**Fix:**  
1. Add `createdByKeyId: string` to `SessionInfo` and `api-contracts.ts`.  
2. Persist `createdByKeyId` on session creation.  
3. Enforce in `sendMessage`, `approve`, `reject`, `kill`, `interrupt`, `escape`, `transcript`, `capture_pane` — reject with 403 if caller's key ID does not match `createdByKeyId` (or caller is master key).  
**Files:** `src/session.ts`, `src/server.ts`, `src/api-contracts.ts`, `src/mcp-server.ts`  
**Acceptance:** Key A cannot approve Key B's session permission prompts; returns 403.

### E2-2 — API key roles [SD-AUTHZ-02] — MEDIUM

**Problem:** Any authenticated key can create and revoke other API keys.  
**Fix:** Add `role: 'admin' | 'operator' | 'viewer'` to `ApiKey`. Key creation/revocation requires `admin` role. Session operations require `operator` or above. Transcript/metric reads allow `viewer`.  
**Files:** `src/auth.ts`, `src/server.ts`  
**Acceptance:** An `operator` key cannot call `POST /v1/auth/keys`; returns 403.

### E2-3 — API key expiry [SD-AUTH-03] — MEDIUM

**Problem:** API keys never expire; compromised keys grant indefinite access.  
**Fix:** Add `expiresAt?: Date` to `ApiKey`. Optionally accept `ttlDays` at key creation. `validate()` rejects expired keys with `{ valid: false, reason: 'expired' }`.  
**Files:** `src/auth.ts`  
**Acceptance:** A key with `expiresAt` in the past is rejected by `validate()`.

### E2-4 — No-auth mode startup warning [SD-AUTH-02] — LOW

**Problem:** No conspicuous warning when running with no auth configured.  
**Fix:** Log a `warn` level `StructuredLogRecord` at startup when `authEnabled === false`.  
**Files:** `src/server.ts` or `src/startup.ts`  
**Acceptance:** `npm start` with no `AEGIS_AUTH_TOKEN` prints a visible warning.

### E2-5 — MCP tool scoping [MCP-8, MCP-10] — HIGH

**Problem:** Any MCP client can call all 24 tools including destructive ones.  
**Fix:** Add a `mcpScope` field to `ApiKey` with values like `read-only`, `operator`, `admin`. MCP server validates scope before executing each tool. Destructive tools (`kill_session`, `send_bash`) require `admin` scope.  
**Files:** `src/auth.ts`, `src/mcp-server.ts`  
**Acceptance:** An `operator` MCP key cannot call `kill_session`; receives a tool error.

### E2-6 — MCP batch/array limits [MCP-2, MCP-3] — MEDIUM

**Problem:** `batch_create_sessions.sessions` and `create_pipeline.steps` are unbounded arrays.  
**Fix:** Add `.max(50)` constraint to both array schemas.  
**Files:** `src/mcp-server.ts`  
**Acceptance:** A `batch_create_sessions` call with 51 items returns a validation error.

### E2-7 — SSO/OIDC integration (future) — CRITICAL (research spike)

**Problem:** No integration with corporate identity providers (Okta, Azure AD, Google Workspace).  
**Fix:** Evaluate and prototype a Passport.js or direct OIDC flow for browser-facing dashboard auth. API key model retained for machine-to-machine.  
**Output:** ADR documenting the chosen approach.

---

## M-E3 — Observability 🟠

### E3-1 — Prometheus metrics endpoint [OBS-1] — HIGH

**Problem:** No `text/plain; version=0.0.4` scrape endpoint. APM tooling cannot integrate.  
**Fix:**  
1. Add `prom-client` dependency.  
2. Mirror existing counters/gauges/histograms to Prometheus registry.  
3. Expose `/metrics` route (optionally protected by auth).  
4. Add histogram buckets for latency (replace min/max/avg).  
**Files:** `src/metrics.ts`, `src/server.ts`  
**Acceptance:** `curl http://localhost:9100/metrics` returns valid Prometheus exposition format.

### E3-2 — Fix `avg_duration_sec` = 0 [OBS-4] — MEDIUM

**Problem:** `getGlobalMetrics` hardcodes `avg_duration_sec: 0`; session duration is tracked but never aggregated.  
**Fix:** Aggregate `durationSec` across all sessions in `getGlobalMetrics()`.  
**Files:** `src/metrics.ts`  
**Acceptance:** After completing sessions, `/v1/health` shows a non-zero `avg_duration_sec`.

### E3-3 — Request correlation IDs [OBS-7] — MEDIUM

**Problem:** No `requestId` in structured logs; impossible to trace a single API call.  
**Fix:**  
1. Enable Fastify's `requestIdHeader` + `genReqId` to generate UUID-v4 per request.  
2. Add `requestId` to `StructuredLogRecord`.  
3. Thread `requestId` through `session.ts` and `monitor.ts` for log correlation.  
**Files:** `src/server.ts`, `src/logger.ts`  
**Acceptance:** All log records for a single HTTP request share the same `requestId`.

### E3-4 — OpenTelemetry tracing (future) — MEDIUM (research spike)

**Problem:** No distributed tracing; request flows cannot be correlated across components.  
**Fix:** Instrument with `@opentelemetry/sdk-node` auto-instrumentation for Fastify + HTTP. Create spans for `session.ts`' create/send/monitor cycle.  
**Output:** ADR documenting sampling strategy, exporter choice (Jaeger/OTLP).

### E3-5 — Alerting integration [OBS-1 related] — MEDIUM

**Problem:** Only CI failure → Discord alert exists. No production health alerting.  
**Fix:**  
1. Add a `POST /v1/alerts/test` endpoint for webhook validation.  
2. Emit alert webhook when session failure rate exceeds a configurable threshold (new `AEGIS_ALERT_WEBHOOK` env var, new `AEGIS_ALERT_FAILURE_RATE` threshold).  
3. Alert on tmux crash/recovery events.  
**Files:** `src/monitor.ts`, `src/config.ts`, `src/channels/webhook.ts`  
**Acceptance:** Simulating 5 consecutive session failures triggers an alert webhook.

### E3-6 — Immutable audit log [Compliance] — CRITICAL

**Problem:** No tamper-evident append-only audit trail (SOC2/ISO 27001 gap).  
**Fix:**  
1. Define `AuditRecord` type: `{ ts, actor (keyId), action, sessionId, detail, hash }`.  
2. Write to append-only `~/.aegis/audit.log` (never overwrite, rotate by date).  
3. Log: key creation/revocation, session create/kill, permission approve/reject, authenticated API calls.  
4. Expose `GET /v1/audit` endpoint for log streaming (admin role only).  
**Files:** New `src/audit.ts`, `src/server.ts`, `src/auth.ts`  
**Acceptance:** Approving a permission writes a signed audit record readable from `/v1/audit`.

### E3-7 — `JsonlWatcher` error recovery [TRANS-2] — MEDIUM

**Problem:** On `fsWatcher.on('error', ...)` watcher stops and never restarts; session goes dark silently.  
**Fix:**  
1. Emit a `diagnostics` event on watcher error.  
2. Attempt watcher restart with exponential backoff (max 3 attempts).  
3. Increment a metric counter `jsonlWatcherRestarts`.  
**Files:** `src/jsonl-watcher.ts`, `src/metrics.ts`  
**Acceptance:** Simulating `EMFILE` on watcher triggers restart attempt and a diagnostic event.

### E3-8 — Enable CodeQL on `develop` [CI-1] — HIGH

**Problem:** CodeQL only runs on `main`; dev branch has no SAST.  
**Fix:** Add `develop` to `branches` in `.github/workflows/codeql.yml`.  
**Files:** `.github/workflows/codeql.yml`  
**Acceptance:** CodeQL scan appears in PR checks for `develop`-targeting PRs.

---

## M-E4 — Reliability & Robustness 🟠

### E4-1 — Consensus feature: implement output parsing [CON-1] — HIGH

**Problem:** Consensus always returns `status: "running"`. Reviewer session output is never read.  
**Fix:**  
1. Wire `transcriptReader.readNewEntries()` for each reviewer session.  
2. Parse findings from tagged XML blocks or last assistant message.  
3. On reviewer completion (status `idle`), update `ConsensusReview.findings` and set `status: "complete"`.  
4. Update `GET /v1/consensus/:id` to return real status.  
**Files:** `src/consensus.ts`, `src/server.ts`  
**Acceptance:** `GET /v1/consensus/:id` eventually returns `status: "complete"` with non-empty `findings`.

### E4-2 — Pipeline stage timeout [P-1] — MEDIUM

**Problem:** A `running` stage with a crashed/stalled session blocks the pipeline forever.  
**Fix:** Add `stageTimeoutMs?: number` to `PipelineStage`. In `advancePipeline()`, track stage start time. On timeout, transition stage to `failed` with reason `"stage_timeout"` and advance the pipeline accordingly.  
**Files:** `src/pipeline.ts`, `src/api-contracts.ts`  
**Acceptance:** A pipeline stage that never completes is marked `failed` after the configured timeout.

### E4-3 — Pipeline state persistence [P-3] — HIGH

**Problem:** All in-flight pipeline state is in-memory; server restart silently discards orchestrations.  
**Fix:** Persist `PipelineState` to `~/.aegis/pipelines.json` using the same atomic-rename pattern as `state.json`. On startup, hydrate with reconciliation (check which sessions still exist in tmux; mark orphaned ones `failed`).  
**Files:** `src/pipeline.ts`  
**Acceptance:** A server restart during a running pipeline restores it; orphaned stages are marked failed.

### E4-4 — Graceful shutdown completeness [S-1–S-4] — MEDIUM

**Problem:** `jsonlWatcher`, `PipelineManager`, `MemoryBridge` not stopped on shutdown.  
**Fix:**  
1. Call `jsonlWatcher.close()` in `gracefulShutdown()`.  
2. Call `pipelines.destroy()` in `gracefulShutdown()`.  
3. Call `memoryBridge.stopReaper()` in `gracefulShutdown()`.  
4. `SwarmMonitor.stop()`: await in-flight scans with a 2-second timeout before force-stop.  
**Files:** `src/server.ts` (`gracefulShutdown` function)  
**Acceptance:** `SIGTERM` completes without open file handle warnings.

### E4-5 — `retryWithJitter` default `shouldRetry` [ERR-4] — MEDIUM

**Problem:** Callers omitting `shouldRetry` retry all errors including auth failures.  
**Fix:** Add a default `shouldRetry` that calls `error-categories.shouldRetry(categorize(err))`. Document and lint enforcement.  
**Files:** `src/retry.ts`, `src/error-categories.ts`  
**Acceptance:** A retry of a 400 validation error stops after the first attempt with the default policy.

### E4-6 — `TmuxCaptureCache` eviction loop [M-1] — LOW

**Problem:** Dead session entries remain in the cache map indefinitely.  
**Fix:** Add a periodic (5-minute) eviction pass that removes entries for sessions no longer in `state.sessions`.  
**Files:** `src/tmux-capture-cache.ts`  
**Acceptance:** After killing 100 sessions, `TmuxCaptureCache` size returns to 0.

### E4-7 — Raise coverage thresholds [CI-3] — MEDIUM

**Problem:** 50% line threshold only; no branch/function enforcement.  
**Fix:** Update `vitest.config.ts` to `{ lines: 70, branches: 60, functions: 70, statements: 70 }`.  
**Files:** `vitest.config.ts`  
**Acceptance:** CI fails when coverage drops below the new thresholds.

---

## M-E5 — API & Integration 🟠

### E5-1 — OpenAPI specification [API-3] — HIGH

**Problem:** No machine-readable contract. No SDK generation. No API gateway compatibility.  
**Fix:**  
1. Generate or author `openapi.yaml` covering all `/v1/` endpoints.  
2. Use `@fastify/swagger` to auto-generate from Fastify schemas.  
3. Publish spec to `/v1/openapi.json` and in `docs/`.  
4. Add CI step to validate spec on every PR.  
**Files:** `src/server.ts`, new `openapi.yaml`, `docs/api-reference.md`  
**Acceptance:** `GET /v1/openapi.json` returns a valid OpenAPI 3.1 document. `swagger-cli validate` passes in CI.

### E5-2 — API versioning headers [API-2] — MEDIUM

**Problem:** No version negotiation; no deprecation headers.  
**Fix:**  
1. Add `X-Aegis-API-Version: 1` response header to all `/v1/` responses.  
2. Accept `Accept: application/vnd.aegis.v1+json` request header and validate.  
3. Document deprecation path for the future `/v2/` transition.  
**Files:** `src/server.ts` (global hook)  
**Acceptance:** Every `/v1/` response includes `X-Aegis-API-Version: 1`.

### E5-3 — Published TypeScript client SDK — MEDIUM

**Problem:** No published SDK; MCP client and dashboard client duplicate auth/retry logic independently.  
**Fix:**  
1. Extract `AegisClient` into a standalone npm package `@onestepat4time/aegis-client`.  
2. Publish alongside `@onestepat4time/aegis`.  
3. Reuse in both `mcp-server.ts` and `dashboard/src/api/client.ts`.  
**Output:** New `packages/client/` workspace.

### E5-4 — Webhook HMAC signing [CHAN-3] — MEDIUM

**Problem:** No `X-Aegis-Signature` header on outbound webhooks; receivers cannot verify payload authenticity.  
**Fix:**  
1. Add `webhookSecret?: string` to the webhook channel config.  
2. Sign payload with `HMAC-SHA256(webhookSecret, body)` and include as `X-Aegis-Signature: sha256=<hex>`.  
**Files:** `src/channels/webhook.ts`, `src/config.ts`  
**Acceptance:** Webhook receiver validates `X-Aegis-Signature` and rejects tampered payloads.

### E5-5 — Missing notification channels [CHAN-4] — HIGH

**Problem:** Only Telegram and generic webhook; no Slack, email, PagerDuty, or Teams.  
**Fix:** Implement at minimum:
- `SlackChannel`: Incoming Webhooks or Slack API; session events → channel messages.
- `EmailChannel`: SMTP via Nodemailer; stall/dead events → ops email.  
**Files:** New `src/channels/slack.ts`, `src/channels/email.ts`  
**Acceptance:** A stalled session triggers a Slack notification and an email.

### E5-6 — Webhook PII redaction [CHAN-2] — HIGH

**Problem:** Raw user/assistant message content forwarded to webhook receivers.  
**Fix:** Add a configurable `redactContent: boolean` option per webhook. When enabled, replace message `content` with `[REDACTED]` in `message.*` events before delivery.  
**Files:** `src/channels/webhook.ts`, `src/config.ts`  
**Acceptance:** A webhook with `redactContent: true` receives `[REDACTED]` instead of raw LLM content.

---

## M-E6 — Dashboard & UX 🟠

### E6-1 — Login page [DASH-1] — CRITICAL

**Problem:** No login flow; token must be manually set in `localStorage`.  
**Fix:**  
1. Add a `/login` route in `App.tsx`.  
2. Token entry form that calls `POST /v1/auth/verify` and stores the token on success.  
3. 401 API responses redirect to `/login` automatically.  
**Files:** `dashboard/src/App.tsx`, new `dashboard/src/pages/LoginPage.tsx`, `dashboard/src/api/client.ts`  
**Acceptance:** A browser with no stored token is redirected to `/login`. After entering a valid key, redirected to dashboard.

### E6-2 — Audit trail UI [Compliance] — CRITICAL

**Problem:** No UI to review actions (approve, kill, send) by actor.  
**Fix:** Add `AuditPage.tsx` that paginates `GET /v1/audit` (from E3-6). Filterable by actor, action, and session.  
**Files:** New `dashboard/src/pages/AuditPage.tsx`  
**Acceptance:** Approving a permission shows up in the audit trail UI within seconds.

### E6-3 — Session `createdBy` display — MEDIUM

**Problem:** Sessions show no `createdBy`; operators cannot tell which key/user created a session.  
**Fix:** Expose `createdByKeyId` (from E2-1) in session list and detail views. Show key alias/label.  
**Files:** `dashboard/src/components/SessionTable.tsx`, `dashboard/src/pages/SessionDetailPage.tsx`  
**Acceptance:** Session list shows a `Created by` column.

### E6-4 — Multi-tenant namespace selector — CRITICAL (research spike)

**Problem:** All sessions globally visible; no org/workspace/tenant isolation.  
**Fix:** Evaluate adding a `namespace?: string` field to sessions (analogous to Kubernetes namespace). Sessions are scoped per namespace; API keys are bound to one or more namespaces.  
**Output:** ADR documenting namespace model.

---

## M-E7 — Scalability 🟡

### E7-1 — Configurable magic-number limits [CFG-1] — MEDIUM

**Problem:** `MAX_CONCURRENT_SESSIONS = 200`, rate-limit windows, and other limits are hardcoded.  
**Fix:** Move all hardcoded limits to `Config` with documented `AEGIS_*` env var overrides.  
**Files:** `src/config.ts`, `src/server.ts`  
**Acceptance:** Setting `AEGIS_MAX_CONCURRENT_SESSIONS=50` enforces the limit.

### E7-2 — Stateless mode (Redis back-end) — CRITICAL (research spike)

**Problem:** All session state in-process + JSON file; no horizontal scaling.  
**Fix:** Design an optional `AEGIS_STORAGE_BACKEND=redis` mode where `SessionManager` reads/writes to Redis instead of `state.json`. Per-instance tmux isolation remains; only coordination state is shared.  
**Output:** ADR; prototype.

### E7-3 — Monitor loop per-session concurrency [SC-3] — MEDIUM

**Problem:** `checkSession()` runs serially for all 200 sessions per poll cycle.  
**Fix:** Run `checkSession()` with bounded concurrency (`p-limit(20)`) instead of `Promise.all()` or serial execution.  
**Files:** `src/monitor.ts`  
**Acceptance:** Monitor poll cycle completes in < 2s for 100 active sessions.

### E7-4 — `package.json` name/bin consistency [Q-6, CI-9] — LOW

**Problem:** `name: "aegis-bridge"` and `bin: { "aegis-bridge": "dist/cli.js" }` conflict with CLAUDE.md docs.  
**Fix:** Align `package.json` to `name: "@onestepat4time/aegis"` and `bin: { "aegis": "dist/cli.js" }`.  
**Files:** `package.json`  
**Acceptance:** `npm i -g @onestepat4time/aegis` installs the `aegis` command.

---

## Consolidated Priority Backlog

| Priority | ID | Finding | Milestone |
|----------|----|---------|-----------|
| 1 | E1-1 | Env var injection denylist | M-E1 |
| 2 | E1-2 | `claudeCommand` RCE restriction | M-E1 |
| 3 | E2-1 | Session ownership model | M-E2 |
| 4 | E3-6 | Immutable audit log | M-E3 |
| 5 | E6-1 | Dashboard login page | M-E6 |
| 6 | E3-8 | Enable CodeQL on `develop` | M-E3 |
| 7 | E4-1 | Consensus: implement output parsing | M-E4 |
| 8 | E5-1 | OpenAPI specification | M-E5 |
| 9 | E5-6 | Webhook PII redaction | M-E5 |
| 10 | E2-3 | API key expiry | M-E2 |
| 11 | E2-2 | API key roles (RBAC) | M-E2 |
| 12 | E4-3 | Pipeline state persistence | M-E4 |
| 13 | E3-1 | Prometheus metrics endpoint | M-E3 |
| 14 | E2-5 | MCP tool scoping | M-E2 |
| 15 | E5-5 | Slack / email notification channels | M-E5 |
| 16 | E5-4 | Webhook HMAC signing | M-E5 |
| 17 | E1-5 | Permission evaluator `realpath` | M-E1 |
| 18 | E3-7 | `JsonlWatcher` error recovery | M-E3 |
| 19 | E4-2 | Pipeline stage timeout | M-E4 |
| 20 | E4-4 | Graceful shutdown completeness | M-E4 |
| 21 | E3-2 | Fix `avg_duration_sec = 0` | M-E3 |
| 22 | E3-3 | Request correlation IDs | M-E3 |
| 23 | E4-5 | `retryWithJitter` default `shouldRetry` | M-E4 |
| 24 | E4-7 | Raise coverage thresholds to 70/60/70 | M-E4 |
| 25 | E1-6 | `verification.ts` use `execFile` | M-E1 |
| 26 | E1-7 | `hookBodySchema` strict mode | M-E1 |
| 27 | E7-1 | Configurable magic-number limits | M-E7 |
| 28 | E7-3 | Monitor loop bounded concurrency | M-E7 |
| 29 | E5-2 | API versioning headers | M-E5 |
| 30 | E6-2 | Audit trail UI | M-E6 |
| 31 | E1-3 | Hook URL `?secret=` log redaction | M-E1 |
| 32 | E2-4 | No-auth mode startup warning | M-E2 |
| 33 | E4-6 | `TmuxCaptureCache` eviction loop | M-E4 |
| 34 | E7-4 | `package.json` name/bin consistency | M-E7 |
| 35 | E1-4 | `compareSemver` fail-closed | M-E1 |

---

## Expected State After All Milestones

| Capability | After M-E1 | After M-E2 | After M-E3 | After M-E4–E7 |
|-----------|-----------|-----------|-----------|--------------|
| Critical injection risks | ✅ Closed | ✅ | ✅ | ✅ |
| Session ownership | — | ✅ RBAC + ownership | ✅ | ✅ |
| Audit trail | — | — | ✅ Immutable log | ✅ |
| Observability | — | — | ✅ Prometheus + OTel | ✅ |
| OpenAPI spec | — | — | — | ✅ |
| Horizontal scaling | — | — | — | Research done |
| SSO/OIDC | — | Research done | — | ✅ (depends on research) |
| Enterprise notifications | — | — | — | ✅ Slack + email |
