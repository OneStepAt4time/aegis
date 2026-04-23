# Aegis Compliance Documentation

> **Scope:** This document covers SOC 2 Type II readiness, GDPR data mapping, and HIPAA
> considerations for the Aegis platform (`@onestepat4time/aegis`).
>
> **Last reviewed:** 2026-04-23 | **Aegis version:** 0.6.0-preview
>
> **Status:** Pre-compliance. Aegis is in Phase 1 (Foundations). SOC 2 audit preparation and
> formal compliance programs are targeted for Phase 4 (Enterprise GA). This document
> establishes the control inventory and gap register that Phase 4 work will close.

---

## Table of Contents

1. [SOC 2 Type II Readiness Checklist](#1-soc-2-type-ii-readiness-checklist)
2. [GDPR Data Mapping](#2-gdpr-data-mapping)
3. [HIPAA Considerations](#3-hipaa-considerations)
4. [Cross-Reference Matrix](#4-cross-reference-matrix)

---

## 1. SOC 2 Type II Readiness Checklist

SOC 2 evaluates service organizations against the Trust Services Criteria (TSC). The five
categories are Security (required), Availability, Processing Integrity, Confidentiality, and
Privacy. The checklist below maps each criterion to Aegis's current posture, identifies the
responsible component, and flags gaps.

### 1.1 Security (CC6 – CC9)

| # | Control | Status | Implementation | Gap / Action Item |
|---|---------|--------|----------------|-------------------|
| CC6.1 | Logical access controls | **Partial** | API key authentication with SHA-256 hashing. Master token + per-key roles (admin / operator / viewer). Per-key permissions and quotas. Timing-safe token comparison prevents timing attacks. | Per-action RBAC not yet implemented (P0-6). Session ownership enforcement incomplete — any valid key can operate on any session (P0-1). |
| CC6.2 | Authentication | **Partial** | Bearer token auth on all routes. Rate limiting (100 sessions/min, 30 general/min). Per-IP auth failure tracking with lockout. SSE tokens: 60 s TTL, single-use, max 5 per key. | No SSO / OIDC (Phase 3). No MFA. API keys have no mandatory expiry — rotation is manual. |
| CC6.3 | Authorization | **Partial** | Three roles with permission policies. `enforceSessionOwnership: true` by default. Dashboard auth required. Metrics endpoint gated by dedicated token. | Coarse RBAC — no per-action granularity. No attribute-based access control. |
| CC6.6 | Network security | **Partial** | Listens on `127.0.0.1` by default (localhost-only). SSRF blocklist (RFC 1918, loopback, link-local, IPv6 ULA, IPv4-mapped IPv6, CGNAT, multicast). CORS wildcard explicitly rejected. Security headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. CSP on dashboard. | No built-in TLS — relies on reverse proxy for HTTPS. No network segmentation controls. No IP allowlist configuration. |
| CC6.7 | Data encryption at rest | **Partial** | Hook secrets encrypted with AES-256-GCM (scrypt-derived key). API keys stored as SHA-256 hashes only. Key store file mode `0o600` + `secureFilePermissions()`. | Session state, metrics, metering, audit logs, memory bridge, and config files are **not encrypted** at rest — rely on OS file permissions and filesystem encryption. |
| CC6.8 | Data encryption in transit | **Partial** | Telegram / Slack / Email / Webhook channels use HTTPS. CORS origin explicitly configured. | No built-in TLS termination. HTTP by default — HTTPS requires reverse proxy. SSE/WebSocket traffic plaintext without proxy. |
| CC7.1 | Vulnerability management | **Partial** | Zod schema validation on all inputs. Path traversal prevention. Command injection prevention (`execFile` only, no `exec()`). CI bans `shell: true`. Env var name validation with denylist. Sigstore attestations for release artifacts. | No automated vulnerability scanning (Snyk, Trivy) in CI. No static analysis (CodeQL) on `develop` branch. Prompt injection not yet mitigated. |
| CC7.2 | Incident monitoring | **Partial** | Tamper-evident audit chain (SHA-256, daily rotation). Structured JSON logging with token redaction. Stall detection, dead session diagnostics. Alert webhooks for session failures and tmux crashes. OpenTelemetry tracing (placeholder). | No end-to-end OpenTelemetry wiring. No Prometheus alert rules. No incident response runbook. |
| CC7.3 | Security event logging | **Strong** | Audit logger records: key creation, revocation, rotation, quota changes, authenticated API calls (key ID + method + path). SHA-256 chained daily files ensure tamper evidence. Auth token and hook-secret redaction in all log serializers. | No centralized log management (SIEM). No audit log export API (P1-8). |
| CC8.1 | Change management | **Partial** | Release Please for versioned releases. Sigstore attestations for provenance. Branch protection: all PRs target `develop`, Argus reviews and merges. `npm run gate` quality gate. | No formal change advisory board process. No deployment rollback automation. |
| CC9.1 | Risk mitigation | **Partial** | Enterprise gap analysis completed with prioritized backlog (P0/P1/P2). ADRs for architectural decisions. | No formal risk register. No periodic risk assessment cadence. |

### 1.2 Availability (A1)

| # | Control | Status | Implementation | Gap / Action Item |
|---|---------|--------|----------------|-------------------|
| A1.2 | System availability | **Partial** | Graceful shutdown with configurable drain period. Session recovery and orphan reaping. Tmux health monitoring with crash reconciliation. | Single-node, single-process — no clustering or horizontal scaling. No HA configuration. No SLA defined. |
| A1.3 | Backup and recovery | **Gap** | State files backed up on write (`state.json` → `state.json.bak`). Atomic file writes (temp + rename). | No automated backup schedule. No off-site backup. No disaster recovery runbook. No restore testing. |

### 1.3 Processing Integrity (PI1)

| # | Control | Status | Implementation | Gap / Action Item |
|---|---------|--------|----------------|-------------------|
| PI1.3 | Data processing accuracy | **Partial** | Zod schema validation on all inputs. Atomic state persistence. Dual-offset read model for session monitoring. | No end-to-end data validation pipeline. No reconciliation tooling for metrics/metering data. |

### 1.4 Confidentiality (C1)

| # | Control | Status | Implementation | Gap / Action Item |
|---|---------|--------|----------------|-------------------|
| C1.2 | Data classification | **Gap** | Implicit — auth tokens and API keys treated as secrets. Log redaction for tokens and secrets. | No formal data classification scheme. No DLP controls. No labeling framework. |
| C1.3 | Confidential data protection | **Partial** | API keys hashed, hook secrets encrypted, file permissions enforced, SSRF protection, path traversal prevention. | Most on-disk data unencrypted. No data masking in non-log outputs. Webhook payloads contain session details (truncated to 2000 chars). |

### 1.5 Privacy (P1 – P8)

| # | Control | Status | Implementation | Gap / Action Item |
|---|---------|--------|----------------|-------------------|
| P1.1 | Notice | **Gap** | No privacy notice mechanism. | No privacy policy published. No user-facing data collection notice. |
| P2.1 | Consent | **Gap** | No consent management. | No mechanism to record or manage data subject consent. |
| P3.1 | Collection | **Partial** | Data collected is operational: session metadata, usage metrics, audit records. No analytics or telemetry sent to third parties. | No documented collection purpose limitation. |
| P4.1 | Use, retention, disposal | **Gap** | No retention policy implemented. | No automatic data expiry or deletion. See [RETENTION_POLICY.md](./RETENTION_POLICY.md). |
| P5.1 | Access | **Gap** | No DSAR mechanism. | No API or UI for data subject access requests (GDPR Art. 15). |
| P6.1 | Disclosure | **Partial** | Data disclosed only to configured channels (Telegram, Slack, email, webhooks). No analytics or advertising integrations. | No formal third-party disclosure inventory. No subprocessors list. |
| P8.1 | Inquiry / complaints | **Gap** | No designated privacy contact. | No DPO appointed. No privacy contact published. |

---

## 2. GDPR Data Mapping

### 2.1 Controller and Processor Status

Aegis is **self-hosted software** distributed under the MIT license. The deployer (the entity
running the Aegis server) is the **data controller** for all personal data processed through
their Aegis instance. Aegis (the open-source project) does not operate as a data processor —
it does not host, receive, or process personal data on behalf of deployers.

This data map describes what the Aegis runtime processes so deployers can fulfill their GDPR
obligations.

### 2.2 Data Categories

#### 2.2.1 Personal Data Processed

| Category | Data Elements | Storage Location | Retention | GDPR Basis |
|----------|--------------|-----------------|-----------|------------|
| **Authentication credentials** | API key hashes (SHA-256), key names, roles, permissions | `{stateDir}/keys.json` | Until manually revoked | Legitimate interest (Art. 6(1)(f)) |
| **Audit trail** | Key ID, HTTP method, path, timestamp, detail text | `{stateDir}/audit/YYYY-MM-DD.jsonl` | Indefinite (no auto-deletion) | Legitimate interest (security, Art. 6(1)(f)) |
| **Session metadata** | Session ID (UUID), window name, working directory, status, timestamps, model, owner key ID | SessionManager state → `{stateDir}/` | Until session deleted | Legitimate interest (service delivery) |
| **Session content** | User prompts, assistant responses, tool calls, file paths, code | JSONL transcript files (Claude Code) | Until manually deleted | Legitimate interest (service delivery) |
| **Usage metrics** | Token counts, estimated costs (USD), session durations, per-session and per-key aggregation | `{stateDir}/metrics.json`, `{stateDir}/metering.json` | Until manually deleted | Legitimate interest (billing/monitoring) |
| **Configuration** | Auth tokens, Telegram bot token / group ID / allowed user IDs, webhook URLs, Slack tokens, email credentials | Config file (`aegis.config.json` or equivalent) | Until config changed | Legitimate interest (service operation) |
| **Notification payloads** | Session events (status, message excerpts up to 2000 chars, session ID, work directory) | Transmitted to Telegram / Slack / Email / Webhook — not persisted by Aegis | Transient (fire-and-forget) | Legitimate interest (monitoring) |
| **Terminal captures** | Raw tmux pane content (user input, command output, code) | In-memory only during monitoring cycle | Ephemeral (not persisted) | Legitimate interest (monitoring) |

#### 2.2.2 Special Category Data (Art. 9)

Aegis does **not** intentionally collect or process special category data (racial/ethnic origin,
political opinions, religious beliefs, trade union membership, genetic data, biometric data,
health data, or data concerning sex life or sexual orientation).

However, because Aegis processes Claude Code session transcripts that may contain arbitrary
user-generated content, deployers must assess whether session content could incidentally
include special category data and apply appropriate safeguards.

#### 2.2.3 Data Not Considered Personal

| Data | Rationale |
|------|-----------|
| Session IDs (UUIDs) | Generated with `crypto.randomUUID()`. Not derived from personal identifiers. Not linkable to a natural person without correlation with other data. |
| API key IDs (16 hex chars) | Random identifiers. Not personal on their own. |
| Rate limit buckets | Aggregated counts per key/IP, ephemeral (1-minute window), not persisted. |
| Quota usage entries | In-memory rolling window (1 hour), pruned every 5 minutes, not persisted. |
| SSE tokens | 60-second TTL, single-use, ephemeral, not persisted. |

### 2.3 Data Flow Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AEGIS RUNTIME                                │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │ HTTP API │───>│ AuthManager  │───>│ keys.json    │ (at rest)    │
│  │ (Fastify)│    │ (SHA-256)    │    │ mode 0o600   │              │
│  └────┬─────┘    └──────────────┘    └──────────────┘              │
│       │                                                             │
│       │         ┌──────────────┐    ┌──────────────┐              │
│       ├────────>│ SessionMgr   │───>│ state.json   │ (at rest)    │
│       │         │              │    │ *.jsonl      │              │
│       │         └──────────────┘    └──────────────┘              │
│       │                                                             │
│       │         ┌──────────────┐    ┌──────────────┐              │
│       ├────────>│ AuditLogger  │───>│ audit/*.jsonl│ (at rest)    │
│       │         │ (SHA-256)    │    │ daily rotate │              │
│       │         └──────────────┘    └──────────────┘              │
│       │                                                             │
│       │         ┌──────────────┐    ┌──────────────┐              │
│       ├────────>│ Monitor      │───>│ memory       │ (in-process) │
│       │         │              │    │ (ephemeral)  │              │
│       │         └──────┬───────┘    └──────────────┘              │
│       │                │                                          │
│  ┌────┴─────┐    ┌─────┴──────┐    ┌──────────────┐              │
│  │ Metrics  │───>│ QuotaMgr   │───>│ metrics.json │ (at rest)    │
│  │ Endpoint │    │ (in-mem)   │    │ metering.json│              │
│  └──────────┘    └────────────┘    └──────────────┘              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────┐           │
│  │ Notification Channels (outbound, HTTPS)             │           │
│  │  • Telegram API  • Slack Webhook  • SMTP Email      │           │
│  │  • Custom Webhooks                                  │           │
│  └─────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.4 Data Subject Rights Implementation Status

| Right (GDPR Article) | Status | Mechanism | Gap |
|----------------------|--------|-----------|-----|
| **Access** (Art. 15) | **Not implemented** | No API or UI to export all data for a subject. | Deployer must manually query state files and audit logs. Requires audit export API (P1-8). |
| **Rectification** (Art. 16) | **N/A** | Aegis stores operational metadata, not user-submitted personal records. Rectification of key names is supported via key rotation. | — |
| **Erasure** (Art. 17) | **Not implemented** | Key revocation removes credentials. Session kill removes active state. Historical audit logs, metrics, metering, and JSONL transcripts are not automatically deleted. | Requires right-to-erasure implementation across all data stores. See [RETENTION_POLICY.md](./RETENTION_POLICY.md). |
| **Restriction** (Art. 18) | **Partial** | Key revocation restricts future access. Rate limiting and quotas restrict processing volume. | No mechanism to freeze but retain data for a specific subject. |
| **Portability** (Art. 20) | **Not implemented** | No structured export of all data associated with a key or session. | Requires audit export API and session data export tooling. |
| **Objection** (Art. 21) | **Not implemented** | No opt-out mechanism for processing. | Deployer must handle objections manually. |
| **Automated decision-making** (Art. 22) | **N/A** | Aegis does not make automated decisions with legal or similarly significant effects on data subjects. | — |

### 2.5 Cross-Border Transfers

Aegis is self-hosted software. Data processing occurs entirely within the deployer's
infrastructure. No data is transmitted to Aegis project infrastructure, Anthropic, or any
cloud service by default.

The following third-party channels are **opt-in** and may involve cross-border transfers
depending on deployer configuration:

| Channel | Data Flow | Transfer Mechanism |
|---------|-----------|-------------------|
| Telegram Bot API | Session event payloads | Telegram's DPA applies. Deployer must ensure adequate transfer mechanism. |
| Slack Webhooks | Session event payloads | Slack's DPA applies. Deployer must ensure adequate transfer mechanism. |
| Email (SMTP) | Session event payloads | Depends on mail provider. Deployer must ensure adequate transfer mechanism. |
| Custom Webhooks | Session event payloads | Deployer-configured endpoints. Deployer is responsible for transfer compliance. |

### 2.6 Subprocessors

Aegis does not operate subprocessors. The deployer is the data controller and is responsible
for identifying and disclosing any subprocessors (cloud providers, reverse proxies, database
services) they use in conjunction with their Aegis deployment.

### 2.7 Data Processing Records (Art. 30)

Deployers should maintain records of processing activities. The following template is provided:

| Field | Aegis Value |
|-------|-------------|
| Controller name | *[Deployer legal entity]* |
| Controller contact | *[Deployer DPO / privacy contact]* |
| Processing purpose | Software development session management and monitoring |
| Data categories | Authentication credentials, session metadata, session content, usage metrics, audit records |
| Data subjects | Developers, team members using Claude Code via Aegis |
| Recipients | Notification channels (Telegram, Slack, email, webhooks) as configured by deployer |
| International transfers | None by default. Depends on deployer's channel configuration. |
| Retention period | See [RETENTION_POLICY.md](./RETENTION_POLICY.md) |
| Security measures | See Section 1.1 (Security controls) above |

---

## 3. HIPAA Considerations

### 3.1 Positioning Statement

Aegis is **not** a HIPAA-covered product and is not marketed for use with Protected Health
Information (PHI). Aegis is a developer productivity tool that manages Claude Code sessions.
It does not provide a BAA, is not designed for healthcare workloads, and should not be used
to create, receive, maintain, or transmit PHI.

### 3.2 Why HIPAA Matters for Aegis

Despite not being a covered entity, deployers in healthcare-adjacent organizations may ask
about HIPAA readiness because:

1. **Claude Code sessions may process code that interacts with healthcare systems.**
2. **Developers at covered entities may use Aegis as part of their development workflow.**
3. **Procurement processes at healthcare organizations often require HIPAA assessments** for all
   software in the development environment, even if PHI is not directly processed.

### 3.3 HIPAA Security Rule Mapping

The following maps select HIPAA Security Rule standards to Aegis's current posture, for
informational purposes only. This is not a HIPAA compliance attestation.

#### Administrative Safeguards (45 CFR § 164.308)

| Standard | Status | Notes |
|----------|--------|-------|
| Security Management Process (§ 164.308(a)(1)) | **Partial** | Enterprise gap analysis completed. Prioritized backlog exists. No formal risk management plan. |
| Assigned Security Responsibility (§ 164.308(a)(2)) | **Gap** | No designated security officer for the project. Deployer must assign. |
| Workforce Security (§ 164.308(a)(3)) | **Partial** | API key roles (admin / operator / viewer) provide basic workforce authorization. No provisioning/deprovisioning automation. |
| Information Access Management (§ 164.308(a)(4)) | **Partial** | Session ownership enforcement. Per-key permissions. No isolation between projects or tenants. |
| Security Awareness Training (§ 164.308(a)(5)) | **Not applicable** | Deployer responsibility. Aegis project maintains SECURITY.md. |
| Incident Response (§ 164.308(a)(6)) | **Partial** | Tamper-evident audit logs. Alert webhooks. No formal incident response plan. |
| Contingency Plan (§ 164.308(a)(7)) | **Gap** | State file backup (`.bak`). No DR runbook. No automated backup. No failover. |

#### Physical Safeguards (45 CFR § 164.310)

| Standard | Status | Notes |
|----------|--------|-------|
| Facility Access Controls (§ 164.310(a)(1)) | **Deployer responsibility** | Aegis is software-only. Physical security of the host is the deployer's responsibility. |
| Workstation Use (§ 164.310(b)) | **Deployer responsibility** | Dashboard accessible via browser. Token storage in localStorage (known gap P0-8). |
| Device and Media Controls (§ 164.310(d)(1)) | **Partial** | Data stored on local filesystem. File permissions enforced (0o600 for sensitive files). No media sanitization controls. |

#### Technical Safeguards (45 CFR § 164.312)

| Standard | Status | Notes |
|----------|--------|-------|
| Access Control (§ 164.312(a)(1)) | **Partial** | Bearer token authentication. Role-based permissions. No emergency access procedure. No auto-logoff (dashboard sessions persist). |
| Audit Controls (§ 164.312(b)) | **Strong** | SHA-256 chained daily audit logs. Records key ID, method, path, timestamp. Tamper-evident. |
| Integrity (§ 164.312(c)(1)) | **Partial** | Zod input validation. Atomic state writes. Audit chain integrity. No electronic signature mechanism. |
| Person or Entity Authentication (§ 164.312(d)) | **Partial** | API key + master token authentication. No MFA. No certificate-based auth. |
| Transmission Security (§ 164.312(e)(1)) | **Partial** | HTTPS for notification channels (Telegram, Slack, webhooks). No built-in TLS — reverse proxy required for HTTPS. |

### 3.4 Recommendations for Healthcare Deployers

If a covered entity must deploy Aegis, the following additional safeguards are recommended:

1. **Deploy behind an HTTPS reverse proxy** with TLS 1.2+ enforcement.
2. **Enable master token authentication** and rotate keys regularly.
3. **Configure filesystem-level encryption** (e.g., LUKS, BitLocker) on the host storing `{stateDir}/`.
4. **Restrict notification channels** to internal endpoints only — do not send session events to third-party SaaS (Telegram, Slack) if PHI may be present in session content.
5. **Implement a BAA with Anthropic** for Claude API usage, if Claude processes PHI as part of development workflows.
6. **Audit log retention** must meet the 6-year HIPAA retention requirement. Configure automatic archival.
7. **Network isolation** — run Aegis on a restricted network segment with no internet egress if PHI is involved.

---

## 4. Cross-Reference Matrix

Maps compliance controls to the enterprise gap analysis (P0/P1/P2) and roadmap phase.

| Compliance Need | SOC 2 TSC | GDPR Article | HIPAA Section | Gap ID | Phase |
|-----------------|-----------|-------------|---------------|--------|-------|
| Per-action RBAC | CC6.3 | Art. 25 (DPbD) | § 164.312(a)(1) | P0-6 | 2 |
| Session ownership | CC6.1 | Art. 25 | § 164.312(a)(1) | P0-1 | 1 (in progress) |
| Env var denylist | CC7.1 | Art. 32 | § 164.312(c)(1) | P0-2 | 1 (ADR-0020) |
| TLS termination | CC6.8 | Art. 32 | § 164.312(e)(1) | — | Deployer |
| Encryption at rest | CC6.7 | Art. 32 | § 164.312(a)(2)(iv) | P2-7 | 4 |
| SSO / OIDC | CC6.2 | Art. 25 | § 164.312(d) | — | 3 |
| Multi-tenancy | CC6.1 | Art. 25, 28 | § 164.308(a)(4) | P1-1 | 3 |
| Audit export API | CC7.3 | Art. 15, 20 | § 164.312(b) | P1-8 | 2 |
| Data retention policy | P4.1 | Art. 5(1)(e), 17 | § 164.530(j) | P2-2 | 4 |
| DPA template | P6.1 | Art. 28 | — | P2-2 | 4 |
| Incident runbook | CC7.2 | Art. 33, 34 | § 164.308(a)(6) | P2-6 | 4 |
| DR / backup | A1.3 | Art. 32 | § 164.308(a)(7) | P2-6 | 4 |
| Secrets manager | CC6.7 | Art. 32 | § 164.312(a)(2)(iv) | P2-7 | 4 |

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-23 | 1.0.0 | Initial compliance documentation: SOC 2 checklist, GDPR data map, HIPAA considerations. |
