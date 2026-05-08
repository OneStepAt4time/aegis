# Data Processing Agreement (DPA) Template

> **Version:** 2.0.0 (enhanced)
> **Last reviewed:** 2026-05-08
> **Status:** Template — customize for your organization

This Data Processing Agreement template is provided for enterprise customers who need to establish a DPA with their Aegis deployer. Since Aegis is self-hosted open-source software (MIT license), the relationship between the customer (data controller) and any managed service provider running Aegis on their behalf (data processor) should be formalized using this template.

> **Note:** The original DPA template is at [`docs/DPA_TEMPLATE.md`](../DPA_TEMPLATE.md). This version is the Phase 4 enhanced edition.

---

## Instructions

1. Replace all `[bracketed]` placeholders with your information.
2. Review Annex 1 (Data Map) against your actual Aegis deployment configuration.
3. Have legal counsel review before execution.
4. This template assumes the **processor** operates an Aegis instance on behalf of the **controller**.

---

## DATA PROCESSING AGREEMENT

This Data Processing Agreement ("DPA") is entered into as of `[date]` ("Effective Date") by and between:

**Data Controller:** `[Controller Name]`, a `[jurisdiction]` entity with its principal place of business at `[address]` ("Controller")

**Data Processor:** `[Processor Name]`, a `[jurisdiction]` entity with its principal place of business at `[address]` ("Processor")

### 1. Scope and Purpose

1.1. This DPA applies to the processing of personal data by Processor on behalf of Controller in connection with Processor's operation of the Aegis platform ("Service") for Controller's use.

1.2. The subject matter, duration, nature, and purpose of the processing, types of personal data, and categories of data subjects are described in **Annex 1** (Data Processing Details).

### 2. Obligations of the Processor

2.1. Processor shall process personal data only on documented instructions from Controller, including with regard to transfers of personal data to a third country or international organization, unless required to do so by applicable law; in such a case, Processor shall inform Controller of that legal requirement before processing, unless that law prohibits such information on important grounds of public interest.

2.2. Processor shall ensure that persons authorised to process the personal data have committed themselves to confidentiality or are under an appropriate statutory obligation of confidentiality.

2.3. Processor shall take all measures required pursuant to **Annex 2** (Security Measures).

2.4. Processor shall not engage another processor (sub-processor) without prior specific or general written authorisation of Controller. In the case of general written authorisation, Processor shall inform Controller of any intended changes concerning the addition or replacement of sub-processors, giving Controller the opportunity to object to such changes.

### 3. Security Measures

Processor shall implement the technical and organisational measures specified in **Annex 2** to ensure a level of security appropriate to the risk, including:

- Encryption of personal data in transit and at rest
- Access controls and authentication
- Audit logging and monitoring
- Incident detection and response
- Regular security testing

### 4. Sub-Processing

4.1. Controller grants Processor general authorisation to engage sub-processors, subject to the conditions in this DPA.

4.2. Processor shall maintain an up-to-date list of sub-processors and notify Controller of any changes, giving Controller the opportunity to object.

4.3. Processor shall impose the same data protection obligations as set out in this DPA on any sub-processor by way of a contract.

### 5. Data Subject Rights

5.1. Processor shall assist Controller in responding to data subject requests for exercising their rights under applicable data protection laws.

5.2. Processor shall promptly notify Controller upon receiving a request from a data subject regarding processing of their personal data and shall not respond to such request without Controller's instructions.

### 6. Incident Notification

6.1. Processor shall notify Controller without undue delay after becoming aware of a personal data breach.

6.2. The notification shall include:
- The nature of the breach including, where possible, the categories and approximate number of data subjects and records concerned
- The name and contact details of the data protection officer or other contact point
- A description of the likely consequences of the breach
- A description of measures taken or proposed to address the breach

### 7. Audit Rights

7.1. Processor shall make available to Controller all information necessary to demonstrate compliance with this DPA.

7.2. Processor shall allow for and contribute to audits, including inspections, conducted by Controller or an auditor mandated by Controller.

### 8. Data Deletion

8.1. Upon termination of the Service, Processor shall, at the choice of Controller, return or delete all personal data processed under this DPA, unless applicable law requires storage.

8.2. Processor shall certify deletion of personal data upon Controller's request.

### 9. Governing Law

This DPA shall be governed by the laws of `[jurisdiction]`.

---

## Annex 1: Data Processing Details

| Field | Description |
|-------|-------------|
| **Subject matter** | Operation of the Aegis orchestration platform for Controller's AI session management |
| **Duration** | Term of the Service Agreement, unless terminated earlier |
| **Nature of processing** | Session orchestration, audit logging, API authentication, monitoring |
| **Purpose of processing** | AI session lifecycle management, usage metering, security auditing |
| **Data categories** | See Section 2 of [Data Retention Policy](./data-retention-policy.md) |
| **Data subjects** | Controller's employees, contractors, and authorised users of the Aegis platform |
| **Retention periods** | As specified in [Data Retention Policy](./data-retention-policy.md) |

## Annex 2: Security Measures

| Measure | Implementation |
|---------|---------------|
| **Encryption at rest** | AES-256-GCM for secrets, SHA-256 hashing for API keys |
| **Encryption in transit** | HTTPS for all channel integrations; reverse proxy TLS recommended |
| **Access control** | API key authentication, role-based permissions (admin/operator/viewer), session ownership enforcement |
| **Audit logging** | SHA-256 chained daily audit files, structured JSON, token redaction |
| **Incident monitoring** | Stall detection, dead session diagnostics, alert webhooks, OpenTelemetry tracing |
| **Vulnerability management** | Input validation (Zod), command injection prevention, SSRF protection, Sigstore release attestations |
| **Change management** | Branch protection, mandatory PR review, quality gate, Release Please automation |
| **Network security** | Localhost-only binding by default, SSRF blocklist, security headers, CORS enforcement |
