# Aegis Disaster Recovery Runbook

Recovery procedures for data loss, corruption, and infrastructure failures in a self-hosted Aegis deployment.

> **Companion document:** [Incident and Rollback Runbook](./incident-rollback-runbook.md) covers deployment rollbacks (bad releases, version pinning). This document covers data and state recovery.

---

## State File Reference

Aegis stores all state under `~/.aegis/` (configurable via `AEGIS_STATE_DIR`).

| File | Format | Purpose | Criticality |
|------|--------|---------|-------------|
| `state.json` | JSON | Session state: IDs, window IDs, byte offsets, statuses, encrypted hook secrets | **Critical** |
| `state.json.bak` | JSON | Last known-good backup of `state.json` | **Critical** (recovery source) |
| `session_map.json` | JSON | CC session ID → Aegis window mapping (24 h TTL) | Medium (auto-rebuilt) |
| `keys.json` | JSON (0600) | API key store: hashes, roles, permissions, quotas | **Critical** |
| `audit/audit-YYYY-MM-DD.log` | NDJSON (0600) | Tamper-evident hash-chained audit trail | **Critical** |
| `pipelines.json` | JSON | Running pipeline state | Medium |
| `memory.json` | JSON | Cross-session key/value memory | Low (optional feature) |
| `metrics.json` | JSON | Session metrics | Low |
| `metering.json` | JSON | Usage/cost metering | Low |
| `aegis.pid` | Text (0600) | Current process PID | Informational |

Config files (priority order): `--config` flag → `.aegis/config.yaml` → `aegis.config.json` → `~/.aegis/config.yaml` → `~/.aegis/config.json`.

All state files use atomic write-then-rename to prevent partial-write corruption.

---

## Recovery Scenarios

### Scenario 1 — Aegis Server Crash (No Data Loss)

The Aegis Node.js process dies. tmux and its windows (Claude Code sessions) keep running independently.

**What survives:**
- All tmux windows (Claude Code sessions continue running)
- `state.json` (persisted before crash)
- All disk state (keys, audit, config)

**What is lost (in-memory only):**
- Pending permission approval promises
- Pending question/answer promises
- SSE connection state
- Rate limit token buckets
- Transcript parse caches

**Recovery steps:**

1. **Verify tmux is alive.**
   ```bash
   tmux list-sessions
   # Should show the aegis session (default name: "aegis")
   ```

2. **Start Aegis.** The server runs `SessionManager.load()` → `reconcile()` on startup, which:
   - Loads `state.json`
   - Lists current tmux windows
   - Re-attaches sessions by window ID or window name (handles tmux ID changes)
   - Adopts orphaned `cc-*` / `_bridge_` windows not tracked in state
   - Restarts JSONL discovery polling

   ```bash
   aegis   # or: ag
   ```

3. **Verify recovery.**
   ```bash
   curl -s http://localhost:9100/v1/health
   curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
     http://localhost:9100/v1/sessions | jq '.[].id'
   ```

4. **Check session count matches tmux windows.**
   ```bash
   tmux list-windows -t aegis | wc -l
   curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
     http://localhost:9100/v1/sessions | jq length
   ```

   If counts differ, orphaned windows were adopted automatically. If a session is missing, see Scenario 2.

**RTO:** < 30 seconds (process restart time + reconciliation).

---

### Scenario 2 — State File Corruption (`state.json`)

`state.json` is corrupted or missing (e.g., disk error, accidental deletion).

**Automatic recovery:**

Aegis loads `state.json` on startup. If validation fails, it falls back to `state.json.bak` automatically. If both are corrupted:

**Manual recovery steps:**

1. **Stop Aegis.**
   ```bash
   # Find and stop the process
   kill $(cat ~/.aegis/aegis.pid 2>/dev/null) 2>/dev/null || true
   ```

2. **Assess the damage.**
   ```bash
   # Check if backup is valid
   jq . ~/.aegis/state.json.bak 2>/dev/null && echo "backup OK" || echo "backup corrupted"

   # Check if primary is valid
   jq . ~/.aegis/state.json 2>/dev/null && echo "primary OK" || echo "primary corrupted"
   ```

3. **Restore from backup.**
   ```bash
   if jq . ~/.aegis/state.json.bak >/dev/null 2>&1; then
     cp ~/.aegis/state.json.bak ~/.aegis/state.json
     echo "Restored from state.json.bak"
   else
     echo "No valid backup. Starting fresh."
     mv ~/.aegis/state.json ~/.aegis/state.json.corrupted.$(date +%s) 2>/dev/null
   fi
   ```

4. **Start Aegis.** Reconciliation will:
   - Drop sessions whose tmux windows no longer exist
   - Adopt orphaned `cc-*` / `_bridge_` windows as new sessions
   - Restart monitoring for surviving sessions

   ```bash
   aegis
   ```

5. **Verify orphan adoption worked.**
   ```bash
   curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
     http://localhost:9100/v1/sessions | jq '[.[] | .id]'
   tmux list-windows -t aegis
   ```

**If all state is lost:** Aegis starts with an empty session list. Existing tmux windows with `cc-*` or `_bridge_` prefixes are auto-adopted. Sessions without these prefixes are lost and must be recreated manually.

---

### Scenario 3 — API Key Store Loss (`keys.json`)

`keys.json` is deleted or corrupted. No API keys → no authenticated access.

**Recovery steps:**

1. **Check for backups.** Aegis does not automatically back up `keys.json`. If you have a manual backup:
   ```bash
   cp /path/to/keys.json.backup ~/.aegis/keys.json
   chmod 600 ~/.aegis/keys.json
   ```

2. **If no backup exists**, recreate the master key:
   ```bash
   # Aegis creates a master key on first run if none exists
   aegis

   # Then generate a new API key
   ag admin key generate --role admin
   ```

3. **Audit implications.** Key IDs will differ from originals. If you rely on key IDs in external systems, update those references.

4. **Rotate all keys** if there is any chance the key file was exfiltrated rather than simply lost:
   ```bash
   ag admin key generate --role admin
   # Then revoke all old keys via the API
   ```

**Prevention:** Include `keys.json` in scheduled backups (see Backup Procedures below).

---

### Scenario 4 — Audit Log Corruption

Audit log files (`~/.aegis/audit/audit-YYYY-MM-DD.log`) are hash-chained. Corruption breaks the chain.

**Detection:**

```bash
# Verify chain integrity via API
curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
  "http://localhost:9100/v1/audit?verify=true" | jq .
# Look for X-Aegis-Audit-Integrity-Valid header
```

**Recovery steps:**

1. **Identify the break point.**
   ```bash
   # Find which file has the corruption
   for f in ~/.aegis/audit/audit-*.log; do
     echo "=== $f ==="
     wc -l "$f"
     # Check for malformed lines
     while IFS= read -r line; do
       echo "$line" | jq . 2>/dev/null >/dev/null || echo "MALFORMED: ${line:0:80}"
     done < "$f"
   done
   ```

2. **Isolate the corrupted file.**
   ```bash
   cp ~/.aegis/audit/audit-YYYY-MM-DD.log \
      ~/.aegis/audit/audit-YYYY-MM-DD.log.corrupted
   ```

3. **Truncate at the break.** Remove records after the last valid chain link:
   ```bash
   # Keep only valid records (manual inspection required)
   head -n <last-valid-line> ~/.aegis/audit/audit-YYYY-MM-DD.log.corrupted \
     > ~/.aegis/audit/audit-YYYY-MM-DD.log
   chmod 600 ~/.aegis/audit/audit-YYYY-MM-DD.log
   ```

4. **Re-verify.** After restart, Aegis continues the chain from the last valid record's hash. New records will chain correctly from the truncation point.

**Prevention:** Audit logs are append-only with mode 0600. Include in backups. Monitor with `?verify=true` in health checks.

---

### Scenario 5 — Disk Full

Aegis writes to `~/.aegis/`. If the partition fills up, writes fail silently (atomic rename fails).

**Symptoms:**
- Sessions not persisting (lost on restart)
- Audit records not appending
- New sessions failing to create

**Recovery steps:**

1. **Free space immediately.**
   ```bash
   df -h ~/.aegis/
   du -sh ~/.aegis/* | sort -rh | head -5

   # Common space hogs:
   # - Audit logs (rotate/compress old ones)
   # - metrics.json / metering.json (can be truncated)
   ```

2. **Compress old audit logs.**
   ```bash
   # Keep last 30 days uncompressed, compress the rest
   find ~/.aegis/audit/ -name "audit-*.log" -mtime +30 \
     -exec gzip {} \;
   ```

   Aegis reads `.log` files; compressed `.log.gz` files are skipped safely.

3. **Truncate non-critical files.**
   ```bash
   # These are rebuilt or are non-essential
   > ~/.aegis/metrics.json
   > ~/.aegis/metering.json
   > ~/.aegis/memory.json    # only if memory bridge is enabled
   ```

4. **Restart Aegis** to restore normal write behavior.
   ```bash
   kill $(cat ~/.aegis/aegis.pid) && aegis
   ```

**Prevention:** Set up disk usage monitoring. Alert at 80% utilization on the `~/.aegis/` partition.

---

### Scenario 6 — Network Partition

Aegis becomes unreachable from clients. Sessions keep running in tmux.

**Recovery steps:**

1. **Check if Aegis is running.**
   ```bash
   curl -s http://localhost:9100/v1/health
   # If reachable locally but not remotely → firewall/network issue
   # If unreachable locally → Aegis crashed, see Scenario 1
   ```

2. **If local access works**, check network:
   ```bash
   # Verify the port is bound
   ss -tlnp | grep 9100

   # Check firewall rules
   sudo iptables -L -n | grep 9100
   # or
   sudo ufw status | grep 9100
   ```

3. **If Aegis is bound to 127.0.0.1 only**, update config:
   ```bash
   # Set AEGIS_HOST to 0.0.0.0 or specific interface
   export AEGIS_HOST=0.0.0.0
   ```

4. **During partition:** Sessions continue running. Messages sent during the partition are lost (not queued). SSE clients disconnect and must reconnect.

---

### Scenario 7 — tmux Server Crash

The tmux server dies, killing all Claude Code sessions.

**Recovery steps:**

1. **tmux auto-recovers** if sessions are configured to respawn. Otherwise:

   ```bash
   # Verify tmux is running
   tmux list-sessions 2>/dev/null || echo "tmux not running"
   ```

2. **Start a fresh tmux server.**
   ```bash
   tmux new-session -d -s aegis
   ```

3. **Restart Aegis.** Reconciliation detects that all tracked windows are gone, marks sessions as terminated, and clears stale state.

   ```bash
   aegis
   ```

4. **Recreate sessions** that were lost. There is no automatic session replay.

**What is lost:** All running Claude Code sessions. Their JSONL transcripts on disk (`~/.claude/projects/`) are preserved and can be read for historical context, but the live sessions are gone.

---

## Backup Procedures

### What to Back Up

**Essential (every backup):**
- `~/.aegis/state.json`
- `~/.aegis/keys.json`
- `~/.aegis/audit/` (entire directory)
- Aegis config file (`.aegis/config.yaml` or equivalent)

**Recommended:**
- `~/.aegis/pipelines.json` (if running pipelines)
- `~/.aegis/memory.json` (if memory bridge is enabled)

**Optional:**
- `~/.aegis/metrics.json`
- `~/.aegis/metering.json`

### Manual Backup

```bash
#!/bin/bash
# aegis-backup.sh — manual backup script
set -euo pipefail

STATE_DIR="${AEGIS_STATE_DIR:-$HOME/.aegis}"
BACKUP_DIR="${1:-$HOME/aegis-backups/$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$BACKUP_DIR"

# Essential files
cp "$STATE_DIR/state.json" "$BACKUP_DIR/" 2>/dev/null || true
cp "$STATE_DIR/state.json.bak" "$BACKUP_DIR/" 2>/dev/null || true
cp "$STATE_DIR/keys.json" "$BACKUP_DIR/" 2>/dev/null || true

# Audit logs
cp -r "$STATE_DIR/audit/" "$BACKUP_DIR/audit/" 2>/dev/null || true

# Config (search all locations)
for f in .aegis/config.yaml .aegis/config.yml aegis.config.json \
         "$STATE_DIR/config.yaml" "$STATE_DIR/config.json"; do
  [ -f "$f" ] && cp "$f" "$BACKUP_DIR/"
done

# Recommended
cp "$STATE_DIR/pipelines.json" "$BACKUP_DIR/" 2>/dev/null || true
cp "$STATE_DIR/memory.json" "$BACKUP_DIR/" 2>/dev/null || true

echo "Backup saved to $BACKUP_DIR"
ls -la "$BACKUP_DIR/"
```

### Restore from Backup

```bash
#!/bin/bash
# aegis-restore.sh — restore from backup
set -euo pipefail

STATE_DIR="${AEGIS_STATE_DIR:-$HOME/.aegis}"
BACKUP_DIR="${1:?'Usage: aegis-restore.sh <backup-dir>'}"

# Stop Aegis first
kill "$(cat "$STATE_DIR/aegis.pid" 2>/dev/null)" 2>/dev/null || true
sleep 2

# Restore files
cp "$BACKUP_DIR/state.json" "$STATE_DIR/" 2>/dev/null || true
cp "$BACKUP_DIR/state.json.bak" "$STATE_DIR/" 2>/dev/null || true
cp "$BACKUP_DIR/keys.json" "$STATE_DIR/" && chmod 600 "$STATE_DIR/keys.json"
cp -r "$BACKUP_DIR/audit/" "$STATE_DIR/audit/" 2>/dev/null || true
cp "$BACKUP_DIR/pipelines.json" "$STATE_DIR/" 2>/dev/null || true
cp "$BACKUP_DIR/memory.json" "$STATE_DIR/" 2>/dev/null || true

# Fix permissions
chmod 600 "$STATE_DIR/keys.json"
chmod -R 600 "$STATE_DIR/audit/" 2>/dev/null || true

echo "Restored from $BACKUP_DIR. Start Aegis to reconcile."
aegis
```

### Scheduled Backups (cron)

```bash
# Daily backup at 03:00
0 3 * * * /path/to/aegis-backup.sh >> /var/log/aegis-backup.log 2>&1

# Retain last 30 days
0 4 * * * find $HOME/aegis-backups/ -maxdepth 1 -mtime +30 -exec rm -rf {} \;
```

### Planned: `ag admin export` / `ag admin import`

> **Status: Planned — not yet implemented.**
> These CLI commands are part of the Phase 4 roadmap (Issue #1950).
> Use the manual backup/restore scripts above until these ship.

When implemented, Aegis will provide built-in export and import commands:

```bash
# Export all state to a portable archive
ag admin export --output /path/to/aegis-backup-20260426.tar.gz

# Export with audit verification
ag admin export --output /path/to/backup.tar.gz --verify-audit

# Import from an archive (Aegis must be stopped)
ag admin import --input /path/to/aegis-backup-20260426.tar.gz

# Dry-run import (verify archive without applying)
ag admin import --input /path/to/backup.tar.gz --dry-run

# Import with force (overwrite existing state)
ag admin import --input /path/to/backup.tar.gz --force
```

**Export archive contents:**

```
aegis-export-YYYYMMDD-HHMMSS/
├── manifest.json          # Export metadata (version, timestamp, checksums)
├── state.json             # Session state
├── keys.json              # API key store (encrypted at rest)
├── audit/                 # Audit log chain
│   ├── audit-2026-04-25.log
│   └── audit-2026-04-26.log
├── pipelines.json         # Pipeline state
├── memory.json            # Cross-session memory
└── checksums.sha256       # Integrity verification
```

**Security considerations:**
- Exported archives contain sensitive data (API keys, audit trails). Encrypt before transferring.
- The `--verify-audit` flag runs chain integrity verification during export.
- Import validates checksums before applying. Corrupted archives are rejected.

---

## Audit Chain Backup and Verification

### Backup

Audit logs are append-only and never modified after the day rolls over. Back up the entire `audit/` directory.

```bash
# Verify chain integrity before backup
curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
  "http://localhost:9100/v1/audit?verify=true&limit=1" -D - | \
  grep -i "X-Aegis-Audit-Integrity-Valid"
```

### Integrity Verification After Restore

```bash
# Full chain verification
curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
  "http://localhost:9100/v1/audit?verify=true&format=ndjson" | \
  jq -c 'select(.integrity)'

# Or manually check the chain
for f in $(ls -t ~/.aegis/audit/audit-*.log); do
  echo "Verifying $f..."
  prev=""
  while IFS= read -r line; do
    hash=$(echo "$line" | jq -r '.hash')
    prevHash=$(echo "$line" | jq -r '.prevHash')
    if [ -n "$prev" ] && [ "$prev" != "$prevHash" ]; then
      echo "CHAIN BREAK in $f: expected prevHash=$prev, got=$prevHash"
    fi
    prev="$hash"
  done < "$f"
done
```

---

## Failover Procedures

### Single-Instance (Current Architecture)

Aegis is a single-instance bridge. There is no built-in clustering or replication. For high availability:

**Cold standby pattern:**

1. **Standby server** with Aegis installed but not running
2. **Shared storage** (NFS, EBS snapshot, rsync) for `~/.aegis/`
3. **On primary failure:**
   ```bash
   # On standby, sync latest state
   rsync -avz primary-host:.aegis/ ~/.aegis/

   # Start Aegis
   aegis

   # Verify
   curl -s http://localhost:9100/v1/health
   ```

4. **tmux sessions are lost** — they are local to the primary host. Claude Code sessions must be recreated.

**Warm standby with shared tmux:**

If primary and standby share the same tmux socket (via SSH or shared filesystem):

1. Aegis detects running tmux windows on startup via reconciliation
2. Sessions auto-adopt if their tmux windows still exist
3. Hook secrets (AES-256-GCM encrypted in `state.json`) decrypt correctly only with the same `AEGIS_API_TOKEN`

### Key-Material Recovery

Hook secrets are encrypted with AES-256-GCM using a key derived from the master API token. Without the original token, encrypted hook secrets in `state.json` cannot be decrypted.

**Recovery:**
1. Restore `state.json` from backup
2. Set `AEGIS_API_TOKEN` to the same value used when the backup was taken
3. Start Aegis — hook secrets will decrypt correctly

If the original token is lost:
1. Sessions with encrypted hook secrets cannot re-establish their hook callbacks
2. Kill affected sessions and recreate them with the new token

---

## RTO/RPO Targets

| Scenario | RTO | RPO | Notes |
|----------|-----|-----|-------|
| Server crash (no disk issue) | < 1 min | 0 | All state on disk, sessions in tmux |
| State corruption (backup available) | < 5 min | Last backup | Automated `state.json.bak` covers most cases |
| Disk full | < 10 min | 0 | No data loss, just write unavailability |
| Network partition | Variable | 0 | Data intact, messages during partition are lost |
| tmux crash | < 5 min | Partial | JSONL transcripts preserved; live sessions lost |
| Full disk loss (backup available) | < 30 min | Last backup | Restore from backup, recreate sessions |
| Full disk loss (no backup) | < 1 hr | All | Fresh start; audit history and keys lost |
| Audit corruption | < 15 min | Truncation point | Records after break are lost |

### Testing Procedures

**Monthly tabletop exercise:**

1. **State corruption drill:**
   ```bash
   # Simulate corruption
   cp ~/.aegis/state.json ~/.aegis/state.json.drill-backup
   echo "corrupted" > ~/.aegis/state.json
   # Attempt recovery per Scenario 2
   # Restore after drill:
   cp ~/.aegis/state.json.drill-backup ~/.aegis/state.json
   ```

2. **Server crash drill:**
   ```bash
   # Kill Aegis process
   kill $(cat ~/.aegis/aegis.pid)
   # Verify tmux sessions survive
   tmux list-windows -t aegis
   # Restart and verify reconciliation
   aegis
   ```

3. **Backup/restore drill:**
   ```bash
   # Create backup
   ./aegis-backup.sh /tmp/drill-backup
   # Verify backup contents
   ls -la /tmp/drill-backup/
   jq . /tmp/drill-backup/state.json
   ```

4. **Audit integrity drill:**
   ```bash
   curl -s -H "Authorization: Bearer $AEGIS_API_TOKEN" \
     "http://localhost:9100/v1/audit?verify=true&limit=10" -D -
   ```

---

## Emergency Escalation

| Level | Trigger | Action |
|-------|---------|--------|
| **L1 — Self-recover** | Server crash, minor corruption | Follow runbook scenarios above |
| **L2 — Restore from backup** | Data loss, unrecoverable corruption | Use backup/restore procedures |
| **L3 — Escalate to maintainer** | Audit chain broken, security incident | Open issue with label `security` or `needs-human` |

**Escalation contacts:**

- **Security issues:** Follow [SECURITY.md](../SECURITY.md) — do not file public issues
- **Recovery blockers:** Open a GitHub issue with label `needs-human` and `ops`
- **Community support:** GitHub Discussions or project Discord

---

## Runbook Checklist

### Server Crash

- [ ] Confirm tmux is running: `tmux list-sessions`
- [ ] Start Aegis: `aegis`
- [ ] Verify health: `curl http://localhost:9100/v1/health`
- [ ] Check session count matches tmux windows
- [ ] Notify users of brief interruption

### State Corruption

- [ ] Stop Aegis
- [ ] Validate `state.json` with `jq .`
- [ ] Validate `state.json.bak` with `jq .`
- [ ] Restore from backup or `.bak`
- [ ] Start Aegis
- [ ] Verify reconciliation adopted orphaned windows
- [ ] Document which sessions were lost (if any)

### Key Store Loss

- [ ] Check for manual backup of `keys.json`
- [ ] If no backup: start Aegis, generate new keys
- [ ] Update external systems referencing old key IDs
- [ ] Rotate all keys if exfiltration suspected

### Audit Corruption

- [ ] Run `?verify=true` to locate the break
- [ ] Isolate corrupted file
- [ ] Truncate at last valid record
- [ ] Restart Aegis (chain continues from truncation point)
- [ ] Document data loss (records after truncation)

### Disk Full

- [ ] Check `df -h` and `du -sh ~/.aegis/*`
- [ ] Compress old audit logs
- [ ] Truncate non-critical files (metrics, metering, memory)
- [ ] Restart Aegis
- [ ] Set up disk monitoring to prevent recurrence

### Full Disaster (Disk Loss)

- [ ] Provision new storage
- [ ] Install Aegis: `npm install -g @onestepat4time/aegis`
- [ ] Restore backup to `~/.aegis/`
- [ ] Fix permissions: `chmod 600 ~/.aegis/keys.json`
- [ ] Set `AEGIS_API_TOKEN` to original value (for hook secret decryption)
- [ ] Start Aegis
- [ ] Verify audit chain integrity
- [ ] Recreate lost sessions (tmux sessions cannot be restored from backup)
- [ ] Post-mortem: review backup frequency and RPO

---

## References

- [Incident and Rollback Runbook](./incident-rollback-runbook.md)
- [Deployment Guide](./deployment.md)
- [Security Policy](../SECURITY.md)
- [Architecture Overview](./architecture.md)
- [Verify Release](./verify-release.md)
