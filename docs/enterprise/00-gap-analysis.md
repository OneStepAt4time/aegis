# 00 — Enterprise Gap Analysis (Follow-up Pass)

**Date:** 2026-04-16
**Reviewer:** GitHub Copilot (Claude Opus 4.7)
**Version reviewed:** `@onestepat4time/aegis` 0.5.3-alpha on `develop`
**Scope:** Full codebase — `src/`, `dashboard/`, `docs/`, `scripts/`, `.github/workflows/`, `examples/`, `skill/`, `packages/client/`
**Relationship to prior review:** Follow-up to the 2026-04-08 pass indexed in [index.md](./index.md). Confirms which gaps closed, which remain, and introduces an updated P0/P1/P2 scorecard plus companion ADR stubs.

> This document is a requested publication (review artifact), not a trash/report file. It follows the `docs/enterprise/` series and is referenced from [index.md](./index.md).

---

## Executive Summary

Aegis is a well-architected alpha that does one thing elegantly: it turns Claude Code + tmux into a first-class, scriptable orchestration substrate accessible via REST, MCP, CLI, SSE, WS, and multiple notification channels. Engineering quality is notably high for alpha — strict TS, Zod validation, SSRF hardening, SHA-256-chained audit log, mutex-guarded session lifecycle, Prometheus metrics, CodeQL, Dependabot, release-please with SBOM + npm provenance, CycloneDX, hygiene gate, and ~185 tests.

The gap to enterprise is not quality — it is **posture**: the product is single-tenant by design, lacks SSO/OIDC, has no horizontal-scaling story (file-backed state), no OpenAPI contract, limited granular RBAC, no Kubernetes/Helm packaging, no data retention/DR policy, and only partial per-action audit logging. Closing those gaps is a 1–2 quarter scope, not a rewrite.

---

## 1. Product Idea

> **Aegis is the control plane for Claude Code.** It turns an interactive CLI coding agent into a programmable, observable, multi-channel service — so humans and other agents can drive Claude Code over REST/MCP instead of over a keyboard.

### Core value propositions

1. **No SDK lock-in, no browser automation** — pure tmux + JSONL parsing of Claude Code's native transcript.
2. **Unified bridge** — one server exposes the same sessions to REST, MCP tools, SSE, WebSocket, CLI, Telegram, Slack, Email, and webhooks.
3. **Deterministic state machine** — sessions classified as `working | idle | asking | permission_prompt | rate_limit | stalled` via regex-based terminal parsing, not LLM-parsing.
4. **Multi-agent orchestration primitives** — pipelines, batches, consensus, memory bridge, templates, capability handshake.
5. **Security-first defaults** — API-key RBAC, path allowlists, SSRF blocklist, hook-secret encryption, audit trail with SHA-256 chaining.

### Target personas

| Persona | Use case | Primary surface |
|---|---|---|
| AI-agent builder | Spawn and coordinate parallel CC sessions | MCP tools + SSE |
| DevOps / CI | Run CC headless inside pipelines | REST + CLI |
| Internal automation | Supervised coding with approvals | Dashboard + Telegram |
| SaaS integrator | Whitelabel Claude Code as a service | REST + API keys + dashboard |

**Ecosystem position:** Aegis sits between MCP hosts (Claude Code, Cursor, Windsurf) and Claude Code itself. Closest conceptual adjacency is Replit Agent APIs / OpenDevin, but Aegis is self-hosted, open-source, transport-agnostic, and CC-native.

---

## 2. Architecture Snapshot

```
HTTP (Fastify 5) ──┐
MCP (stdio)    ────┤
WS/SSE         ────┼─► RouteContext (DI) ─► Services (Auth, Sessions, Pipelines, Memory, Channels)
CLI            ────┘                       │
                                           ▼
                              tmux serialized queue ─► Claude Code processes
                                           │
                                           ▼
                     JSONL watcher + terminal-parser ─► Monitor loop ─► EventBus
                                           │                               │
                                           ▼                               ▼
                                      Audit log                   Channels (TG/Slack/Email/Webhook)
                                       + Metrics + Prometheus + Structured logs
```

### Strengths

- Clean layering: [src/server.ts](../../src/server.ts) → [src/routes/](../../src/routes/) → [src/services/](../../src/services/) → [src/platform/](../../src/platform/)/[src/tmux.ts](../../src/tmux.ts).
- DI via [src/container.ts](../../src/container.ts) with lifecycle + dependency ordering.
- Serialized tmux CLI queue with 10s default timeout prevents hung commands from blocking.
- Hook-driven discovery (push) with polling fallback (pull).
- Dual-offset transcript model (monitor vs. API read) allows independent consumption.
- Cross-platform shell abstraction in [src/platform/shell.ts](../../src/platform/shell.ts).

### Hotspots / smells

- [src/server.ts](../../src/server.ts) still bundles middleware + route registration + global wiring (~800 LOC). Decomposition tracked by [ADR-0007](../adr/0007-server-decomposition-fastify-plugins.md).
- [src/session.ts](../../src/session.ts) (~500 LOC) mixes lifecycle, persistence, and orchestration despite helpers.
- [src/monitor.ts](../../src/monitor.ts) polling loop carries many side effects (offset updates, events, metrics) in one function.
- [src/permission-guard.ts](../../src/permission-guard.ts) scans three settings locations — correct but fragile.
- Legacy [src/auth.ts](../../src/auth.ts) re-exports [src/services/auth/AuthManager.ts](../../src/services/auth/AuthManager.ts) — source of confusion.
- Pipeline state is in-memory only (TODO at [src/pipeline.ts](../../src/pipeline.ts) referencing #1665).

---

## 3. API Surface

- **REST** under `/v1/`: sessions (CRUD + batch + history), actions (send/command/bash/approve/reject/escape/interrupt), transcripts (cursor pagination), hooks (inbound CC events), auth keys (CRUD + SSE tokens), health + diagnostics + `/metrics`, pipelines, channels health + DLQ, swarm, memory, templates.
- **MCP:** 24 tools, 4 resources, 3 prompts; handshake with capability negotiation ([src/handshake.ts](../../src/handshake.ts)).
- **SSE:** `/v1/events/subscribe?sessionId=…` with short-lived (60s) SSE tokens.
- **WebSocket:** `/ws/terminal/:sessionId` with first-message auth handshake (Issue #503).

**Gaps:** no OpenAPI/Swagger, no deprecation-header policy, WebSocket route is undocumented in [docs/api-reference.md](../api-reference.md). See [ADR-0018](../adr/0018-openapi-spec-from-zod.md).

---

## 4. Security Posture

### Strong

- API keys hashed (SHA-256); roles: admin/operator/viewer; rate limit + TTL per key.
- Tamper-evident audit chain (SHA-256, v3 after Issue #1642 to avoid PBKDF2 stalls) with daily rotation ([src/audit.ts](../../src/audit.ts)).
- Zod schemas on all POST bodies; workdir traversal protection; `claudeCommand` restricted via `SAFE_COMMAND_RE`.
- SSRF blocklist covers RFC1918, loopback, link-local, IPv6 ULA, IPv4-mapped IPv6, CGNAT, multicast, docs, benchmarking ([src/ssrf.ts](../../src/ssrf.ts)).
- `execFile()` only — no `exec()`; repo-wide [scripts/check-no-shell-true.cjs](../../scripts/check-no-shell-true.cjs) bans `shell: true`.
- Hook secrets encrypted at rest with AES-256-GCM (derived from master token).
- Log redaction of auth tokens via [src/utils/redact-headers.ts](../../src/utils/redact-headers.ts).
- SSE token scheme: short TTL, max 5 per key, separate prefix from bearer tokens.

### Gaps

- **Implicit session ownership** on action routes — bearer token gates access but there is no explicit `ownerKeyId` check in `send/approve/reject/kill`. Partial work under Issue #1429. See [ADR-0019](../adr/0019-session-ownership-authz.md).
- **Coarse RBAC** — three roles; no per-action permission (e.g., "can approve but not kill").
- **Tool-input passthrough** — hook bodies accept arbitrary `tool_input` via `.passthrough()` (Issue #665); may leak sensitive fields via SSE.
- **Master-token single key** — all hook-secret encryption derives from one key; no rotation mechanism.
- **No per-IP rate limit** — only per-key; leaked key still rate-limited, but unauthenticated endpoints lean on per-route config.
- **CORS default permissive** in dev — must be locked down in prod.
- **Env passthrough** — env var names validated (`^[A-Z_][A-Z0-9_]*$`), but values not escaped; no denylist for `PATH`, `LD_PRELOAD`, `ANTHROPIC_API_KEY`, `NODE_OPTIONS`, `DYLD_*` (RCE risk if an admin key is compromised). See [ADR-0020](../adr/0020-env-var-denylist.md).
- **Token in localStorage** on the dashboard (XSS exposure).
- **No CSP** headers in `dashboard/index.html`.

---

## 5. Reliability

- Structured error categories + retry with exponential backoff + jitter ([src/retry.ts](../../src/retry.ts)).
- Mutexes: per-session acquire (`async-mutex`), audit write lock, SSE-token issuance lock, tmux global serialization queue.
- Stall threshold default 2 min (Issue #392), permission timeout auto-reject at 10 min, unknown-state timeout 3 min.
- JSONL watcher restart with exponential backoff on `fs.watch` errors (Issue #1420).
- Graceful shutdown: `killAllSessions()` on SIGTERM/SIGINT; Windows WM_QUERYENDSESSION handled.

### Weaknesses

- No **HTTP drain** on shutdown — in-flight approvals can be hard-closed. See [ADR-0021](../adr/0021-sse-and-http-drain-timeouts.md).
- **Channel deliveries are fire-and-forget** — errors silently dropped unless DLQ hits.
- **No SSE idle timeout** — hung clients keep sockets alive.
- **Hook handling lacks per-request timeout** — a 30s webhook can stall the monitor loop.
- Offset mutation in [src/monitor.ts](../../src/monitor.ts) is "best effort" without a lock — documented, but still a foot-gun.

---

## 6. Observability

- Metrics: per-global and per-session (duration, messages, tool calls, token cost in USD, Issue #488); Prometheus exporter at `/metrics` ([src/prometheus.ts](../../src/prometheus.ts)).
- Structured logs (JSON) with redaction.
- Audit trail with chain integrity (v3).
- **Tracing:** OpenTelemetry is designed in [ADR-0017](../adr/0017-opentelemetry-tracing.md) but [src/tracing.ts](../../src/tracing.ts) is effectively a placeholder — OpenTelemetry deps are installed but not wired end-to-end.

---

## 7. Frontend (Dashboard)

**Stack:** React 19 + RR v7 + Zustand + Tailwind v4 + xterm.js, Vitest + Playwright, Vite with vendor-chunking and hidden sourcemaps.

### What's done well

- Lazy-loaded pages, code splitting, ErrorBoundary, ToastContainer.
- Resilient SSE ([dashboard/src/api/resilient-eventsource.ts](../../dashboard/src/api/resilient-eventsource.ts)) and resilient WS ([dashboard/src/api/resilient-websocket.ts](../../dashboard/src/api/resilient-websocket.ts)) with capped retries and give-up signals (Issues #308, #503, #640, #641).
- Zod validation in API client, automatic bearer injection, 401 → logout.
- XSS tests across every transcript entry type ([dashboard/src/__tests__/sanitization-all-entry-types.test.tsx](../../dashboard/src/__tests__/sanitization-all-entry-types.test.tsx)).
- 70% coverage threshold enforced in [dashboard/vitest.config.ts](../../dashboard/vitest.config.ts).

### Dashboard gaps

- No focus trap / focus restore in modals; partial ARIA.
- No i18n — English hardcoded.
- No virtualization on transcript and session-history lists; potential OOM on large sessions (TanStack Virtual is installed but unused).
- Token in localStorage (XSS risk).
- No CSP, no light-theme contrast audit.
- No memoization on hot list items (`MessageBubble`, `SessionTable` rows).
- No multi-select / batch actions on sessions.
- No RBAC UI although backend supports roles.
- No "last updated" / staleness indicators on metrics.
- No permission-prompt TTL countdown in UI.

---

## 8. Testing & CI/CD

### Test inventory (~185 files)

- **Unit:** config, metrics, auth, logger, container, path/utils, safe-json, circular-buffer.
- **Security:** auth-bypass, RBAC, webhook SSRF, screenshot SSRF, env-denylist, permission-evaluator ×7, input-validation, SSRF.
- **Session/tmux:** 7 tmux-* files, session-dedup/mutex/ownership/persistence, zombie-reaper, pane-exit, dead-session.
- **Webhooks:** retry, SSRF, DNS rebinding, DLQ, header redaction.
- **Integration:** 4 files (SSE, lifecycle, permission flow, auth ratelimit).
- **Fault injection:** 1 harness, manual-run only.
- **Dashboard unit:** ~10; Playwright E2E: 5 specs.

**Coverage:** 70% lines/functions/statements, **60% branches** — below CLAUDE.md M1 goal (≥65%). LCOV emitted, not uploaded / trended.

### CI (13 workflows)

- **On PR to `develop`:** ESLint + hygiene + security grep + `tsc --noEmit` + build + `npm test` + CI smoke, matrix Ubuntu × Node 20,22. **No dashboard E2E, no Windows/macOS.**
- **On tag:** full Ubuntu/Windows/macOS matrix (Node 22), dashboard E2E, SBOM (CycloneDX), SHA-256 checksums, npm publish with provenance.
- **Scheduled/triggered:** CodeQL (JS/TS), Dependabot (weekly npm + dashboard + actions), stale, rollback, Discord notify, pages, auto-triage/label.

**Release:** release-please (prerelease `alpha`), SBOM + checksums (30-day retention), npm provenance via OIDC (`id-token: write`), no Sigstore attestation file, no package signing. See [ADR-0022](../adr/0022-sigstore-attestations.md).

**Gate:** `npm run gate` = hygiene + security-check + tsc + build + test. Hygiene detects a denylist of retired filenames, dated analysis artefacts, and enforces SECURITY.md alpha alignment. Weaknesses: no staged mode, no bundle/latency budgets, `--no-verify` not blocked at repo level, fault harness not in CI, no coverage diff tracking.

---

## 9. Documentation & Packaging

**Covered:** Getting Started, Architecture, API Reference (hand-authored), MCP Tools, Advanced (memory bridge, templates, verification), Dashboard, Windows setup + dev, Worktree, Alerting, Troubleshooting, Deployment (systemd/Docker), Enterprise, Migration guide, Integrations (Telegram/Slack/Email/Webhooks/Cursor/Windsurf/CLI/MCP Registry).

### Missing / thin

- No OpenAPI / Swagger (`openapi.yaml` is empty/absent at repo root).
- No Kubernetes / Helm / StatefulSet guide.
- No air-gap deployment guide.
- No SLA / uptime / deprecation / API-versioning doc.
- No data-retention / archival policy.
- No DR runbook or backup/restore.
- Alpha lifecycle language drifts in [enterprise.md](../enterprise.md) (reads "production-ready" in places).
- [skill/SKILL.md](../../skill/SKILL.md) still references old `aegis-bridge` name in spots.

**Packaging present:** npm main (`@onestepat4time/aegis`), npm client (`@onestepat4time/aegis-client`), Docker image (ghcr), CLI bin `aegis`, Claude skill. **Missing:** Helm chart, Terraform module, Homebrew/APT, PyPI/Go/Rust SDK, container image signing/attestations.

---

## 10. Enterprise Gap Scorecard

**Legend:** Impact ∈ {S, M, L}. Effort ∈ {S ≤ 1w, M 1–3w, L > 3w}.

### P0 — Ship blockers for any enterprise pilot

| # | Gap | Impact | Effort |
|---|---|---|---|
| P0-1 | Explicit session ownership authz on send/approve/reject/kill/interrupt | L | M |
| P0-2 | Env-var denylist (PATH, LD_PRELOAD, ANTHROPIC_API_KEY, NODE_OPTIONS, DYLD_*) at session create | L | S |
| P0-3 | API-key expiry + rotation (`expiresAt`, admin rotation endpoint, per-key revocation audit) | M | S |
| P0-4 | OpenAPI 3.1 spec generated from Zod/route definitions; CI contract test | M | M |
| P0-5 | ✅ DONE — Redis-backed state store available via `AEGIS_STATE_STORE=redis` (v0.6, PR #2133) | — | — |
| P0-6 | Per-action RBAC matrix beyond three roles | M | M |
| P0-7 | SSE idle timeout + hook-delivery timeout + HTTP drain on shutdown | M | S |
| P0-8 | CSP + move token out of localStorage (HttpOnly cookie or in-memory + refresh endpoint) | M | M |

### P1 — Required for multi-team / regulated rollout

| # | Gap | Impact | Effort |
|---|---|---|---|
| P1-1 | Multi-tenancy primitives: tenantId on keys/sessions/audit, workdir namespacing, resource quotas | L | L |
| P1-2 | SSO / OIDC (OAuth2 device flow for CLI, OIDC for dashboard) | L | L |
| P1-3 | OpenTelemetry traces wired end-to-end (spans across HTTP → service → tmux queue → channel delivery) | L | M |
| P1-4 | Dashboard E2E in PR CI + raise branch coverage to ≥65% + coverage diff gating | M | S |
| P1-5 | Windows/macOS smoke on `develop` (subset of tests; full matrix on tag) | M | S |
| P1-6 | Fault-injection harness in release gate (chaos suite run on tag, not just manual) | M | M |
| P1-7 | Dashboard: focus traps, ARIA labels, list virtualization, RBAC UI, batch ops, staleness badges | M | M |
| P1-8 | Audit log export + query UI (time-series download, filter by actor/action/tenant) | M | M |
| P1-9 | Kubernetes packaging: Helm chart, StatefulSet (state PVC), liveness/readiness endpoints, HPA hints | L | M |
| P1-10 | Sigstore / attestations on npm and container images; verifier script documented | M | S |

### P2 — Required to position as GA enterprise product

| # | Gap | Impact | Effort |
|---|---|---|---|
| P2-1 | ✅ DONE — Redis-backed state store enables horizontal scaling; sticky routing and tmux-socket affinity remain open | L | L |
| P2-2 | Compliance scaffolding: SOC2 control mapping, data-retention policy, DPA template, SBOM retention > 30d | L | M |
| P2-3 | Prompt-injection hardening for MCP prompts (implement_issue, review_pr, debug_session) | M | S |
| P2-4 | API versioning policy + deprecation headers + `/v2/` migration doc | M | S |
| P2-5 | SDKs for Python and Go generated from OpenAPI | M | M |
| P2-6 | Disaster-recovery runbook: export/import session state, backup of audit chain, key-material recovery | L | M |
| P2-7 | Secrets integration: HashiCorp Vault / AWS KMS / Azure KV backends for master token and hook secrets | L | M |
| P2-8 | Observability bundles: Grafana dashboards, alert rules, OTLP exporter docs, Datadog integration | M | M |
| P2-9 | Air-gapped deployment guide with offline install, license notes, bundled dashboard assets | M | M |
| P2-10 | Rate-limit / quota per tenant (concurrent sessions, tokens, USD spend cap) | L | M |
| P2-11 | Billing/metering hooks (per-session token cost already tracked — expose as usage records) | M | S |
| P2-12 | Webhook signature verification helper SDK (consumers currently roll their own) | S | S |

---

## 11. Suggested 3-Phase Roadmap (SUPERSEDED)

> ⚠️ **Superseded by [§15 Positioning & Phasing](#15-positioning--phasing).** The 3-phase grouping below was the original proposal from 2026-04-16. After the positioning lock-in we moved to a 4-phase model with sustainable-pace, part-time calibration. Kept here for traceability.

**Phase 1 — Enterprise Pilot (≈6 weeks)**
P0-1, P0-2, P0-3, P0-4, P0-7, P0-8, P1-4, P2-3.

**Phase 2 — Multi-team GA (≈3 months)**
P0-5, P0-6, P1-1, P1-2, P1-3, P1-7, P1-8, P1-9, P1-10.

**Phase 3 — Enterprise GA (≈1–2 quarters)**
P2-1, P2-2, P2-5, P2-6, P2-7, P2-8, P2-10, P2-11.

---

## 12. Key Quick Wins (under 1 week each)

1. Emit OpenAPI 3.1 from existing Zod schemas (`zod-to-openapi`) → publish at `/v1/openapi.json`. See [ADR-0018](../adr/0018-openapi-spec-from-zod.md).
2. Add `ownerKeyId` guard to action routes behind a config flag; default-on. See [ADR-0019](../adr/0019-session-ownership-authz.md).
3. Env-var denylist constant + Zod refine on session create. See [ADR-0020](../adr/0020-env-var-denylist.md).
4. SSE idle timeout + `server.close()` drain with grace period. See [ADR-0021](../adr/0021-sse-and-http-drain-timeouts.md).
5. CSP meta in `dashboard/index.html` + document Fastify header injection for prod.
6. Raise branch coverage threshold to 65% and add dashboard E2E to PR CI.
7. Sigstore attestations on npm publish (already have OIDC) and on container push. See [ADR-0022](../adr/0022-sigstore-attestations.md).
8. Keep ADR index current as new decisions land; align with the lifecycle docs listed in [AGENTS.md](../../AGENTS.md).

---

## 13. Where Aegis Is Already Ahead of Most Alpha Products

- Tamper-evident audit log with chain integrity.
- SSRF matrix coverage incl. IPv4-mapped-IPv6 and hex forms.
- Hook-secret encryption at rest.
- Capability handshake for protocol negotiation.
- Token cost & latency tracking per session.
- Worktree-aware session discovery.
- Formal hygiene gate preventing dated artifacts and legacy files.
- Release-please + SBOM + checksums + npm provenance in the default release path.

These are rare in alpha and justify pursuing the enterprise path incrementally rather than rewriting.

---

## 14. Companion ADRs

The five new ADRs below capture the architectural decisions implied by the P0 quick wins in §12:

| ADR | Title | Status |
|---|---|---|
| [ADR-0018](../adr/0018-openapi-spec-from-zod.md) | OpenAPI 3.1 spec generated from Zod schemas | Proposed |
| [ADR-0019](../adr/0019-session-ownership-authz.md) | Explicit session ownership authz on action routes | Proposed |
| [ADR-0020](../adr/0020-env-var-denylist.md) | Env-var denylist on session create | Proposed |
| [ADR-0021](../adr/0021-sse-and-http-drain-timeouts.md) | SSE idle timeout and HTTP drain on shutdown | Proposed |
| [ADR-0022](../adr/0022-sigstore-attestations.md) | Sigstore attestations for npm and container artifacts | Proposed |
| [ADR-0023](../adr/0023-positioning-claude-code-control-plane.md) | Positioning: Claude Code Control Plane, MIT, BYO LLM, `ag` CLI | Proposed |

---

## 15. Positioning & Phasing (2026-04-16 decision)

This section locks in the product direction that shapes the roadmap below. It
supersedes any prior "enterprise-first" framing in earlier reviews.

### Target users (same pattern at every scale)

Aegis serves the same orchestration pattern across three scales:

1. **Individual developer running a team of AI agents** (primary, today).
   A single human driving 1–10+ Claude Code agents doing vibe-coding,
   CI tasks, reviews, docs, and automation. Aegis is the bridge they use to
   send, approve, monitor, and orchestrate those sessions from anywhere
   (including mobile).
2. **Team of humans, each with their own agents** (next 2–3 months).
   5–20 developers sharing an Aegis deployment. Needs per-action RBAC, audit
   export, Helm, reliable remote access — but not yet SSO or tenancy.
3. **Enterprise** (6–12 months, demand-driven).
   Multi-team with SSO/OIDC, multi-tenancy, compliance scaffolding.

The pattern is the same everywhere: **Aegis is the control plane of
Claude Code; the agents are built by the user.** Aegis never orchestrates
agents itself. It provides the primitives (sessions, sends, approvals, events,
pipelines) and optional reusable templates.

See [ADR-0006](../adr/0006-aegis-middleware-not-agent-framework.md) and
[ADR-0023](../adr/0023-positioning-claude-code-control-plane.md).

### Licensing

**MIT, single edition.** No open-core, no BUSL, no enterprise-only modules.
Revisit only if and when a commercial contract or funding requires it.

### LLM backend

**BYO LLM is a first-class, supported feature.** Aegis orchestrates Claude Code
as a *runtime*; the user is free to point Claude Code at any
Anthropic-compatible endpoint (GLM via `api.z.ai`, OpenRouter, local models via
LM Studio or Ollama, etc.). Aegis ships no default credentials and never owns
LLM cost. This keeps Aegis self-hosted with zero variable cost.

See [ADR-0023](../adr/0023-positioning-claude-code-control-plane.md).

### CLI binary

Primary command is **`ag`**. The long form `aegis` remains as an alias for
discoverability and backward compatibility.

### Revised 4-phase roadmap

The original "3-phase roadmap" in §11 is superseded by the 4-phase plan below.
Every gap from §10 is re-assigned to a phase.

#### Phase 1 — Foundations (1–2 months wall-clock of part-time work)

Make Aegis safe, contract-first, and supply-chain-verifiable. Ships quickly.

- P0-1 Session ownership authz — [ADR-0019](../adr/0019-session-ownership-authz.md)
- P0-2 Env-var denylist — [ADR-0020](../adr/0020-env-var-denylist.md)
- P0-4 OpenAPI 3.1 from Zod — [ADR-0018](../adr/0018-openapi-spec-from-zod.md)
- P0-7 SSE idle timeout + HTTP drain — [ADR-0021](../adr/0021-sse-and-http-drain-timeouts.md)
- P1-4 Dashboard E2E in PR CI + branch coverage ≥ 65%
- P1-10 Sigstore attestations — [ADR-0022](../adr/0022-sigstore-attestations.md)
- Credential scan in `hygiene-check`

#### Phase 2 — Developer Delight + Team-Ready (2–3 months)

Make Aegis the tool friends recommend, and good enough for a team of 10.

- `ag` alias + `ag init` interactive setup — [ADR-0023](../adr/0023-positioning-claude-code-control-plane.md)
- `ag doctor` diagnostics
- BYO LLM official support + `examples/byo-llm/` + CI mock coverage
- Agent / skill / slash-command template gallery (`ag init --from-template`)
- Remote-access guide (Tailscale, Cloudflare Tunnel, ngrok)
- Mobile-first dashboard pass
- Dashboard home / onboarding
- P1-9 Helm chart v1
- P0-6 Per-action RBAC (`send`, `approve`, `reject`, `kill`, `create`)
- P1-8 Audit export API + basic UI
- P0-8 CSP + token out of localStorage
- P1-6 Fault-injection harness in release gate
- P2-3 Prompt-injection hardening for MCP prompts

#### Phase 3 — Team & Early-Enterprise (3–6 months)

Arrives when the first external team of 10+ asks for it.

- P0-5 Pluggable `SessionStore` + Postgres implementation
- P1-3 OpenTelemetry wired end-to-end
- P2-5 SDKs (TypeScript, Python) generated from OpenAPI
- P1-2 SSO / OIDC (Entra ID, Google, Okta, Keycloak, Authentik)
- P1-1 Multi-tenancy primitives (tenantId on keys / sessions / audit)
- P1-7 Dashboard virtualization + full a11y pass
- i18n scaffolding (EN + IT)

#### Phase 4 — Enterprise GA (6–12 months, demand-driven)

All remaining P2 items: horizontal scaling, compliance scaffolding, DR runbook,
secrets-manager integrations, Grafana bundle, air-gapped install,
per-tenant quotas, billing hooks, webhook-verification SDK.

### Deferred from earlier plans

- `AEGIS_EDITION` flag and open-core split — **dropped**. Single MIT edition.
- Horizontal scaling via Redis — deferred to Phase 4, only on real demand.
- Kubernetes-first deployment story — downgraded: Helm is Phase 2, but
  single-binary / systemd / Docker Compose remain the default path.
