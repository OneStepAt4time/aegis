# Aegis Security Questionnaire — Pre-Filled Response

> **Purpose:** Pre-completed security questionnaire for Aegis (`@onestepat4time/aegis`) to
> accelerate vendor security reviews by customer trust and procurement teams.
>
> **Last updated:** 2026-04-23 | **Aegis version:** 0.6.0-preview
>
> **How to use:** Copy this document and customize bracketed fields (`[...]`) for your
> deployment. Provide it to customers or prospects during vendor security assessments.

---

## Table of Contents

1. [Company and Product Overview](#1-company-and-product-overview)
2. [Data Handling and Privacy](#2-data-handling-and-privacy)
3. [Infrastructure and Deployment](#3-infrastructure-and-deployment)
4. [Access Control](#4-access-control)
5. [Encryption](#5-encryption)
6. [Network Security](#6-network-security)
7. [Vulnerability Management](#7-vulnerability-management)
8. [Logging and Monitoring](#8-logging-and-monitoring)
9. [Incident Response](#9-incident-response)
10. [Business Continuity](#10-business-continuity)
11. [Third-Party and Supply Chain](#11-third-party-and-supply-chain)
12. [Compliance and Certifications](#12-compliance-and-certifications)
13. [Application Security](#13-application-security)
14. [Personnel Security](#14-personnel-security)
15. [Physical Security](#15-physical-security)

---

## 1. Company and Product Overview

### 1.1 General Information

| Question | Response |
|----------|----------|
| **Company / Project name** | Aegis (`@onestepat4time/aegis`) |
| **Product description** | Self-hosted control plane for Claude Code sessions. Provides REST API, MCP server, SSE streaming, WebSocket, CLI, and notification channels for managing AI-assisted development sessions. |
| **License** | MIT (open source) |
| **URL** | [GitHub repository URL] |
| **Deployment model** | Self-hosted only. No SaaS offering. Customer deploys on their own infrastructure. |
| **Current version** | 0.6.0-preview (alpha / preview phase) |
| **Product maturity** | Phase 1 (Foundations) complete. Phase 2 (Developer Delight + Team-Ready) in planning. Production-ready for single-user and small-team deployments. |
| **Primary programming language** | TypeScript (Node.js ≥ 20) |
| **Key dependencies** | Fastify v5 (HTTP), tmux ≥ 3.2 (session management), Claude Code CLI (agent runtime), Zod (validation), OpenTelemetry (tracing) |
| **Intended use case** | Developer productivity tool for managing and monitoring Claude Code AI coding sessions. |
| **Data controller** | The deploying organization (not the Aegis project). Aegis is software; the deployer is the data controller for all data processed through their instance. |

### 1.2 Scope of Assessment

This questionnaire covers the Aegis **software product**, not a hosted service. Because Aegis is
self-hosted, infrastructure security (cloud provider, data center, networking) is the deploying
organization's responsibility and is noted as such throughout.

---

## 2. Data Handling and Privacy

### 2.1 Data Collection

| Question | Response |
|----------|----------|
| **What personal data does the product collect?** | Aegis collects operational data: API key names, session metadata (IDs, working directories, timestamps, model identifiers), usage metrics (token counts, estimated costs), and audit records (key IDs, HTTP methods, paths). Claude Code session transcripts (user prompts, assistant responses, tool calls) are processed through Aegis but stored by Claude Code, not by Aegis directly. |
| **Does the product collect special category data (Art. 9 GDPR)?** | No. Aegis does not intentionally collect special category data. Session content is user-generated and may theoretically contain any data type; the deployer is responsible for governing what is processed. |
| **Does the product collect data from minors?** | No. |
| **What is the legal basis for processing?** | Legitimate interest (GDPR Art. 6(1)(f)) for operational data (authentication, session management, monitoring). The deployer determines the legal basis for any personal data in session content. |
| **Is consent obtained before data collection?** | Not by the product. The deployer is responsible for consent management. |
| **Does the product share data with third parties?** | Only when the deployer configures notification channels (Telegram, Slack, email, custom webhooks). All third-party data sharing is opt-in and deployer-controlled. No analytics, advertising, or telemetry data is sent to the Aegis project or any third party by default. |
| **Does the product sell user data?** | No. |
| **Does the product use data for advertising?** | No. |

### 2.2 Data Storage

| Question | Response |
|----------|----------|
| **Where is data stored?** | On the deployer's infrastructure. Aegis stores data in a configurable state directory (default: `~/.aegis/`) on the host filesystem. No data is sent to Aegis project infrastructure. |
| **Data residency** | Determined entirely by the deployer. Aegis processes data wherever it is installed. No remote data transmission occurs unless the deployer configures notification channels. |
| **Data retention** | See [RETENTION_POLICY.md](./RETENTION_POLICY.md). Default behavior: data accumulates indefinitely. Deployer must configure retention. |
| **Data deletion** | Supported via API (key revocation, session kill) and filesystem operations. No automated data expiry in the current version. Deployer is responsible for implementing retention schedules. |
| **Data subject access requests (DSAR)** | No automated DSAR mechanism. Deployer must handle DSARs manually by querying state files and audit logs. Audit export API is planned for Phase 2. |

### 2.3 Data Processing Records

| Question | Response |
|----------|----------|
| **Does the product maintain Art. 30 records of processing?** | No. The deployer is responsible for maintaining processing records. A template is provided in [COMPLIANCE.md](./COMPLIANCE.md) Section 2.7. |
| **Is a Data Protection Officer (DPO) designated?** | Not by the Aegis project. The deployer must designate a DPO if required by applicable law. |

---

## 3. Infrastructure and Deployment

### 3.1 Deployment Architecture

| Question | Response |
|----------|----------|
| **Deployment model** | Self-hosted. Single binary (`ag`) or Docker container. Runs as a single Fastify HTTP server process. |
| **Minimum infrastructure** | Single Linux server (or macOS / Windows with WSL). Node.js ≥ 20. tmux ≥ 3.2. Claude Code CLI installed and authenticated. |
| **Supported platforms** | Linux (primary), macOS, Windows (via WSL). |
| **Horizontal scaling** | Not supported in current version. Single-node, single-process. Horizontal scaling planned for Phase 4. |
| **High availability** | Not supported. Graceful shutdown with configurable drain period. Session recovery on restart. |
| **Container support** | Yes. Docker images available. Helm chart planned for Phase 2. |
| **Air-gapped deployment** | Possible. No external network calls required. All notification channels are opt-in. Claude Code CLI must be pre-authenticated. |

### 3.2 Infrastructure Security

| Question | Response |
|----------|----------|
| **Who manages the infrastructure?** | The deploying organization. Aegis is self-hosted software. |
| **Network binding** | Binds to `127.0.0.1` (localhost) by default. Can be configured to bind to `0.0.0.0` for network access. Reverse proxy recommended for production. |
| **TLS / HTTPS** | Not built in. Aegis serves HTTP. HTTPS requires a reverse proxy (nginx, Caddy, Traefik) or tunnel (Cloudflare Tunnel, ngrok). |
| **Data center certifications** | Deployer's responsibility. Aegis does not mandate specific data center standards. |

---

## 4. Access Control

### 4.1 Authentication

| Question | Response |
|----------|----------|
| **Authentication method** | Bearer token authentication. Two-tier: master token (full access) + API keys (role-based). |
| **API key storage** | SHA-256 hashed. Plaintext keys never stored — returned only once at creation. Key store file mode `0o600` (owner-only). |
| **Key generation** | `crypto.randomBytes(32)` — 64 hex characters, cryptographically secure. |
| **Key rotation** | Supported via `POST /v1/keys/:id/rotate` and `POST /v1/keys/:id/rotate-with-grace`. Grace period allows overlap of old and new keys during rotation. |
| **Multi-factor authentication (MFA)** | Not supported in current version. SSO / OIDC planned for Phase 3. |
| **Session timeout** | No session timeout for API keys (stateless Bearer tokens). SSE tokens expire after 60 seconds. Dashboard tokens are ephemeral. |
| **Brute-force protection** | Yes. Per-IP auth failure tracking with lockout. Rate limiting: 100 sessions/min, 30 general/min per key. |
| **Timing attack prevention** | Yes. All token comparisons use `crypto.timingSafeEqual()`. |

### 4.2 Authorization

| Question | Response |
|----------|----------|
| **Authorization model** | Role-based access control (RBAC). Three roles: admin, operator, viewer. Per-key permissions configurable. |
| **Permissions granularity** | Role-level in current version (create, read, send, approve, kill, manage keys). Per-action RBAC planned for Phase 2. |
| **Session ownership** | `enforceSessionOwnership: true` by default. Sessions are tagged with the creating key's ID. Actions on sessions are restricted to the owning key. |
| **API key scopes** | Yes. Each key has a role and optional permission overrides. Keys can be restricted to specific operations. |
| **Privileged access management** | Admin role required for key management and system configuration. No break-glass or emergency access procedure. |

### 4.3 Dashboard Access

| Question | Response |
|----------|----------|
| **Dashboard authentication** | Token-based. Dashboard requires authentication token. |
| **Token storage** | Currently stored in browser localStorage (known gap, P0-8). Migration to httpOnly cookie planned. |
| **Content Security Policy (CSP)** | Yes. CSP headers set on dashboard with explicit `connect-src`, `script-src`, `style-src` directives. |
| **Frame protection** | `X-Frame-Options: DENY` prevents clickjacking. |

---

## 5. Encryption

### 5.1 Encryption at Rest

| Question | Response |
|----------|----------|
| **Is data encrypted at rest?** | Partially. Hook secrets are encrypted with AES-256-GCM (scrypt-derived key). API keys are SHA-256 hashed (not reversible). Other data (session state, metrics, audit logs, config) relies on OS file permissions and is not encrypted by Aegis. |
| **Encryption algorithm** | AES-256-GCM for hook secrets. SHA-256 for API key hashing (one-way). |
| **Key derivation** | Scrypt with static salt (`'aegis-hook-key-v1'`) for hook secret encryption. Master auth token used as input key material. |
| **Key management** | Master auth token is the encryption key. No KMS integration. Secrets manager integration (Vault, KMS) planned for Phase 4. |
| **File permissions** | Sensitive files written with mode `0o600` (owner read/write only). `secureFilePermissions()` called on write. |
| **Recommendation** | Deployers should enable filesystem-level encryption (LUKS, BitLocker, encrypted EBS volumes) for the state directory. |

### 5.2 Encryption in Transit

| Question | Response |
|----------|----------|
| **Is data encrypted in transit?** | Partially. Notification channels (Telegram, Slack, webhooks, email) use HTTPS. Aegis itself serves HTTP — TLS termination requires a reverse proxy. |
| **TLS version** | Depends on reverse proxy configuration. Recommend TLS 1.2 minimum. |
| **Certificate management** | Deployer's responsibility. Aegis does not manage TLS certificates. |
| **Internal service communication** | In-process only (single binary). No inter-service encryption needed. |

---

## 6. Network Security

### 6.1 Network Controls

| Question | Response |
|----------|----------|
| **Default network binding** | `127.0.0.1` (localhost only). Does not listen on external interfaces by default. |
| **SSRF protection** | Yes. URL scheme validation (only `http` and `https` allowed). Private IP range blocklist: RFC 1918, loopback, link-local, IPv6 ULA, IPv4-mapped IPv6, CGNAT, multicast. |
| **CORS policy** | Explicit origin configuration required. Wildcard (`*`) is rejected. CORS origin set to `http://localhost:${port}` by default for dashboard. |
| **Security headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=()`. |
| **Rate limiting** | Yes. Configurable: 100 sessions/min, 30 general/min per API key. Per-IP auth failure lockout. |
| **IP allowlisting** | Not built in. Can be implemented at the reverse proxy level. |
| **Network segmentation** | Deployer's responsibility. |

---

## 7. Vulnerability Management

### 7.1 Secure Development

| Question | Response |
|----------|----------|
| **Secure SDLC process** | All PRs require review. Quality gate (`npm run gate`) must pass before merge. Branch protection on `develop`. Sigstore attestations for release artifacts. |
| **Input validation** | Zod schema validation on all API inputs. Path traversal prevention. Env var name validation with denylist. Port number validation. |
| **Command injection prevention** | `execFile()` exclusively — no `exec()`, no `shell: true`. CI enforces the ban on `shell: true`. |
| **Dependency management** | `npm audit` for known vulnerabilities. Sigstore attestations verify package integrity. |
| **Static analysis** | TypeScript strict mode. `npx tsc --noEmit` in CI. CodeQL not yet on `develop` branch (identified gap). |
| **Security code review** | All changes reviewed by maintainer (Argus). Security-relevant changes flagged in PR template. |

### 7.2 Vulnerability Reporting

| Question | Response |
|----------|----------|
| **Vulnerability disclosure policy** | Yes. Published in `SECURITY.md`. Preferred via GitHub Security Advisory. Fallback via Security Vulnerability issue template. |
| **Response time** | Acknowledgment within 48 hours. Security updates released through the active version line. |
| **Bug bounty program** | No formal bug bounty program. |
| **CVE tracking** | Security advisories published on GitHub. |

### 7.3 Known Security Gaps

The following security gaps are documented in the enterprise gap analysis and tracked in the
project backlog:

| Gap ID | Description | Severity | Phase |
|--------|-------------|----------|-------|
| P0-1 | Session ownership enforcement incomplete on all action routes | Critical | 1 (in progress) |
| P0-2 | Env var denylist gaps (PATH, LD_PRELOAD, etc.) | Critical | 1 (ADR-0020) |
| P0-6 | Coarse RBAC — no per-action permissions | High | 2 |
| P0-8 | Dashboard token in localStorage (XSS risk) | High | 2 |
| — | Prompt injection not mitigated | High | 2 |
| — | No automated vulnerability scanning in CI | Medium | 2 |
| P1-8 | No audit log export API | Medium | 2 |
| P2-7 | No secrets manager integration | Medium | 4 |

---

## 8. Logging and Monitoring

### 8.1 Audit Logging

| Question | Response |
|----------|----------|
| **Is audit logging enabled?** | Yes. All authenticated API requests are logged. |
| **What is logged?** | Key ID (not the key itself), HTTP method, request path, timestamp. Key lifecycle events (create, revoke, rotate, quota changes) are logged with key name, ID, and role. |
| **Log format** | JSON Lines (`*.jsonl`). Daily rotation. |
| **Log integrity** | SHA-256 chained. Each log entry includes a hash of the previous entry. Tampering breaks the chain and is detectable. |
| **Log retention** | Indefinite by default. No auto-deletion. See [RETENTION_POLICY.md](./RETENTION_POLICY.md). |
| **Sensitive data in logs** | Auth tokens are redacted (`token=[REDACTED]`). Hook secrets are redacted (`secret=[REDACTED]`). API keys are never logged. |
| **Sensitive data in API responses** | `hookSecret` and `hookSettingsFile` are redacted from all session API responses. Any API key holder can list sessions but cannot read hook secrets — they are encrypted at rest and stripped at serialization boundaries. |
| **Log access control** | File permissions (`0o600` recommended). Deployer controls access. |

### 8.2 Operational Monitoring

| Question | Response |
|----------|----------|
| **Health check endpoint** | `GET /v1/health` — returns version, uptime, active sessions. |
| **Metrics endpoint** | `GET /metrics` — Prometheus-compatible metrics. Gated by dedicated metrics token. Timing-safe comparison. |
| **Session monitoring** | Real-time status detection (idle, working, permission prompt, stalled, dead). Stall detection with configurable thresholds. Dead session diagnostics. |
| **Alerting** | Webhook-based alerting for session failures and tmux crashes. Configurable thresholds. |
| **OpenTelemetry** | Instrumentation present (placeholder). End-to-end wiring planned for Phase 3. |
| **Distributed tracing** | Not fully implemented. Request IDs generated per request (`X-Request-Id` header). |

---

## 9. Incident Response

### 9.1 Incident Detection

| Question | Response |
|----------|----------|
| **How are incidents detected?** | Tamper-evident audit logs. Alert webhooks for session failures and tmux crashes. Rate limiting anomalies. Dead session diagnostics. |
| **Automated alerting** | Yes. Alert webhooks for session failures and infrastructure issues. Configurable thresholds and cooldown periods. |
| **Breach detection** | Partial. Audit log tampering is detectable via SHA-256 chain. Unauthorized access is logged with key ID. No real-time anomaly detection or SIEM integration. |

### 9.2 Incident Response Process

| Question | Response |
|----------|----------|
| **Is there an incident response plan?** | Partial. Security vulnerability reporting documented in `SECURITY.md`. Incident rollback runbook published (`docs/incident-rollback-runbook.md`). No formal IR plan covering containment, eradication, recovery, and post-incident analysis. |
| **Breach notification timeline** | For the Aegis project: acknowledgment within 48 hours, security updates ASAP. For deployers: notification timeline is the deployer's responsibility per their DPA obligations (recommend 48–72 hours per GDPR Art. 33). |
| **Post-incident review** | Documented in GitHub issues and ADRs for architecture-level incidents. No formal post-mortem template. |
| **Communication plan** | Security advisories published on GitHub. No automated customer notification. |

---

## 10. Business Continuity

### 10.1 Backup and Recovery

| Question | Response |
|----------|----------|
| **Backup mechanism** | State file backup (`state.json` → `state.json.bak`) on every write. Atomic file writes (temp + rename pattern). No automated full backup. |
| **Recovery procedure** | State file restored from backup on corruption. Session reconciliation on restart (orphan reaping, tmux window adoption). |
| **Recovery time objective (RTO)** | Not formally defined. Single-node restart typically completes in seconds. |
| **Recovery point objective (RPO)** | State file: debounced saves (5 seconds). Audit logs: real-time (append-only). Metrics/metering: in-memory until next save cycle. |
| **Disaster recovery** | No DR runbook. No off-site backup. No automated failover. DR runbook planned for Phase 4. |

### 10.2 Availability

| Question | Response |
|----------|----------|
| **SLA** | Not defined. Self-hosted product; availability is the deployer's responsibility. |
| **Uptime target** | Not defined. Single-node architecture. |
| **Maintenance windows** | Not applicable (self-hosted). Deployer schedules their own maintenance. |
| **Graceful shutdown** | Yes. Configurable drain period (`AEGIS_SHUTDOWN_TIMEOUT_MS`, default 10 seconds). In-flight requests complete before shutdown. |

---

## 11. Third-Party and Supply Chain

### 11.1 Dependencies

| Question | Response |
|----------|----------|
| **Key third-party dependencies** | Fastify (HTTP), tmux (session management), Claude Code CLI (agent runtime), Zod (validation), OpenTelemetry (tracing), nodemailer (email), prom-client (metrics), @modelcontextprotocol/sdk (MCP). |
| **Are dependencies regularly audited?** | `npm audit` is available. Automated dependency scanning not yet in CI. |
| **Supply chain security** | Sigstore attestations for release artifacts. Package integrity verified via npm. |
| **Transitive dependency count** | Standard Node.js project dependency tree. Full list available in `package-lock.json`. |

### 11.2 Third-Party Data Sharing

| Question | Response |
|----------|----------|
| **Does the product send data to third parties?** | Only when the deployer configures notification channels. All channels are opt-in and deployer-controlled. |
| **Notification channels** | Telegram Bot API, Slack Webhooks, SMTP email, custom HTTP webhooks. All use HTTPS. Session event payloads (truncated to 2000 characters) are sent to configured endpoints. |
| **Analytics or telemetry** | None. Aegis does not collect or transmit analytics, telemetry, or usage data to the project or any third party. |
| **Subprocessors** | None. Aegis is self-hosted software. The deployer is the sole data processor. If the deployer uses a cloud provider, that provider is a subprocessor under the deployer's control. |

### 11.3 AI / LLM Providers

| Question | Response |
|----------|----------|
| **Does Aegis send data to AI providers?** | No. Aegis manages Claude Code sessions. Claude Code communicates with its configured LLM provider independently. Aegis does not intercept, proxy, or relay LLM API calls. |
| **Which LLM providers are supported?** | Any provider supported by Claude Code: Anthropic, OpenRouter, LM Studio, Ollama, Azure OpenAI, z.ai GLM, or any OpenAI-compatible endpoint. Configured via Claude Code's own settings, not Aegis. |
| **Who controls LLM data transmission?** | The deployer, through Claude Code's configuration. Aegis does not control, modify, or observe LLM API traffic. |

---

## 12. Compliance and Certifications

### 12.1 Current Certifications

| Question | Response |
|----------|----------|
| **SOC 2 Type I** | Not certified. Control mapping documented in [COMPLIANCE.md](./COMPLIANCE.md). Planned for Phase 4. |
| **SOC 2 Type II** | Not certified. Planned for Phase 4. |
| **ISO 27001** | Not certified. |
| **GDPR** | Aegis is a tool, not a data controller or processor. Deployer is responsible for GDPR compliance. Data mapping and Art. 30 template provided in [COMPLIANCE.md](./COMPLIANCE.md). |
| **HIPAA** | Not applicable. Aegis is not designed for PHI. Guidance for healthcare deployers in [COMPLIANCE.md](./COMPLIANCE.md) Section 3. |
| **CCPA / CPRA** | Not applicable. Aegis does not sell personal information. Deployer is responsible for CCPA compliance. |
| **PCI DSS** | Not applicable. Aegis does not process payment card data. |

### 12.2 Compliance Documentation

| Document | Location |
|----------|----------|
| Compliance overview (SOC 2, GDPR, HIPAA) | [COMPLIANCE.md](./COMPLIANCE.md) |
| Data Processing Agreement template | [DPA_TEMPLATE.md](./DPA_TEMPLATE.md) |
| Data retention and deletion policy | [RETENTION_POLICY.md](./RETENTION_POLICY.md) |
| Security policy | [SECURITY.md](../SECURITY.md) |
| Enterprise gap analysis | [docs/enterprise/00-gap-analysis.md](./enterprise/00-gap-analysis.md) |
| Architecture decisions (ADRs) | [docs/adr/](./adr/) |

---

## 13. Application Security

### 13.1 Input Handling

| Question | Response |
|----------|----------|
| **Input validation framework** | Zod schema validation on all API endpoints. Type-safe parsing with TypeScript. |
| **Path traversal protection** | Yes. Working directory paths validated against `allowedWorkDirs`. Path traversal attempts rejected. |
| **Command injection protection** | Yes. `execFile()` exclusively — no shell interpretation. CI bans `shell: true`. Arguments passed as arrays, not concatenated strings. |
| **SQL injection** | Not applicable. Aegis does not use SQL databases. State is stored in JSON files. |
| **Cross-site scripting (XSS)** | CSP headers on dashboard. `X-Content-Type-Options: nosniff`. Dashboard token in localStorage is a known risk (P0-8, planned fix). |
| **Cross-site request forgery (CSRF)** | Bearer token authentication provides CSRF protection (tokens are not automatically sent by browsers). |
| **Server-side request forgery (SSRF)** | Protected. URL scheme validation (http/https only). Private IP range blocklist. |
| **Environment variable injection** | Names validated with regex (`/^[A-Z_][A-Z0-9_]*$/`). Dangerous prefixes blocked. Explicit denylist checked. CR/LF and control characters rejected. Value size capped. Known gaps for `PATH`, `LD_PRELOAD`, etc. (P0-2). |

### 13.2 Session Security

| Question | Response |
|----------|----------|
| **Session hijacking prevention** | Per-session hook secrets (32 bytes, cryptographically random). Timing-safe validation. Session ownership enforced by key ID. |
| **Session fixation prevention** | Session IDs generated server-side with `crypto.randomUUID()`. Not client-supplied. |
| **Concurrent session limits** | Per-key concurrent session quotas configurable. |
| **Session timeout** | Configurable stall detection thresholds. Permission prompt auto-reject timeout. No absolute session timeout. |

### 13.3 API Security

| Question | Response |
|----------|----------|
| **API authentication** | Bearer token on all endpoints. Optional master token for full access. |
| **API versioning** | All endpoints prefixed with `/v1/`. API versioning policy planned. |
| **Rate limiting** | Yes. Per-key and global limits. Separate limits for session-heavy endpoints. |
| **Request size limits** | Configurable max body size via Fastify. |
| **Response headers** | Security headers on all responses. CORS with explicit origin. |

---

## 14. Personnel Security

| Question | Response |
|----------|----------|
| **Background checks** | Not applicable. Aegis is an open-source project. Contributors are community members. |
| **Security training** | Not formally provided. Security-relevant guidelines documented in CLAUDE.md, SECURITY.md, and enterprise documentation. |
| **Access revocation** | Repository access managed via GitHub roles. Maintainer (Argus) is the sole merge authority. |
| **Code review** | All changes require PR review. Security-sensitive changes flagged. |
| **Contributor license agreement** | MIT license. No CLA required. |

---

## 15. Physical Security

| Question | Response |
|----------|----------|
| **Physical access controls** | Not applicable. Aegis is software. Physical security of the host is the deployer's responsibility. |
| **Media disposal** | Deployer's responsibility. Recommend NIST 800-88 compliant media sanitization for decommissioned hosts. |
| **Device encryption** | Deployer's responsibility. Recommend full-disk encryption on hosts running Aegis. |

---

## Appendix A: Security Controls Summary

| Category | Control | Implemented | Gap |
|----------|---------|-------------|-----|
| Authentication | Bearer token + API keys | Yes | No MFA, no SSO |
| Authorization | RBAC (3 roles) | Yes | Coarse granularity |
| Encryption at rest | AES-256-GCM (hook secrets), SHA-256 (keys) | Partial | Most data unencrypted |
| Encryption in transit | HTTPS (notification channels) | Partial | No built-in TLS |
| Input validation | Zod schemas, path traversal prevention | Yes | — |
| Command injection | execFile only, no shell | Yes | — |
| SSRF protection | URL scheme + IP blocklist | Yes | — |
| Audit logging | SHA-256 chained daily files | Yes | No export API |
| Rate limiting | Per-key and global | Yes | — |
| Security headers | CSP, X-Frame-Options, etc. | Yes | — |
| Vulnerability reporting | GitHub Security Advisory | Yes | No bug bounty |
| Supply chain | Sigstore attestations | Yes | No automated scanning |
| Session ownership | Key ID enforcement | Partial | Not all action routes |
| Hook secret protection | AES-256-GCM, per-session | Yes | — |

---

## Appendix B: Data Flow Summary

```
                         Aegis Runtime Data Flows

  Developer ──HTTP──> [ Fastify API ] ──> SessionManager ──> state.json
                          │                                     │
                          ├──> AuthManager ──> keys.json         │
                          │    (SHA-256 hash)                    │
                          │                                     │
                          ├──> AuditLogger ──> audit/*.jsonl     │
                          │    (SHA-256 chain)                    │
                          │                                     │
                          ├──> Monitor ──> Channels ──> Telegram
                          │              (HTTPS)      ├──> Slack
                          │                           ├──> Email
                          │                           └──> Webhooks
                          │
                          └──> Metrics ──> metrics.json
                                         metering.json

  Claude Code CLI <──tmux──> Session Manager (in-process)
       │
       └──> LLM Provider (Anthropic / OpenRouter / etc.)
            (Aegis does NOT intercept this path)
```

---

## Appendix C: Version History and Review Cadence

| Date | Version | Reviewer | Changes |
|------|---------|----------|---------|
| 2026-04-23 | 1.0.0 | [Initial author] | Initial pre-filled security questionnaire. |

**Review cadence:** This questionnaire should be reviewed and updated:
- With each Aegis minor version release.
- After any security incident.
- After any material change to the architecture or data handling.
- At minimum, every 6 months.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-23 | 1.0.0 | Initial security questionnaire for Aegis. |
