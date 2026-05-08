# Data Retention Policy

> **Version:** 2.0.0 (enhanced)
> **Last reviewed:** 2026-05-08
> **Status:** Pre-compliance — Phase 4 (Enterprise GA) not yet active

This document defines data retention schedules and deletion mechanisms for the Aegis platform. Deployers should adapt these schedules to their regulatory requirements.

> **Note:** The original retention policy is at [`docs/RETENTION_POLICY.md`](../RETENTION_POLICY.md). This version is the Phase 4 enhanced edition with DSAR handling procedures.

---

## 1. Data Categories and Retention Schedules

| Category | Data Elements | Default Retention | Deletion Mechanism | Regulatory Basis |
|----------|--------------|-------------------|-------------------|------------------|
| **API Keys** | SHA-256 hashes, key names, roles, permissions | Until manually revoked | Admin API: `DELETE /v1/auth/keys/:id` | Legitimate interest |
| **Audit Logs** | Key ID, HTTP method, path, timestamp, detail | 365 days (configurable) | Automatic rotation: daily files, purge after retention | SOC 2, GDPR Art. 5(1)(e) |
| **Session Metadata** | Session ID, status, timestamps, model, owner key | Until session deleted | Admin API: `DELETE /v1/sessions/:id` | Legitimate interest |
| **Session Transcripts** | Full message history per session | Until session deleted | Deleted with session | Legitimate interest |
| **Metrics / Metering** | Usage records, cost data, latency measurements | 90 days | Automatic purge | Operational |
| **State Files** | `state.json`, session state | Until overwritten | Backup: `state.json.bak` | Operational |
| **Memory Bridge** | Key-value store entries | Until manually deleted | API: `DELETE /v1/memory/:key` | User-controlled |
| **Pipeline Records** | Pipeline definitions and batch results | 30 days after completion | Automatic purge | Operational |

## 2. Deletion Mechanisms

### 2.1 API-Driven Deletion

```
# Revoke an API key (deletes hash from key store)
DELETE /v1/auth/keys/{keyId}

# Delete a session and its transcript
DELETE /v1/sessions/{sessionId}

# Delete a memory bridge entry
DELETE /v1/memory/{key}
```

### 2.2 Automatic Rotation

- **Audit logs:** Daily JSONL files rotated automatically. Files older than the configured retention period are purged on server startup.
- **Metrics:** In-memory Prometheus metrics reset on restart. Persistent metering data purged after 90 days.

### 2.3 Filesystem Deletion

Sensitive files are deleted using secure deletion patterns when available:
- Key store entries: hash removed from `keys.json`, file rewritten atomically
- State backups: `state.json.bak` overwritten on next state change

## 3. Data Subject Access Requests (DSAR)

### 3.1 DSAR Process

Since Aegis is self-hosted software, the deployer (data controller) is responsible for handling DSARs. Aegis provides the following mechanisms to support DSAR fulfillment:

| DSAR Type | Aegis Support | Endpoint / Action |
|-----------|---------------|-------------------|
| **Access** (GDPR Art. 15) | Export all data for a given key ID | `GET /v1/sessions` filtered by owner + `GET /v1/auth/keys/:id` + audit log grep |
| **Rectification** (GDPR Art. 16) | Update key metadata | `PUT /v1/auth/keys/:id` — update name/roles |
| **Erasure** (GDPR Art. 17) | Delete all sessions + revoke key | `DELETE /v1/sessions/:id` for each session + `DELETE /v1/auth/keys/:id` |
| **Portability** (GDPR Art. 20) | Export session transcripts | `GET /v1/sessions/:id/transcript` — JSON format |

### 3.2 DSAR Workflow for Deployers

1. **Identify the data subject** — map the request to an Aegis API key ID or session owner.
2. **Collect data** — query sessions, transcripts, audit logs, and memory bridge entries for the subject.
3. **Fulfill request** — export (access/portability), modify (rectification), or delete (erasure) as appropriate.
4. **Document fulfillment** — record the DSAR, actions taken, and completion date in your compliance records.
5. **Respond within 30 days** — GDPR requirement. For complex requests, extend to 90 days with notification.

### 3.3 DSAR Limitations

- Audit logs are tamper-evident (SHA-256 chained). Erasing individual entries breaks chain integrity.
- For erasure requests involving audit logs, the recommended approach is to redact personal identifiers while preserving the chain structure.
- Session transcripts may contain third-party data (AI model outputs). Deployers should assess whether erasure impacts other data subjects.

## 4. Compliance Cross-Reference

| Requirement | Coverage |
|-------------|----------|
| SOC 2 CC6.1 (Access controls) | API key revocation, session deletion |
| SOC 2 CC7.2 (Monitoring) | Audit log retention, integrity verification |
| GDPR Art. 5(1)(e) (Storage limitation) | Configurable retention periods, automatic purge |
| GDPR Art. 17 (Right to erasure) | Session deletion, key revocation, audit log redaction |
| GDPR Art. 20 (Data portability) | Transcript export API |

---

## Configuration

Set retention periods in `aegis.config.ts`:

```typescript
export default defineConfig({
  audit: {
    retentionDays: 365,   // Audit log retention (default: 365)
    maxFileSize: '50mb',  // Max single audit file size
  },
  metering: {
    retentionDays: 90,    // Metering data retention (default: 90)
  },
});
```
