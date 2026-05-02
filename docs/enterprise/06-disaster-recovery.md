# 06 — Disaster Recovery Runbook

**Date:** 2026-05-02 | **Applies to:** Aegis ≥ 0.6.5 | **Issue:** #1950

---

## Overview

This runbook covers backup, export, integrity verification, and restore procedures for a self-hosted Aegis deployment. It uses the **REST API** for all operations — CLI commands (`ag admin export` / `ag admin import`) are planned for a future release.

> **Scope:** Single-node deployments (systemd, Docker Compose). Multi-node DR is covered in the distributed architecture ADR.

---

## 1. What to Back Up

Aegis stores all state under the **state directory** (default `~/.aegis`, configurable via `AEGIS_STATE_DIR`):

| Path | Contents | Critical? |
|------|----------|-----------|
| `~/.aegis/config.yaml` | Server configuration, auth token | ✅ Yes |
| `~/.aegis/auth.json` | OIDC device-flow tokens (if SSO enabled) | ⚠️ Only with SSO |
| `~/.aegis/audit/` | SHA-256-chained audit log (JSONL) | ✅ Yes |
| `~/.aegis/sessions/` | Session transcripts (JSONL) | ✅ Yes |
| `~/.aegis/memory/` | Memory Bridge persistent store | ⚠️ If used |

### Filesystem Backup (Quick Method)

```bash
# Stop Aegis to get a consistent snapshot
sudo systemctl stop aegis

# Create timestamped backup
BACKUP_DATE=$(date +%Y-%m-%d_%H%M%S)
tar czf "aegis-backup-${BACKUP_DATE}.tar.gz" \
  -C "$HOME" .aegis/

# Restart
sudo systemctl start aegis

# Verify backup
tar tzf "aegis-backup-${BACKUP_DATE}.tar.gz" | head -20
```

**Docker Compose variant:**

```bash
docker compose stop aegis
BACKUP_DATE=$(date +%Y-%m-%d_%H%M%S)
docker cp aegis:/root/.aegis "./aegis-backup-${BACKUP_DATE}"
tar czf "aegis-backup-${BACKUP_DATE}.tar.gz" "./aegis-backup-${BACKUP_DATE}"
rm -rf "./aegis-backup-${BACKUP_DATE}"
docker compose start aegis
```

---

## 2. Audit Chain Export

The audit log is the most critical data — it is **SHA-256 hash-chained** and tamper-evident.

### Full Export (JSON)

```bash
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:9100/v1/audit?limit=10000&verify=true" \
  | jq . > audit-export-$(date +%Y-%m-%d).json
```

The `verify=true` parameter runs chain integrity validation. Response includes:

```json
{
  "integrity": {
    "valid": true,
    "brokenAt": null,
    "file": null
  },
  "chain": {
    "count": 1842,
    "firstHash": "a1b2c3...",
    "lastHash": "d4e5f6...",
    "badgeHash": "abc123...",
    "firstTs": "2026-04-01T00:00:00.000Z",
    "lastTs": "2026-05-02T07:00:00.000Z"
  }
}
```

### Export as CSV (for compliance archives)

```bash
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: text/csv" \
  "http://localhost:9100/v1/audit?verify=true" \
  > audit-export-$(date +%Y-%m-%d).csv
```

### Export as NDJSON (for tooling pipelines)

```bash
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Accept: application/x-ndjson" \
  "http://localhost:9100/v1/audit?verify=true" \
  > audit-export-$(date +%Y-%m-%d).ndjson
```

### Integrity Check (Standalone)

```bash
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:9100/v1/audit?verify=true&limit=1" \
  | jq '.integrity'
```

**If `valid` is `false`:**

1. Check `brokenAt` for the sequence number where the chain breaks.
2. Inspect the audit JSONL file at `~/.aegis/audit/` around that line.
3. The broken hash and the expected hash are logged — compare them.
4. Do **not** delete or modify audit files. Preserve the broken chain for forensic review.

---

## 3. API Key Recovery

API keys are stored as SHA-256 hashes. Plaintext is returned **only at creation time** and cannot be recovered.

### Before Disaster: Key Inventory

```bash
curl -s -H "Authorization: Bearer YOUR_MASTER_KEY" \
  "http://localhost:9100/v1/auth/keys" \
  | jq '[.[] | {id, name, role, permissions, createdAt}]'
```

Save this output regularly — it is your key registry for disaster recovery.

### After Restore: Key Rotation

Since key plaintext cannot be recovered from backups:

1. Generate a new master key:
   ```bash
   curl -s -X POST -H "Authorization: Bearer YOUR_OLD_MASTER_KEY" \
     "http://localhost:9100/v1/auth/keys" \
     -H "Content-Type: application/json" \
     -d '{"name": "recovery-master", "role": "admin"}' \
     | jq .
   ```
2. **Save the returned plaintext key immediately** — it will not be shown again.
3. Update all integrations (CI pipelines, MCP clients, dashboards) with the new key.
4. Delete old keys once all integrations are updated:
   ```bash
   curl -s -X DELETE -H "Authorization: Bearer YOUR_NEW_MASTER_KEY" \
     "http://localhost:9100/v1/auth/keys/OLD_KEY_ID"
   ```

---

## 4. Restore Procedure

### Full Restore from Filesystem Backup

```bash
# Stop Aegis
sudo systemctl stop aegis

# Verify backup integrity
tar tzf aegis-backup-YYYY-MM-DD_HHMMSS.tar.gz | wc -l

# Restore (preserves existing as .bak)
mv ~/.aegis ~/.aegis.pre-restore.$(date +%s)
tar xzf aegis-backup-YYYY-MM-DD_HHMMSS.tar.gz -C "$HOME"

# Verify config loaded correctly
cat ~/.aegis/config.yaml

# Start Aegis
sudo systemctl start aegis

# Health check
curl -s http://localhost:9100/v1/health | jq .
```

### Verify Post-Restore Integrity

```bash
# 1. Server health
curl -s http://localhost:9100/v1/health | jq .

# 2. Audit chain integrity
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:9100/v1/audit?verify=true&limit=1" \
  | jq '.integrity'

# 3. Session count matches pre-disaster
curl -s -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:9100/v1/sessions?limit=1" \
  | jq '.total'
```

---

## 5. Scheduled Backup Automation

### Cron (Linux/macOS)

```bash
# Daily backup at 02:00, keep 30 days
0 2 * * * /usr/local/bin/aegis-backup.sh >> /var/log/aegis-backup.log 2>&1
```

`/usr/local/bin/aegis-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${AEGIS_STATE_DIR:-$HOME/.aegis}"
BACKUP_DIR="/var/backups/aegis"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y-%m-%d_%H%M%S)
FILE="${BACKUP_DIR}/aegis-${DATE}.tar.gz"

# Create backup
tar czf "$FILE" -C "$(dirname "$STATE_DIR")" "$(basename "$STATE_DIR")"

# Rotate old backups
find "$BACKUP_DIR" -name "aegis-*.tar.gz" -mtime +$RETENTION_DAYS -delete

# Verify
if ! tar tzf "$FILE" >/dev/null 2>&1; then
  echo "ERROR: Backup verification failed for ${FILE}"
  rm -f "$FILE"
  exit 1
fi

echo "$(date -Iseconds) Backup created: ${FILE} ($(du -h "$FILE" | cut -f1))"
```

### Docker Compose Volume Backup

```yaml
# docker-compose.override.yml (backup service)
services:
  backup:
    image: alpine:3.19
    volumes:
      - aegis-data:/data:ro
      - ./backups:/backups
    entrypoint: >
      tar czf /backups/aegis-$(date +%Y-%m-%d).tar.gz -C /data .
    profiles: ["backup"]

volumes:
  aegis-data:
    external: true
```

```bash
docker compose --profile backup run --rm backup
```

---

## 6. Disaster Scenarios

### Scenario A: Disk Failure (Total Data Loss)

1. Provision new server with same Aegis version.
2. Install Aegis and configure `AEGIS_STATE_DIR`.
3. Restore from most recent filesystem backup (Section 4).
4. Rotate all API keys (Section 3).
5. Verify audit chain integrity.
6. Reconnect all integrations (CI, dashboards, notification channels).

### Scenario B: Audit Chain Corruption

1. **Do not modify audit files.** Export the corrupted chain for forensic review:
   ```bash
   curl -s -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Accept: text/csv" \
     "http://localhost:9100/v1/audit?verify=true" \
     > audit-forensic-$(date +%Y-%m-%d).csv
   ```
2. Check `brokenAt` in the integrity response to identify the corruption point.
3. If the corruption is in a single record, contact support with the forensic export.
4. Aegis continues operating — audit queries return records before the break point.

### Scenario C: Configuration Loss

1. Restore `config.yaml` from backup or version control.
2. Validate the configuration:
   ```bash
   # If using the CLI
   ag init --verify 2>/dev/null || true
   ```
3. Restart Aegis and run health check.
4. API keys are stored separately — they survive config-only loss if the key file is intact.

### Scenario D: Accidental Key Deletion

1. Keys cannot be recovered — generate a new one immediately.
2. If the master key was deleted, use the `AEGIS_MASTER_TOKEN` environment variable (set during initial setup) to authenticate and create a replacement.
3. Update all downstream consumers.

---

## 7. Acceptance Criteria Mapping

| Criterion | Status | Reference |
|-----------|--------|-----------|
| `ag admin export` / `ag admin import` commands | 🔜 Planned | REST API equivalents documented in Sections 2–4 |
| Audit-chain backup with integrity verification | ✅ Covered | Section 2 — `verify=true` parameter |
| Key-material recovery procedure | ✅ Covered | Section 3 — rotation workflow |
| Runbook validated in tabletop exercise | ⏳ Pending | Execute Scenario A–D in staging |

---

## References

- [Audit log architecture](../enterprise/00-gap-analysis.md) — Section on SHA-256 chain design
- [Security review](./02-security.md) — Auth model and key storage
- [Positioning ADR-0023](../adr/0023-positioning-claude-code-control-plane.md)
- [REST API reference](https://github.com/OneStepAt4time/aegis#api-reference)
