# Enterprise Gap Analysis

Tracks all features needed for Aegis to reach enterprise-grade beta. Built from the enterprise review findings (#1392–#1456).

## How to Read This Document

- **Status** — what exists today vs. what needs to be built
- **Priority** — P0 blocks beta, P1 needed for solid beta, P2 nice to have
- **Items** — link to the canonical GitHub issue for each gap

---

## 1. Authentication

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Bearer token (single key) | ✅ Done | — | — |
| Multi-key API keys | ✅ Done | — | — |
| API key scopes (read/write/admin) | ✅ Done | #1432 | P0 |
| Session ownership (key → session binding) | ✅ Done | #1429 | P0 |
| API key expiry / 90-day rotation | 🔴 Gap | #1436 | P1 |
| SSO/OIDC integration | 🔴 Gap | #1410 | P1 |
| mTLS (client certificates) | 🔴 Gap | — | P2 |
| SAML support | 🔴 Gap | — | P2 |
| LDAP/Active Directory | 🔴 Gap | — | P2 |

**Dependencies:** Key expiry requires RBAC session ownership (✅ done). OIDC requires key expiry first.

---

## 2. Authorization

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Session ownership (RBAC) | ✅ Done | #1429 | P0 |
| API key roles (admin/operator/viewer) | ✅ Done | #1432 | P0 |
| Per-MCP-tool authorization | 🔴 Gap | #1407 | P1 |
| Organization/team/space model | 🔴 Gap | — | P1 |
| Resource-level permissions (per-session) | 🔴 Gap | — | P1 |
| Row-level security (multi-tenant) | 🔴 Gap | — | P2 |

**Dependencies:** Per-tool MCP auth requires tool-level scope definitions.

---

## 3. Observability

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Health endpoint (`/v1/health`) | ✅ Done | — | P0 |
| Prometheus metrics endpoint | 🔴 Gap | #1412 | P1 |
| OpenTelemetry tracing | 🔴 Gap | #1417 | P1 |
| Request/correlation IDs | 🔴 Gap | #1416 | P1 |
| avg_duration_sec fixed | 🔴 Gap | #1414 | P1 |
| Production alerting (not just CI) | 🔴 Gap | #1418 | P1 |
| Structured JSON logging | 🔴 Gap | — | P2 |
| Datadog/New Relic integration | 🔴 Gap | — | P2 |

**Dependencies:** Prometheus → OpenTelemetry tracing → correlation IDs (cascading).

---

## 4. Security

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Auth middleware on all endpoints | ✅ Done | — | P0 |
| Env var injection denylist | 🔴 Gap | #1392 | P0 |
| `claudeCommand` RCE prevention | 🔴 Gap | #1393 | P0 |
| Hook URL `?secret=` redaction in logs | 🔴 Gap | #1397 | P0 |
| `hookBodySchema` strict mode | 🔴 Gap | #1426 | P0 |
| `compareSemver` fails open | 🔴 Gap | #1395 | P0 |
| `verification.ts` uses `exec()` not `execFile()` | 🔴 Gap | #1398, #1404 | P0 |
| Permission evaluator `normalize()` → `realpath()` | 🔴 Gap | #1402 | P0 |
| CodeQL on `develop` branch | 🔴 Gap | #1421 | P1 |
| Dependency SBOM / CVE scanning | 🔴 Gap | — | P1 |
| Secrets rotation mechanism | 🔴 Gap | — | P1 |
| Rate limiting per-key | 🔴 Gap | — | P1 |

**Note:** P0 items block production deployment. All marked 🔴 are unstarted as of April 2026.

---

## 5. Scalability

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Session manager (in-memory) | ✅ Done | — | P0 |
| TmuxCaptureCache eviction | 🔴 Gap | #1433 | P1 |
| MCP `batch_create_sessions` unbounded arrays | 🔴 Gap | #1408 | P1 |
| Pipeline state persistence | 🔴 Gap | #1424 | P1 |
| No pipeline stage timeout | 🔴 Gap | #1423 | P1 |
| Concurrent session limits (`AEGIS_MAX_CONCURRENT_SESSIONS`) | ✅ Done | — | P0 |
| Horizontal scaling (stateless design) | 🔴 Gap | — | P2 |
| Session migration/failover | 🔴 Gap | — | P2 |
| Database-backed state (optional) | 🔴 Gap | — | P2 |

---

## 6. Compliance

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Immutable audit log | 🔴 Gap | #1419 | P0 |
| Audit trail UI (dashboard) | ✅ Done | #1528 | P0 |
| Audit log API (`GET /v1/audit`) | ✅ Done | — | P0 |
| Data residency / region selection | 🔴 Gap | — | P2 |
| GDPR: data export/deletion | 🔴 Gap | — | P2 |
| SOC2 Type II readiness | 🔴 Gap | — | P2 |
| ISO 27001 controls | 🔴 Gap | — | P2 |

**Dependencies:** Audit log requires session ownership (✅ done). SOC2/ISO require all P0 security items.

---

## 7. Reliability

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Graceful shutdown (partial) | 🔴 Gap | #1427 | P1 |
| JsonlWatcher auto-restart on error | 🔴 Gap | #1420 | P1 |
| `retryWithJitter` shouldRetry default | 🔴 Gap | #1430 | P1 |
| Dead session detection | ✅ Done | — | P0 |
| Automatic stall recovery | ✅ Done | — | P0 |
| Memory bridge persistence | ✅ Done | — | P0 |
| Backup/restore mechanism | 🔴 Gap | — | P2 |
| Circuit breaker pattern | 🔴 Gap | — | P2 |
| Chaos engineering / failure injection | 🔴 Gap | — | P2 |

---

## 8. Developer Experience

| Feature | Status | Issue | Priority |
|---------|--------|-------|----------|
| Getting Started guide | ✅ Done | — | P0 |
| Full API reference | ✅ Done | — | P0 |
| OpenAPI 3.1 spec | ✅ Done | #1524 | P0 |
| TypeScript client SDK | ✅ Done | #1530 | P1 |
| MCP tools reference | ✅ Done | — | P0 |
| Enterprise deployment guide | ✅ Done | — | P0 |
| Migration guide | ✅ Done | — | P0 |
| CLI tool (`aegis` binary) | 🔴 Gap | — | P1 |
| Dashboard login + auth | ✅ Done | #1525 | P0 |
| Notification channels (Slack/Email) | ✅ Done | #1530 | P1 |
| SDK documentation (TypeDoc) | 🔴 Gap | — | P1 |
| Postman/Insomnia collections | 🔴 Gap | — | P2 |
| VS Code extension | 🔴 Gap | — | P2 |
| GitHub Actions integration | 🔴 Gap | — | P2 |

---

## Priority Score Summary

| Priority | Count | Blocker for beta? |
|----------|-------|-------------------|
| P0 | ~15 items | Yes — all must ship |
| P1 | ~20 items | Strongly recommended |
| P2 | ~15 items | Nice to have |

---

## Implementation Order (Recommended)

```
Phase 1 — Security (M-E1)
  #1392 env injection denylist
  #1393 claudeCommand RCE prevention
  #1395 compareSemver fails open
  #1397 hook URL secret redaction
  #1398/1404 exec → execFile
  #1402 realpath() in permission eval
  #1426 hookBodySchema strict mode

Phase 2 — Auth & RBAC (M-E2)
  #1436 API key expiry
  #1410 OIDC spike
  (requires Phase 1 complete)

Phase 3 — Observability (M-E3)
  #1412 Prometheus endpoint
  #1416 correlation IDs
  #1414 avg_duration fix
  #1417 OpenTelemetry tracing

Phase 4 — Reliability (M-E4)
  #1427 graceful shutdown
  #1420 JsonlWatcher restart
  #1430 retryWithJitter default

Phase 5 — Compliance & DX (M-E6/E7)
  #1419 immutable audit log
  SDK / TypeDoc
  CLI tool
```

---

## What Aegis Has Today

Despite the gaps above, Aegis ships with a solid foundation:

- ✅ REST API with full session lifecycle
- ✅ MCP server for Claude Code integration
- ✅ Telegram + Slack + Email + Webhook notifications
- ✅ SSE real-time events
- ✅ Session health monitoring
- ✅ Memory bridge for cross-session state
- ✅ Pipeline orchestration
- ✅ Dashboard with login, audit trail, session list
- ✅ OpenAPI spec + TypeScript SDK
- ✅ Bearer token + multi-key auth with scopes

The P0 gaps are all in the **Security** column. Shipping Phase 1 unblocks production deployment.
