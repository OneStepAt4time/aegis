# Aegis Data Retention and Deletion Policy

> **Applicable to:** All Aegis (`@onestepat4time/aegis`) deployments processing personal data.
>
> **Last updated:** 2026-04-23 | **Policy version:** 1.0.0
>
> **Notice:** This policy describes the Aegis runtime's data retention behavior and provides
> recommended retention schedules. The deployer (data controller) is responsible for
> configuring and enforcing retention in accordance with their legal obligations. This policy
> does not constitute legal advice.

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Data Inventory](#2-data-inventory)
3. [Retention Schedules](#3-retention-schedules)
4. [Deletion Mechanisms](#4-deletion-mechanisms)
5. [Legal Hold Override](#5-legal-hold-override)
6. [Audit and Compliance](#6-audit-and-compliance)
7. [Implementation Guide](#7-implementation-guide)

---

## 1. Purpose and Scope

### 1.1 Purpose

This policy establishes:

- What data Aegis stores, where, and for how long.
- Recommended retention periods aligned with GDPR, SOC 2, and common enterprise requirements.
- Deletion and anonymization mechanisms available in Aegis.
- Procedures for data subject erasure requests.

### 1.2 Scope

This policy covers all data persisted by the Aegis runtime, including:

- State files managed by `SessionManager` and `AuthManager`.
- Audit logs managed by `AuditLogger`.
- Metrics and metering data.
- Configuration files.
- Claude Code JSONL transcript files (managed by Claude Code, referenced by Aegis).

This policy does **not** cover:

- Data within Claude Code sessions that Claude Code manages independently (e.g., conversation
  history stored by Claude Code's own persistence layer).
- Data in third-party services (Telegram, Slack, email providers, webhook endpoints) — those
  are governed by the respective service's retention policies.
- Operating system logs, container logs, or reverse proxy logs.

### 1.3 Roles

| Role | Responsibility |
|------|---------------|
| **Deployer / Data Controller** | Configures retention, enforces deletion schedules, responds to DSARs. |
| **Aegis Administrator** | Operates the Aegis instance, configures state directory, runs maintenance. |
| **Data Subject** | Developer or team member whose data is processed. |

---

## 2. Data Inventory

### 2.1 Persistent Data Stores

All data is stored in the **state directory** (`stateDir`), configured via the `AEGIS_STATE_DIR`
environment variable or the `stateDir` config field. Default: `~/.aegis/`.

| Data Store | File(s) | Format | Size Guidance | Sensitivity |
|-----------|---------|--------|---------------|-------------|
| **API key store** | `keys.json` | JSON | ~1 KB per key | **High** — Contains SHA-256 key hashes, names, roles, quotas, grace keys |
| **Audit trail** | `audit/YYYY-MM-DD.jsonl` | JSON Lines | ~1–10 MB/day (depends on usage) | **High** — Records all authenticated actions with key IDs |
| **Session state** | `state.json`, `state.json.bak` | JSON | ~100 KB–10 MB (depends on sessions) | **Medium** — Session metadata, offsets, statuses |
| **Session map** | `session_map.json` | JSON | ~10 KB | **Medium** — Maps session IDs to tmux windows |
| **Metrics** | `metrics.json` | JSON | ~1–50 MB (grows with usage) | **Medium** — Per-session token counts, costs, durations |
| **Metering** | `metering.json` | JSON | ~1–50 MB (grows with usage) | **Medium** — Per-session and per-key usage with costs |
| **Memory bridge** | `memory.json` | JSON | Varies | **Medium** — Session key/value memory data |
| **Pipeline state** | Pipeline-specific files | JSON | Varies | **Medium** — Batch/multi-stage execution state |
| **Process PID** | `aegis.pid` | Text | ~10 bytes | **Low** — Single PID number |
| **Config file** | `aegis.config.json` or equivalent | JSON / YAML | ~1–5 KB | **High** — Contains auth tokens, webhook URLs, bot tokens |

### 2.2 Referenced Data (Managed by Claude Code)

| Data | Location | Format | Sensitivity |
|------|----------|--------|-------------|
| **Session transcripts** | Claude Code project directories (`.claude/` within workDir) | JSONL | **High** — Full conversation content, tool calls, code |
| **Claude Code sessions** | `~/.claude/` (Claude Code's own state) | Various | **High** — Claude Code's persistent session data |

### 2.3 Ephemeral Data (Not Persisted)

| Data | Storage | Lifetime | Sensitivity |
|------|---------|----------|-------------|
| **Quota usage** | In-memory `Map` | 1-hour rolling window, pruned every 5 min | **Low** — Aggregated counts |
| **Rate limit buckets** | In-memory `Map` | 1-minute window, pruned every 1–5 min | **Low** — Request counts |
| **SSE tokens** | In-memory `Map` | 60 seconds, single-use | **Low** — Ephemeral tokens |
| **Monitor state** | In-memory Sets and Maps | Process lifetime | **Medium** — Status tracking |
| **Auth failure tracking** | In-memory Map | Per-minute window | **Low** — Failure counts per IP |
| **Terminal captures** | In-process buffer | Single monitoring cycle | **High** — Raw terminal content |

---

## 3. Retention Schedules

### 3.1 Recommended Retention Periods

Retention periods are based on operational need, legal requirements, and the principle of
data minimization (GDPR Art. 5(1)(c)). Deployers should adjust these based on their specific
legal obligations.

| Data Category | Recommended Retention | Rationale | Legal Basis |
|---------------|----------------------|-----------|-------------|
| **Audit logs** | 12 months (active), then archive for 24 months | Security incident investigation, SOC 2 evidence, GDPR Art. 5(2) accountability | GDPR Art. 6(1)(f) legitimate interest |
| **API key store** | Duration of key lifecycle + 30 days post-revocation | Authentication, grace period during rotation | GDPR Art. 6(1)(f) legitimate interest |
| **Session state** | Duration of active session + 7 days post-termination | Session recovery, operational continuity | GDPR Art. 6(1)(f) legitimate interest |
| **Session metadata** (within state) | Duration of session + 30 days | Audit trail correlation, usage analysis | GDPR Art. 6(1)(f) legitimate interest |
| **Metrics data** | 90 days rolling window | Operational monitoring, cost tracking | GDPR Art. 6(1)(f) legitimate interest |
| **Metering data** | 90 days rolling window | Billing accuracy, usage tracking | GDPR Art. 6(1)(f) legitimate interest |
| **Memory bridge data** | Duration of session + 7 days | Session context persistence | GDPR Art. 6(1)(f) legitimate interest |
| **Pipeline state** | Duration of pipeline + 7 days post-completion | Operational continuity | GDPR Art. 6(1)(f) legitimate interest |
| **Config files** | Duration of deployment | Service operation | GDPR Art. 6(1)(f) legitimate interest |
| **Session transcripts** (Claude Code) | As per Claude Code retention policy or deployer policy | Developer reference, project history | Deployer determines |

### 3.2 Retention for Compliance Frameworks

| Framework | Requirement | Recommended Minimum |
|-----------|-------------|-------------------|
| **GDPR (EU)** | Art. 5(1)(e) — storage limitation | Not longer than necessary. 12–36 months for audit. |
| **SOC 2 Type II** | Audit evidence retention | 12 months active, 36 months archive. |
| **HIPAA** | § 164.530(j) — 6-year retention | 6 years for audit logs if PHI is involved. |
| **CCPA / CPRA** | 12–24 months for most data | 24 months for non-essential data. |
| **SOX** | 7 years for financial records | 7 years if metering data supports financial reporting. |
| **Litigation hold** | Until hold released | Indefinite during active legal proceedings. |

### 3.3 Current Aegis Retention Behavior

As of version 0.6.0-preview:

| Data | Auto-Deletion | Behavior |
|------|--------------|----------|
| Audit logs (`audit/*.jsonl`) | **None** | Daily files accumulate indefinitely. No rotation or cleanup. |
| API key store (`keys.json`) | **On revocation** | Revoked keys removed from store. Grace keys cleaned up after expiry. |
| Session state (`state.json`) | **On session kill** | Killed sessions removed from active state. Backup (`state.json.bak`) overwritten on next save. |
| Metrics (`metrics.json`) | **None** | Accumulates indefinitely. |
| Metering (`metering.json`) | **None** | Accumulates indefinitely. |
| Memory bridge (`memory.json`) | **None** | Accumulates indefinitely. |
| Pipeline state | **On completion** | Completed pipelines cleaned up. |

**Key gap:** Aegis does not currently implement automatic data expiry. All retention enforcement
is the deployer's responsibility via external tooling (cron jobs, logrotate, etc.).

---

## 4. Deletion Mechanisms

### 4.1 API Key Data

**Trigger:** Key revocation via the `DELETE /v1/keys/:id` endpoint.

| Step | Action | Effect |
|------|--------|--------|
| 1 | API call authenticates with admin key | Authorization check |
| 2 | `AuthManager.revokeKey()` removes key from store | Key can no longer authenticate |
| 3 | `keys.json` saved with mode `0o600` | Persistent store updated |
| 4 | `QuotaManager.clearKey()` removes in-memory usage | Ephemeral data cleared |
| 5 | Audit log entry: "Key revoked: {name} ({id})" | Revocation recorded (not deleted) |

**Not deleted:**
- Historical audit log entries referencing the revoked key.
- Historical metrics/metering data associated with the key's sessions.

### 4.2 Session Data

**Trigger:** Session kill via `POST /v1/sessions/:id/kill` or session completion.

| Step | Action | Effect |
|------|--------|--------|
| 1 | Kill command sent to Claude Code process | CC process terminated |
| 2 | Tmux window destroyed | Terminal session ended |
| 3 | Session removed from `SessionManager` state | Active state cleared |
| 4 | `state.json` updated | Persistent store updated |
| 5 | Hook settings temp file cleaned up | Per-session secrets removed |

**Not deleted:**
- JSONL transcript files (managed by Claude Code, in the project's `.claude/` directory).
- Audit log entries referencing the session.
- Metrics/metering data for the session.

### 4.3 Manual Bulk Deletion

Deployers can perform bulk deletion using filesystem commands:

```bash
#!/bin/bash
# delete-audit-logs.sh — Delete audit logs older than N days
# Usage: ./delete-audit-logs.sh <state_dir> <days>
#
# WARNING: Deleting audit logs may violate compliance requirements.
# Consult your legal team before running.

STATE_DIR="${1:-$HOME/.aegis}"
DAYS="${2:-365}"

if [ ! -d "$STATE_DIR/audit" ]; then
  echo "No audit directory found at $STATE_DIR/audit"
  exit 1
fi

echo "Deleting audit logs older than $DAYS days from $STATE_DIR/audit"
find "$STATE_DIR/audit" -name "*.jsonl" -mtime +"$DAYS" -print -delete
echo "Done."
```

```bash
#!/bin/bash
# purge-session-state.sh — Purge session state, metrics, and metering
# WARNING: This removes all historical session tracking data.
# Audit logs are NOT affected.

STATE_DIR="${1:-$HOME/.aegis}"

echo "Purging session tracking data from $STATE_DIR"
rm -f "$STATE_DIR/metrics.json"
rm -f "$STATE_DIR/metering.json"
rm -f "$STATE_DIR/memory.json"
rm -f "$STATE_DIR/session_map.json"
rm -f "$STATE_DIR/state.json.bak"
echo "Done. Active state preserved in state.json."
```

### 4.4 Data Subject Erasure Request (Art. 17)

To fulfill a right-to-erasure request for a specific data subject:

1. **Identify the data subject's API key(s):** Query `keys.json` for key names matching the
   data subject.
2. **Revoke the key(s):** Use `DELETE /v1/keys/:id` or edit `keys.json` directly.
3. **Kill active sessions:** Terminate any sessions owned by the revoked key(s).
4. **Remove audit entries:** Audit logs are append-only with SHA-256 chaining. Options:
   - **Preferred:** Anonymize by replacing the key ID with a placeholder. This preserves chain
     integrity but breaks the link to the data subject.
   - **Alternative:** Delete the relevant daily audit files and regenerate the chain. This
     requires downtime and affects all entries in those files.
5. **Remove metrics/metering:** Delete `metrics.json` and `metering.json`, or filter entries
   programmatically.
6. **Remove session transcripts:** Identify and delete Claude Code JSONL files in the data
   subject's working directories.
7. **Remove config references:** Update configuration to remove Telegram user IDs, Slack
   references, or other identifiers associated with the data subject.
8. **Document the erasure:** Record the request, scope, date, and actions taken in a secure
   log (not in the Aegis audit trail, which may have been modified).

---

## 5. Legal Hold Override

### 5.1 When a Hold Applies

A legal hold overrides the retention schedules in Section 3 when:

- Litigation is pending or reasonably anticipated.
- A regulatory investigation or audit has been initiated.
- Law enforcement has issued a preservation request.
- Internal investigation requires data preservation.

### 5.2 Hold Procedure

1. **Notification:** Legal counsel or compliance officer issues a written hold notice specifying
   the scope (data categories, date ranges, subjects).
2. **Suspension:** All deletion and rotation operations for the specified data are suspended.
3. **Preservation:** Affected data is copied to a hold-specific location outside normal
   retention schedules.
4. **Documentation:** The hold is logged with start date, scope, issuing authority, and
   reference to the triggering event.
5. **Release:** When the hold is lifted, the data returns to its normal retention schedule.
   The previously suspended deletion operations resume.

### 5.3 Technical Implementation

Since Aegis does not have a built-in legal hold mechanism:

1. **Audit logs:** Move affected daily `.jsonl` files to a read-only hold directory before any
   retention cleanup runs.
2. **State files:** Take snapshots of `state.json`, `metrics.json`, `metering.json` at the
   time of the hold.
3. **Config:** Preserve a copy of the configuration file as it existed during the hold period.

---

## 6. Audit and Compliance

### 6.1 Retention Compliance Verification

Deployers should verify retention compliance on a regular cadence:

```bash
#!/bin/bash
# retention-audit.sh — Verify retention compliance
# Reports data age and volume for each data store.

STATE_DIR="${1:-$HOME/.aegis}"

echo "=== Aegis Retention Audit Report ==="
echo "State directory: $STATE_DIR"
echo "Report date: $(date -I)"
echo ""

echo "--- Audit Logs ---"
if [ -d "$STATE_DIR/audit" ]; then
  echo "Oldest log: $(find "$STATE_DIR/audit" -name '*.jsonl' -printf '%T+ %p\n' | sort | head -1)"
  echo "Newest log: $(find "$STATE_DIR/audit" -name '*.jsonl' -printf '%T+ %p\n' | sort -r | head -1)"
  echo "Total files: $(find "$STATE_DIR/audit" -name '*.jsonl' | wc -l)"
  echo "Total size: $(du -sh "$STATE_DIR/audit" | cut -f1)"
else
  echo "No audit directory found."
fi
echo ""

echo "--- Metrics ---"
if [ -f "$STATE_DIR/metrics.json" ]; then
  echo "Size: $(du -sh "$STATE_DIR/metrics.json" | cut -f1)"
  echo "Last modified: $(stat -c '%y' "$STATE_DIR/metrics.json")"
else
  echo "No metrics file found."
fi
echo ""

echo "--- Metering ---"
if [ -f "$STATE_DIR/metering.json" ]; then
  echo "Size: $(du -sh "$STATE_DIR/metering.json" | cut -f1)"
  echo "Last modified: $(stat -c '%y' "$STATE_DIR/metering.json")"
else
  echo "No metering file found."
fi
echo ""

echo "--- Session State ---"
if [ -f "$STATE_DIR/state.json" ]; then
  echo "Size: $(du -sh "$STATE_DIR/state.json" | cut -f1)"
  echo "Last modified: $(stat -c '%y' "$STATE_DIR/state.json")"
else
  echo "No state file found."
fi
echo ""

echo "--- Key Store ---"
if [ -f "$STATE_DIR/keys.json" ]; then
  KEY_COUNT=$(python3 -c "import json; d=json.load(open('$STATE_DIR/keys.json')); print(len(d.get('keys', d) if isinstance(d, dict) else d))" 2>/dev/null || echo "parse error")
  echo "Key count: $KEY_COUNT"
  echo "File permissions: $(stat -c '%a' "$STATE_DIR/keys.json")"
else
  echo "No key store found."
fi
echo ""
echo "=== End Report ==="
```

### 6.2 Compliance Documentation Checklist

For each compliance audit, document:

- [ ] Retention schedule is documented and approved.
- [ ] Deletion procedures have been tested.
- [ ] Audit log age does not exceed the retention policy.
- [ ] Revoked API keys have been removed from the key store.
- [ ] Metrics and metering data are within the retention window.
- [ ] No stale session state exists (all killed sessions removed).
- [ ] Legal hold procedures are documented and accessible.
- [ ] DSAR procedure has been tested (or documented as gap).

---

## 7. Implementation Guide

### 7.1 Automated Retention with Cron

Recommended cron configuration for automated data cleanup:

```bash
# /etc/cron.d/aegis-retention — Run daily at 03:17
# Adjust STATE_DIR and retention days as needed.

STATE_DIR=/home/aegis/.aegis

# Purge audit logs older than 365 days
17 3 * * * aegis find "$STATE_DIR/audit" -name "*.jsonl" -mtime +365 -delete

# Rotate metrics if larger than 100MB
17 3 * * * aegis [ $(stat -c%s "$STATE_DIR/metrics.json" 2>/dev/null || echo 0) -gt 104857600 ] && mv "$STATE_DIR/metrics.json" "$STATE_DIR/metrics.json.old"

# Rotate metering if larger than 100MB
17 3 * * aegis [ $(stat -c%s "$STATE_DIR/metering.json" 2>/dev/null || echo 0) -gt 104857600 ] && mv "$STATE_DIR/metering.json" "$STATE_DIR/metering.json.old"
```

### 7.2 Logrotate Configuration

```
# /etc/logrotate.d/aegis-audit
/home/aegis/.aegis/audit/*.jsonl {
    daily
    rotate 365
    compress
    delaycompress
    missingok
    notifempty
    create 0600 aegis aegis
}
```

### 7.3 Docker Deployment Considerations

When running Aegis in Docker:

1. **Mount the state directory as a volume** to persist data across container restarts:
   ```
   -v /persistent/aegis-state:/home/aegis/.aegis
   ```
2. **Run retention scripts on the host**, not inside the container, to avoid container lifecycle
   issues.
3. **Set appropriate file permissions** on the mounted volume:
   ```bash
   chown -R 1000:1000 /persistent/aegis-state
   chmod 700 /persistent/aegis-state
   ```

### 7.4 Kubernetes Deployment Considerations

When running Aegis on Kubernetes:

1. **Use a PersistentVolumeClaim** for the state directory.
2. **Run retention as a CronJob:**
   ```yaml
   apiVersion: batch/v1
   kind: CronJob
   metadata:
     name: aegis-retention
   spec:
     schedule: "17 3 * * *"
     jobTemplate:
       spec:
         template:
           spec:
             containers:
             - name: retention
               image: busybox
               command:
               - /bin/sh
               - -c
               - find /aegis-state/audit -name "*.jsonl" -mtime +365 -delete
               volumeMounts:
               - name: aegis-state
                 mountPath: /aegis-state
             volumes:
             - name: aegis-state
               persistentVolumeClaim:
                 claimName: aegis-state-pvc
   ```

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-04-23 | 1.0.0 | Initial data retention and deletion policy. |
