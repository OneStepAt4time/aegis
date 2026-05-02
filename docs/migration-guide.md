# Aegis v0.5.x → v0.6.x Migration Guide

This guide covers everything you need to know when upgrading from Aegis v0.5.x to v0.6.x. Work through the sections in order — "Breaking Changes" first, then new features, then the upgrade steps.

---

## Before You Start

**Backup your data:**

```bash
tar -czf aegis-backup-$(date +%Y%m%d).tar.gz \
  ~/.aegis/sessions/ \
  ~/.aegis/transcripts/ \
  ~/.aegis/config.json
```

**Check your current version:**

```bash
curl http://localhost:9100/v1/health | python3 -c "import json,sys; print('version:', json.load(sys.stdin).get('version'))"
```

---

## Breaking Changes

### 1. tmux Socket Name Changed

**Before (v0.5.x):** Aegis used the default tmux socket with no explicit name.

**After (v0.6.x):** Aegis uses a named socket `aegis` by default. If you start tmux manually or connect to a session externally, use:

```bash
tmux -L aegis list-sessions
tmux -L aegis attach -t session-name
```

**If you run tmux yourself** (outside Aegis), set the socket name explicitly:

```bash
AEGIS_TMUX_SOCKET=default npm run start
```

Or in your environment:

```bash
export AEGIS_TMUX_SOCKET=default
```

**Kubernetes / Docker users:** No action needed — the socket is handled inside the container.

---

### 2. Session Data Directory Structure

**Before (v0.5.x):** Sessions and transcripts stored directly in `~/.aegis/`.

**After (v0.6.x):** Session data is organized under `AEGIS_STATE_DIR` (default `~/.aegis`):

```
~/.aegis/
├── sessions/          # Session metadata
├── transcripts/       # JSONL conversation logs
├── config.json        # API keys and settings
└── audit.log          # Audit trail
```

**Upgrade step:** No data migration needed — v0.6.x reads existing data automatically.

---

### 3. API Auth — Bearer Token Format

**Before (v0.5.x):** Any bearer token accepted for any endpoint.

**After (v0.6.x):** Role-based access control (RBAC). API keys have roles:

| Role | Access |
|------|--------|
| `admin` | Full access including key management |
| `operator` | Create, send, approve, reject, kill sessions |
| `viewer` | Read-only access to sessions and metrics |

If your integrations broke after upgrade, check the API key role:

```bash
curl http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

---

### 4. Webhook Secret Transport

**Before (v0.5.x):** Hook secrets could be passed via query parameter.

**After (v0.6.x):** To enforce header-only secret transport (more secure):

```bash
export AEGIS_HOOK_SECRET_HEADER_ONLY=true
```

With this enabled, hooks must use the `X-Hook-Secret` header:

```bash
curl -X POST "http://localhost:9100/v1/hooks/Stop" \
  -H "X-Hook-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "abc123"}'
```

Query-param secrets are rejected when this flag is set.

---

## Environment Variable Changes

| Old / Removed | New / Changed | Notes |
|---------------|---------------|-------|
| (none) | `AEGIS_STATE_DIR` | Default `~/.aegis`. Session state, audit logs, runtime metadata |
| (none) | `AEGIS_TMUX_SOCKET` | Default `aegis`. tmux socket name |
| (none) | `AEGIS_SESSION_TTL_MS` | Default `3600000` (1h). Session auto-cleanup after inactivity |
| (none) | `AEGIS_MAX_SESSIONS` | Default `50`. Hard cap on concurrent sessions |
| (none) | `AEGIS_HOOK_SECRET_HEADER_ONLY` | Default `false`. Set `true` to enforce header-only secrets |
| `AEGIS_SSE_IDLE_MS` | (new) | SSE heartbeat interval (default: 120000ms) |
| `AEGIS_SSE_CLIENT_TIMEOUT_MS` | (new) | SSE client idle timeout (default: 300000ms) |
| `AEGIS_HOOK_TIMEOUT_MS` | (new) | Webhook/hook fetch timeout (default: 10000ms) |
| `AEGIS_SHUTDOWN_GRACE_MS` | (new) | Grace period for graceful shutdown (default: 15000ms) |
| `AEGIS_SHUTDOWN_HARD_MS` | (new) | Hard cap for shutdown sequence (default: 20000ms) |
| `AEGIS_DASHBOARD_URL` | (new) | Dashboard URL (default: `http://localhost:9100/dashboard`) |

---

## New Features

### API Key Rotation with Grace Period

Rotate API keys without downtime. The old key stays valid during the grace period.

```bash
# Rotate with 24h grace period
curl -X POST http://localhost:9100/v1/auth/keys/key-abc123/rotate \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlDays": 365}'
```

Response includes the new key — **save it immediately**, it's shown only once.

---

### Per-Key Rate Limiting

Every API response now includes rate limit headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1713782400
```

When exceeded, the server returns `429 Too Many Requests`:

```json
{"error": "Rate limit exceeded. Retry after 12 seconds."}
```

---

### Audit Log Export

Export audit logs in CSV or NDJSON for compliance and analysis:

```bash
# CSV export
curl "http://localhost:9100/v1/audit?from=2026-04-01T00:00:00Z&format=csv" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  > audit-2026-04.csv

# NDJSON for streaming to log processors
curl "http://localhost:9100/v1/audit?format=ndjson" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  | jq '.action' | sort | uniq -c
```

Admin role required.

---

### Session Templates

Save and reuse session configurations:

```bash
# Create a template
curl -X POST http://localhost:9100/v1/templates \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-review",
    "prompt": "Review {{repo}} for bugs",
    "workDir": "/home/user/repos/{{repo}}",
    "permissionMode": "bypassPermissions"
  }'

# List templates
curl http://localhost:9100/v1/templates \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Template prompts support `{{variable}}` substitution when creating sessions.

---

### Per-Session Latency Metrics

```bash
curl http://localhost:9100/v1/sessions/abc123/latency \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Response:

```json
{"p50": 120, "p95": 450, "p99": 890}
```

Latency is measured in milliseconds for hook, state change, permission response, and channel delivery operations.

---

### Claude Code Version Validation

Sessions now fail fast with a clear error if the Claude CLI is too old:

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/home/user/project"}'
```

If Claude Code is too old:

```json
{"error": "Claude Code version 1.0.0 is too old. Minimum required: 1.2.0", "code": "CLAUDE_TOO_OLD"}
```

Upgrade Claude Code: `claude --upgrade` or reinstall from https://docs.anthropic.com/en/docs/claude-code

---

### Permission Hooks

Internal callbacks triggered by Claude Code lifecycle events:

```bash
# Permission prompt
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Allow lsof?", "expectedAllow": true}'

# Session stopped
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/stop \
  -H "Content-Type: application/json" \
  -d '{"reason": "user_interrupt"}'
```

---

### ag CLI Init Command

The new `ag init` command replaces manual setup:

```bash
ag init --name "my-session" --workDir /home/user/project
```

For interactive init:

```bash
ag init --interactive
```

The old manual setup (copying scripts, environment variables) still works but `ag init` is recommended.

---

### Config Hot Reload

Most configuration changes take effect without restarting the server:

```bash
# Edit ~/.aegis/config.json
# Aegis detects the change and reloads automatically
```

Changes to `AEGIS_AUTH_TOKEN` still require a server restart.

---

## Docker Changes

### New Dockerfile Features

The v0.6.x Dockerfile includes:

- **Multi-stage build** — smaller production image
- **Non-root user** — runs as `aegis` user, not root
- **Health check** — `HEALTHCHECK` instruction for container orchestrators
- **tmux included** — no separate installation needed

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y tmux ca-certificates curl
RUN groupadd -r aegis && useradd -r -g aegis aegis
USER aegis
HEALTHCHECK --interval=30s CMD curl -f http://localhost:9100/v1/health
ENTRYPOINT ["node", "dist/server.js"]
```

### Docker Compose Template

```yaml
services:
  aegis:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:9100:9100"
    volumes:
      - aegis-data:/home/aegis/.aegis
    environment:
      - AEGIS_AUTH_TOKEN=${AEGIS_AUTH_TOKEN}
      - AEGIS_TMUX_SOCKET=aegis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9100/v1/health"]

volumes:
  aegis-data:
```

---

## API Changes Summary

### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/auth/keys/{id}/rotate` | Rotate API key with optional grace period |
| `GET` | `/v1/sessions/{id}/latency` | Per-session latency percentiles (p50/p95/p99) |
| `GET` | `/v1/sessions/health` | Bulk health check for all visible sessions |
| `GET` | `/v1/audit?format=csv` | Audit log CSV export |
| `GET` | `/v1/audit?format=ndjson` | Audit log NDJSON streaming export |
| `POST` | `/v1/templates` | Create session template |
| `GET` | `/v1/templates/{id}` | Get template by ID |
| `PUT` | `/v1/templates/{id}` | Update template |
| `DELETE` | `/v1/templates/{id}` | Delete template |
| `POST` | `/v1/sessions/{id}/hooks/permission` | Permission hook callback |
| `POST` | `/v1/sessions/{id}/hooks/stop` | Session stop hook callback |

### Changed Responses

All API responses now include rate limit headers. Permission-denied responses return `403 Forbidden` (previously sometimes returned `401`).

---

## Dashboard Changes

The v0.6.x dashboard adds:

- **Metrics page** — aggregated session, token, and cost metrics with summary stat cards
- **Audit log page** — search and filter audit entries with CSV export
- **Session templates UI** — create, edit, and launch sessions from templates
- **Real-time SSE updates** — overview page auto-refreshes without page reload
- **Dark mode** — system-aware theme with manual toggle

---

## Recommended Upgrade Steps

### Step 1 — Backup

```bash
tar -czf aegis-backup-$(date +%Y%m%d).tar.gz ~/.aegis/
```

### Step 2 — Stop the Server

```bash
# If running via systemd
sudo systemctl stop aegis

# If running directly
# Ctrl+C the server process
```

### Step 3 — Update Aegis

```bash
npm install -g @anthropic-ai/aegis
# Or pull the latest Docker image
docker pull aegis:latest
```

### Step 4 — Check tmux

If you run tmux separately from Aegis, either:

**Option A:** Let Aegis manage tmux (recommended):

```bash
unset TMUX_SOCKET
export AEGIS_TMUX_SOCKET=aegis
aegis start
```

**Option B:** Use the default socket:

```bash
export AEGIS_TMUX_SOCKET=default
aegis start
```

### Step 5 — Update Environment Variables

Add any new variables you need:

```bash
# Required for new webhook security
export AEGIS_HOOK_SECRET_HEADER_ONLY=true
```

### Step 6 — Restart and Verify

```bash
# Start Aegis
aegis start

# Verify health
curl http://localhost:9100/v1/health

# Check for version
# Should show 0.6.x
```

### Step 7 — Update API Scripts

If you use API keys with specific roles, verify your integration's key has the right role:

```bash
curl http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

If your script only reads data and stopped working, the key likely needs `viewer` role added or elevated.

### Step 8 — Verify Webhooks

If you use webhooks, test with header-based secrets:

```bash
curl -X POST "http://localhost:9100/v1/hooks/Test" \
  -H "X-Hook-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Rollback

If issues occur, rollback to v0.5.x:

```bash
# npm
npm install -g @anthropic-ai/aegis@0.5.3

# Docker
docker run aegis:0.5.3 ...

# Restore backup
tar -xzf aegis-backup-YYYYMMDD.tar.gz -C ~/
```

v0.6.x is backwards-compatible with v0.5.x session data. Rolling back after writing new data may lose recent audit entries but session metadata is preserved.

---

## Getting Help

- **Issues:** https://github.com/OneStepAt4time/aegis/issues
- **Discord:** https://discord.gg/clawd
- **Docs:** https://docs.openclaw.ai
