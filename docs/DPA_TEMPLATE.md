# Data Processing Agreement — Template

> **Applicable to:** Enterprise customers deploying Aegis (`@onestepat4time/aegis`) in
> environments where personal data is processed.
>
> **Last updated:** 2026-04-23 | **Template version:** 1.0.0
>
> **Notice:** This is a template. Consult legal counsel before use. Bracketed fields (`[...]`)
> must be completed by the parties. This template is designed for the self-hosted deployment
> model where the Customer is the data controller and may engage the Aegis vendor (if
> applicable) or subprocessors for support, hosting, or managed services.

---

## DATA PROCESSING AGREEMENT

This Data Processing Agreement ("**DPA**") is entered into as of the Effective Date set out
below and forms part of the Master Services Agreement ("**MSA**") between:

- **Data Controller:** [Customer Legal Entity Name], a [jurisdiction] entity with its principal
  place of business at [address] ("**Customer**", "**Controller**", "**you**").
- **Data Processor:** [Processor Legal Entity Name], a [jurisdiction] entity with its principal
  place of business at [address] ("**Processor**", "**we**", "**us**").

### Effective Date: [date]

### References

- Regulation (EU) 2016/679 ("**GDPR**")
- UK Data Protection Act 2018 and UK GDPR ("**UK GDPR**")
- Swiss Federal Act on Data Protection ("**FADP**")
- California Consumer Privacy Act, as amended by CPRA ("**CCPA**"), where applicable

---

## 1. Definitions

| Term | Definition |
|------|-----------|
| **Aegis** | The `@onestepat4time/aegis` open-source software, a self-hosted control plane for Claude Code sessions, licensed under the MIT License. |
| **Controller Personal Data** | Personal data processed by Processor on behalf of Controller in connection with the Services. |
| **Data Subject** | An identified or identifiable natural person whose Personal Data is processed. |
| **Personal Data** | Any information relating to a Data Subject as defined in GDPR Article 4(1). |
| **Processing** | Any operation performed on Personal Data, whether or not by automated means. |
| **Services** | The Aegis-related services provided by Processor to Controller as described in the MSA, which may include managed hosting, support, configuration, or consulting for Aegis deployments. |
| **Subprocessor** | Any third party engaged by Processor to process Controller Personal Data. |
| **Technical and Organizational Measures** | Security measures described in Annex II. |

## 2. Scope and Roles

### 2.1 Roles

The parties acknowledge and agree that:

1. **Customer is the Data Controller.** Customer determines the purposes and means of processing
   Personal Data through their Aegis deployment.
2. **Processor is the Data Processor.** Processor processes Controller Personal Data only on
   documented instructions from Customer, for the purposes described in this DPA.
3. Where Processor acts as a hosting or managed services provider for Customer's Aegis
   deployment, Processor processes Controller Personal Data solely to provide the Services.

### 2.2 Data Processing Scope

Processor processes Controller Personal Data only to the extent necessary to provide the
Services and in accordance with Customer's documented instructions. Processing includes:

| Activity | Data Categories | Purpose |
|----------|----------------|---------|
| Hosting and operating Aegis server | Session metadata, authentication credentials, audit records | Service delivery |
| Monitoring and alerting | Session status events, usage metrics | Service reliability |
| Technical support | Configuration data, session state, log files | Troubleshooting |
| Backup and disaster recovery | All Aegis state data | Data protection |
| Security incident response | Audit logs, access records | Security |

### 2.3 Prohibited Processing

Processor shall not:

1. Process Controller Personal Data for any purpose other than as specified in this DPA.
2. Sell, rent, or share Controller Personal Data with third parties for their own purposes.
3. Use Controller Personal Data for Processor's own product development, analytics, or marketing.
4. Process Controller Personal Data outside the geographic scope specified in Section 8.

## 3. Controller Instructions

### 3.1 Documented Instructions

Customer instructs Processor to process Controller Personal Data:

1. In accordance with this DPA, the MSA, and applicable law.
2. To provide, maintain, and support the Services.
3. To detect, prevent, and respond to security incidents.
4. To comply with applicable legal obligations (with notice to Customer where permitted).

### 3.2 Additional Instructions

Customer may issue additional reasonable written instructions, provided they do not:

- Conflict with applicable law or the MSA.
- Require Processor to process data in a manner inconsistent with the Aegis architecture.
- Impose costs not anticipated under the MSA without appropriate adjustment.

Processor shall notify Customer if, in Processor's opinion, an instruction infringes applicable
data protection law.

## 4. Data Categories

### 4.1 Categories of Data Subjects

| Category | Description |
|----------|-------------|
| **Developers** | Individual software developers using Claude Code through Aegis. |
| **Team leads** | Managers with operator or admin roles on the Aegis deployment. |
| **Administrators** | Personnel managing Aegis configuration, API keys, and security. |

### 4.2 Categories of Personal Data

| Category | Data Elements | Source |
|----------|--------------|--------|
| **Identity data** | API key names, Telegram user IDs, Slack user references | Controller configuration |
| **Authentication data** | API key hashes (SHA-256), master token hashes | Aegis AuthManager |
| **Session metadata** | Session IDs, working directories, timestamps, model identifiers | Aegis runtime |
| **Session content** | Claude Code prompts, responses, tool calls, file paths | Claude Code via Aegis |
| **Usage data** | Token counts, estimated costs, session durations | Aegis metrics |
| **Audit data** | Key IDs, API methods, request paths, timestamps, event details | Aegis audit logger |
| **Notification data** | Event payloads sent to configured channels (truncated to 2000 chars) | Aegis monitor |

### 4.3 Sensitive Data

Processor has no knowledge of, and is not responsible for, the specific content of Claude Code
session transcripts. If Customer's sessions may contain special category data (GDPR Art. 9) or
Protected Health Information (HIPAA), Customer must:

1. Notify Processor in writing before processing begins.
2. Implement additional technical measures (encryption, access restrictions) as documented in
   [COMPLIANCE.md](./COMPLIANCE.md) Section 3.
3. Ensure a valid legal basis exists for such processing.

## 5. Technical and Organizational Measures

### 5.1 Minimum Security Standards

Processor shall implement and maintain the technical and organizational measures described in
**Annex II** to protect Controller Personal Data.

### 5.2 Aegis-Specific Security Controls

The following controls are built into Aegis and apply to all deployments:

| Control | Implementation |
|---------|---------------|
| **Authentication** | Bearer token + API key authentication. SHA-256 key hashing. Timing-safe comparison. |
| **Authorization** | Role-based access (admin / operator / viewer). Per-key permissions. Session ownership enforcement. |
| **Encryption at rest** | Hook secrets: AES-256-GCM. API keys: SHA-256 hashed (never plaintext). Sensitive files: mode `0o600`. |
| **Encryption in transit** | HTTPS for all notification channels (Telegram, Slack, webhooks). TLS termination via reverse proxy. |
| **Input validation** | Zod schema validation on all API inputs. Path traversal prevention. Command injection prevention (`execFile` only). |
| **Audit logging** | SHA-256 chained daily audit files. Tamper-evident. Auth token redaction. |
| **Rate limiting** | Per-key and per-IP rate limits. Auth failure lockout. |
| **SSRF protection** | URL scheme validation. Private IP range blocklist (RFC 1918, loopback, link-local, IPv6 ULA, CGNAT). |
| **Secure defaults** | Localhost-only binding (`127.0.0.1`). Session ownership enabled. CORS wildcard rejected. |

### 5.3 Right to Audit

Customer may audit Processor's compliance with this DPA:

1. **Self-assessment:** Processor shall complete reasonable security questionnaires upon request,
   no more than once per calendar year.
2. **On-site audit:** With 30 days' written notice, during business hours, subject to
   confidentiality obligations. Customer bears audit costs unless a breach is confirmed.
3. **SOC 2 reports:** Processor shall provide the most recent SOC 2 Type II report (when
   available) upon request, subject to NDA.

## 6. Subprocessors

### 6.1 Authorized Subprocessors

As of the Effective Date, Processor engages the following subprocessors:

| Subprocessor | Purpose | Location | Data Access |
|-------------|---------|----------|-------------|
| [Cloud Infrastructure Provider] | Server hosting | [Region] | Full (infrastructure) |
| [Monitoring / Observability Provider] | System monitoring | [Region] | Metrics only |
| [Email Service Provider] | Notification delivery | [Region] | Event payloads |
| [Backup Storage Provider] | Data backup | [Region] | Full (backup) |

*Note: The Aegis open-source project does not engage subprocessors by default. This table
applies only when Processor provides managed/hosted services.*

### 6.2 Notification of Changes

Processor shall notify Customer at least **30 days** before engaging a new subprocessor or
changing an existing subprocessor's processing activities. Customer may object to the change
by providing written notice within 15 days. If the parties cannot resolve the objection,
either party may terminate the affected Services without penalty.

### 6.3 Subprocessor Obligations

Processor shall impose data protection obligations on each subprocessor that are at least as
protective as those in this DPA, via written agreement.

## 7. Data Subject Rights

### 7.1 Cooperation

Processor shall assist Customer in responding to data subject requests (access, rectification,
erasure, restriction, portability, objection) by:

1. Notifying Customer within **5 business days** of receiving a request directly from a data
   subject (and directing the data subject to Customer).
2. Providing technical capabilities (export APIs, deletion tools) as they become available in
   Aegis.
3. Not deleting or modifying data in response to a data subject request without Customer's
   written authorization.

### 7.2 Data Access and Erasure Support

Processor maintains the following capabilities to support data subject rights:

| Right | Aegis Mechanism | Status |
|-------|----------------|--------|
| Access (Art. 15) | Audit log query, session state export | Requires manual extraction from state files |
| Erasure (Art. 17) | Key revocation, session kill, state file deletion | Manual process; automated tooling planned |
| Portability (Art. 20) | JSON state export | Requires manual extraction |

## 8. International Data Transfers

### 8.1 Transfer Mechanism

Controller Personal Data shall be processed within [geographic region, e.g., the European
Economic Area / United States / as specified in the MSA].

If a transfer to a third country is necessary:

1. **EU Standard Contractual Clauses** (Commission Decision 2021/914) shall apply, using
   Module Two (Controller to Processor) or Module Three (Processor to Processor) as
   appropriate.
2. **UK International Data Transfer Agreement** or UK Addendum to the EU SCCs shall apply for
   UK transfers.
3. **Swiss-Chinese requirements** — FADP provisions shall be observed for transfers from
   Switzerland.

### 8.2 Transfer Impact Assessments

Upon Customer's request, Processor shall provide a Transfer Impact Assessment for each
third-country transfer, evaluating:

1. The legal framework of the destination country.
2. The technical measures protecting the data in transit and at rest.
3. The access that destination-country authorities may have.

## 9. Data Breach Notification

### 9.1 Breach Detection

Processor shall implement reasonable measures to detect Personal Data breaches, including:

- Tamper-evident audit logging (SHA-256 chained daily files).
- Monitoring for unauthorized access patterns.
- Alert webhooks for session anomalies.

### 9.2 Notification Obligations

In the event of a Personal Data breach:

| Obligation | Timeline |
|-----------|----------|
| Notify Customer | Without undue delay, no later than **48 hours** after becoming aware |
| Provide preliminary details | Within the initial notification (nature, categories, approximate number of subjects) |
| Provide complete investigation report | Within **30 days** |
| Cooperate with investigations | Ongoing |

### 9.3 Notification Content

Processor's breach notification shall include:

1. The nature of the breach, including categories and approximate number of data subjects and
   records affected.
2. The likely consequences of the breach.
3. The measures taken or proposed to address the breach and mitigate its effects.
4. Contact information for Processor's data protection point of contact.

## 10. Data Retention and Deletion

### 10.1 Retention Periods

Processor shall retain Controller Personal Data only for as long as necessary to provide the
Services, subject to the following minimum retention:

| Data Type | Retention Period | Basis |
|-----------|-----------------|-------|
| Audit logs | [Duration, minimum 1 year] | Security and compliance |
| API key hashes | Duration of key lifecycle + [grace period] | Authentication |
| Session metadata | Duration of session + [retention window] | Service delivery |
| Usage metrics | [Duration, e.g., 90 days] | Billing and monitoring |
| Backups | [Duration, e.g., 30 days] | Disaster recovery |

See [RETENTION_POLICY.md](./RETENTION_POLICY.md) for full details.

### 10.2 Deletion on Termination

Upon termination of the MSA:

1. Processor shall return or delete all Controller Personal Data within **90 days**, at
   Customer's election.
2. If Customer elects deletion, Processor shall provide written confirmation of destruction.
3. Processor may retain one archival copy for legal compliance purposes, subject to
   confidentiality obligations, for no longer than required by applicable law.

## 11. Liability and Indemnification

1. Each party's liability under this DPA is subject to the limitations in the MSA.
2. Processor shall indemnify Customer against claims arising from Processor's violation of
   applicable data protection law, to the extent caused by Processor's acts or omissions.
3. Customer shall indemnify Processor against claims arising from Customer's instructions that
   are unlawful or that Processor warned Customer about in accordance with Section 3.2.

## 12. Term and Termination

1. This DPA takes effect on the Effective Date and continues for the term of the MSA.
2. Either party may terminate this DPA by terminating the MSA in accordance with its terms.
3. Termination of this DPA does not relieve either party of obligations accrued before
   termination, including data deletion obligations under Section 10.2.

## 13. Governing Law and Jurisdiction

1. This DPA is governed by the law specified in the MSA.
2. Nothing in this DPA limits either party's rights under applicable data protection law.
3. For GDPR matters, the supervisory authority of [Member State] shall have competence.

---

## Annex I: Data Processing Description

| Field | Value |
|-------|-------|
| **Subject matter** | Managed hosting and support of Aegis self-hosted deployment |
| **Duration** | Term of the MSA |
| **Nature of processing** | Hosting, monitoring, technical support, backup, security incident response |
| **Purpose of processing** | Provision of the Services as described in the MSA |
| **Data categories** | Identity, authentication, session metadata, session content, usage, audit, notification |
| **Data subjects** | Developers, team leads, administrators |
| **Obligations and rights of Controller** | As set out in this DPA and applicable law |

---

## Annex II: Technical and Organizational Measures

### Physical Security

| Measure | Description |
|---------|-------------|
| Data center security | [Cloud provider] SOC 2 Type II certified facilities. Biometric access. 24/7 monitoring. |
| Media disposal | NIST 800-88 compliant media sanitization. |

### Technical Security

| Measure | Description |
|---------|-------------|
| Encryption at rest | AES-256 for cloud storage. AES-256-GCM for Aegis hook secrets. SHA-256 for API keys. |
| Encryption in transit | TLS 1.2+ for all external connections. mTLS for internal service communication. |
| Access control | RBAC (admin / operator / viewer). Per-key permissions. Principle of least privilege. |
| Authentication | Bearer token + API key. SHA-256 hashed storage. Timing-safe comparison. Rate limiting. |
| Network security | Localhost-only default. SSRF blocklist. Security headers. CORS origin enforcement. |
| Input validation | Zod schema validation. Path traversal prevention. Command injection prevention. |
| Audit logging | SHA-256 chained daily audit files. Tamper-evident. Token redaction. |
| Monitoring | Stall detection. Dead session diagnostics. Alert webhooks. OpenTelemetry tracing. |
| Vulnerability management | Sigstore release attestations. Dependency audit. `npm audit`. |
| Business continuity | State file backup. Graceful shutdown with drain period. Session recovery. |

### Organizational Security

| Measure | Description |
|---------|-------------|
| Security training | Annual security awareness training for all personnel with data access. |
| Access reviews | Quarterly access reviews. Immediate revocation on role change or termination. |
| Incident response | Documented incident response plan. 48-hour breach notification. |
| Data minimization | Only data necessary for service delivery is processed. No analytics or telemetry. |
| Separation of duties | Admin, operator, and viewer roles enforce separation of duties. |
| Change management | Documented change management process. Review and approval required for production changes. |

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-23 | 1.0.0 | Initial DPA template for Aegis enterprise deployments. |
