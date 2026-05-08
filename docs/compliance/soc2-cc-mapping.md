# SOC 2 Trust Services Criteria — Aegis Control Mapping

> **Purpose:** Maps each SOC 2 Trust Services Criterion (CC6–CC9) to concrete Aegis features, evidence sources, and gap actions. This is the primary reference for SOC 2 Type II audit preparation.
>
> **Cross-reference:** The high-level readiness checklist lives in [`docs/COMPLIANCE.md`](../COMPLIANCE.md). This document provides the detailed feature-level mapping that the checklist summarizes.

---

## Security (CC6 – CC9)

Security is the **required** Trust Services category for SOC 2. The Common Criteria (CC6–CC9) cover logical access, authentication, network security, encryption, monitoring, and change management.

### CC6.1 — Logical and Physical Access Controls

**Control:** Implement logical access restrictions over information assets.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| API key authentication with SHA-256 hashing | `src/config.ts` — `hashApiKey()`, key store at `{stateDir}/keys.json` | ✅ Implemented |
| Master token + per-key roles (admin / operator / viewer) | `src/routes/auth.ts` — role-based permission policies | ✅ Implemented |
| Per-key permissions and quotas | `src/config.ts` — `ApiKeyPermissions`, quota enforcement middleware | ✅ Implemented |
| Timing-safe token comparison | `src/routes/auth.ts` — `crypto.timingSafeEqual()` | ✅ Implemented |
| Session ownership enforcement | `enforceSessionOwnership: true` default; `src/routes/sessions.ts` — ownership checks | ⚠️ Partial — per-action RBAC not yet granular (P0-6) |
| Dashboard authentication | `dashboard/src/` — login gate, token persistence | ✅ Implemented |

**Gap Actions:**
- Implement per-action RBAC (P0-6)
- Complete session ownership enforcement for all session operations (P0-1)

### CC6.2 — Authentication

**Control:** Authenticate users and systems before granting access.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Bearer token auth on all routes | `src/routes/auth.ts` — `authMiddleware` | ✅ Implemented |
| Rate limiting | 100 sessions/min, 30 general/min per key | ✅ Implemented |
| Per-IP auth failure tracking with lockout | `src/routes/auth.ts` — failed attempt counter | ✅ Implemented |
| SSE tokens: 60s TTL, single-use, max 5 per key | `src/routes/sessions.ts` — SSE endpoint | ✅ Implemented |

**Gap Actions:**
- Add SSO / OIDC support (Phase 3)
- Implement MFA for dashboard access
- Add mandatory API key expiry and rotation policies

### CC6.3 — Authorization

**Control:** Authorize access based on need-to-know and least privilege.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Three roles with permission policies | `src/config.ts` — `admin`, `operator`, `viewer` | ✅ Implemented |
| Session ownership enforcement (default on) | `enforceSessionOwnership: true` | ✅ Implemented |
| Metrics endpoint gated by dedicated token | `src/routes/metrics.ts` — metrics auth | ✅ Implemented |

**Gap Actions:**
- Implement per-action RBAC granularity (P0-6)
- Add attribute-based access control (ABAC) for enterprise tier

### CC6.6 — Network Security

**Control:** Implement network security controls.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Binds to `127.0.0.1` by default | `src/server.ts` — default host config | ✅ Implemented |
| SSRF blocklist (RFC 1918, loopback, link-local, IPv6 ULA, etc.) | `src/utils/ssrf.ts` | ✅ Implemented |
| CORS wildcard rejected | `src/server.ts` — CORS config | ✅ Implemented |
| Security headers (X-Content-Type-Options, X-Frame-Options: DENY, etc.) | `src/server.ts` — Fastify helmet equivalent | ✅ Implemented |
| CSP on dashboard | `dashboard/` — Content-Security-Policy | ✅ Implemented |

**Gap Actions:**
- Add built-in TLS termination option
- Implement IP allowlist configuration
- Add network segmentation guidance for enterprise deployments

### CC6.7 — Data Encryption at Rest

**Control:** Encrypt sensitive data at rest.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Hook secrets: AES-256-GCM with scrypt-derived key | `src/hooks.ts` — encryption functions | ✅ Implemented |
| API keys: SHA-256 hash storage (no plaintext) | `src/config.ts` — `hashApiKey()` | ✅ Implemented |
| Key store file mode `0o600` | `src/config.ts` — `secureFilePermissions()` | ✅ Implemented |

**Gap Actions:**
- Encrypt session state, metrics, metering, and audit logs at rest
- Implement filesystem-level encryption guidance for deployers
- Add encryption-at-rest configuration options

### CC6.8 — Data Encryption in Transit

**Control:** Encrypt data during transmission.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| All channel integrations use HTTPS | Telegram, Slack, Email, Webhook channels | ✅ Implemented |
| CORS origin explicitly configured | `src/server.ts` | ✅ Implemented |

**Gap Actions:**
- Add built-in TLS termination
- Provide reverse proxy configuration guides (nginx, caddy)
- Document SSE/WebSocket encryption requirements

### CC7.1 — Vulnerability Management

**Control:** Identify and remediate vulnerabilities.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Zod schema validation on all inputs | `src/routes/*.ts` — input schemas | ✅ Implemented |
| Path traversal prevention | `src/utils/` — path sanitization | ✅ Implemented |
| Command injection prevention (`execFile` only) | `src/` — no `exec()` or `shell: true` | ✅ Implemented |
| CI bans `shell: true` | `.github/workflows/` — lint rules | ✅ Implemented |
| Env var name validation with denylist | `src/routes/sessions.ts` — env validation | ✅ Implemented |
| Sigstore attestations for release artifacts | Release workflow — provenance | ✅ Implemented |

**Gap Actions:**
- Add automated vulnerability scanning (Snyk/Trivy) in CI
- Enable CodeQL static analysis on `develop` branch
- Implement prompt injection mitigations

### CC7.2 — Incident Monitoring

**Control:** Monitor systems for security incidents.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Tamper-evident audit chain (SHA-256, daily rotation) | `src/audit.ts` — chained audit logger | ✅ Implemented |
| Structured JSON logging with token redaction | `src/logger.ts` — serializers | ✅ Implemented |
| Stall detection + dead session diagnostics | `src/sessionManager.ts` — health checks | ✅ Implemented |
| Alert webhooks for session failures | `src/` — webhook alert system | ✅ Implemented |
| OpenTelemetry tracing (placeholder) | `src/` — OTel integration | ⚠️ Placeholder |

**Gap Actions:**
- Complete end-to-end OpenTelemetry wiring
- Add Prometheus alert rules
- Create incident response runbook (see [incident-response.md](./incident-response.md))

### CC7.3 — Security Event Logging

**Control:** Log security events.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Audit logger: key CRUD, quota changes, authenticated calls | `src/audit.ts` — event types | ✅ Implemented |
| SHA-256 chained daily audit files | `src/audit.ts` — chain integrity | ✅ Implemented |
| Token and secret redaction in all log serializers | `src/logger.ts` — redaction rules | ✅ Implemented |

**Gap Actions:**
- Add SIEM integration guide
- Implement audit log export API (P1-8)

### CC8.1 — Change Management

**Control:** Manage changes to the system.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Release Please for versioned releases | `.github/workflows/` — release automation | ✅ Implemented |
| Sigstore attestations for provenance | Release workflow — attestations | ✅ Implemented |
| Branch protection: all PRs → `develop`, mandatory review | GitHub branch protection rules | ✅ Implemented |
| Quality gate: `npm run gate` | `package.json` — gate script | ✅ Implemented |

**Gap Actions:**
- Document formal change advisory process
- Implement deployment rollback automation
- Add change freeze windows for release candidates

### CC9.1 — Risk Mitigation

**Control:** Identify and mitigate risks to the system.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Enterprise gap analysis (P0/P1/P2 backlog) | [`docs/enterprise/00-gap-analysis.md`](../enterprise/00-gap-analysis.md) | ✅ Implemented |
| ADRs for architectural decisions | [`docs/adr/`](../adr/) | ✅ Implemented |

**Gap Actions:**
- Create formal risk register
- Establish periodic risk assessment cadence
- Document threat model

---

## Availability (A1)

### A1.2 — System Availability

**Control:** Maintain system availability.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Graceful shutdown with configurable drain period | `src/server.ts` — shutdown handler | ✅ Implemented |
| Session recovery and orphan reaping | `src/sessionManager.ts` — recovery logic | ✅ Implemented |
| ACP backend health monitoring | `src/` — child-process crash reconciliation | ✅ Implemented |

**Gap Actions:**
- Implement clustering / horizontal scaling (Redis state backend)
- Define SLA targets
- Add health check endpoints with liveness/readiness probes

### A1.3 — Backup and Recovery

**Control:** Back up data and test recovery procedures.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| State file backup on write | `state.json` → `state.json.bak` | ✅ Implemented |
| Atomic file writes (temp + rename) | `src/` — write patterns | ✅ Implemented |

**Gap Actions:**
- Implement automated backup schedule
- Add off-site backup configuration
- Create and test disaster recovery runbook (see [`docs/DISASTER_RECOVERY.md`](../DISASTER_RECOVERY.md))

---

## Processing Integrity (PI1)

### PI1.3 — Data Processing Accuracy

**Control:** Ensure data is processed accurately.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Zod schema validation on all inputs | `src/routes/*.ts` | ✅ Implemented |
| Atomic state persistence | `src/` — temp + rename writes | ✅ Implemented |
| Dual-offset read model for monitoring | `src/sessionManager.ts` | ✅ Implemented |

**Gap Actions:**
- Build end-to-end data validation pipeline
- Add reconciliation tooling for metrics/metering data

---

## Confidentiality (C1)

### C1.2 — Data Classification

**Control:** Classify data to protect confidentiality.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| Auth tokens and API keys treated as secrets | `src/` — handling patterns | ✅ Implemented |
| Log redaction for tokens and secrets | `src/logger.ts` | ✅ Implemented |

**Gap Actions:**
- Define formal data classification scheme (public, internal, confidential, restricted)
- Implement DLP controls
- Add labeling framework

### C1.3 — Confidential Data Protection

**Control:** Protect confidential data.

| Aegis Feature | Evidence | Status |
|---------------|----------|--------|
| API keys hashed, hook secrets encrypted | `src/config.ts`, `src/hooks.ts` | ✅ Implemented |
| File permissions enforced | `secureFilePermissions()` | ✅ Implemented |
| SSRF protection | `src/utils/ssrf.ts` | ✅ Implemented |
| Path traversal prevention | `src/utils/` | ✅ Implemented |

**Gap Actions:**
- Encrypt on-disk data beyond secrets (session state, audit logs)
- Add data masking in non-log outputs
- Truncate webhook payload session details

---

## Updating This Document

When adding a security-relevant feature to Aegis:

1. Identify which Trust Services Criterion the feature satisfies.
2. Add a row to the relevant table with the feature name, evidence source, and status.
3. If the feature closes a gap, remove it from the gap actions and update status.
4. Also update the summary checklist in [`docs/COMPLIANCE.md`](../COMPLIANCE.md).
