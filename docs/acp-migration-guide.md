# ACP Migration Guide — Aegis Major Cutover

This guide helps you upgrade from the tmux-backed Aegis to the ACP-backed Aegis
major release. Work through the sections in order: pre-migration checklist,
breaking changes, REST/MCP/SDK/dashboard migration, and post-migration
verification.

**Parent references:**

- Phase 3.5 epic:
  [`.claude/epics/phase-3-5-acp-backend-migration/epic.md`](../.claude/epics/phase-3-5-acp-backend-migration/epic.md)
- ACP cutover release plan:
  [`acp-major-cutover-release-plan.md`](acp-major-cutover-release-plan.md)
- Positioning: [ADR-0023](adr/0023-positioning-claude-code-control-plane.md)

---

## Before You Start

### Prerequisites

- Read the [ACP Major Cutover Release Plan](acp-major-cutover-release-plan.md)
  for the governance context.
- Ensure you are on the ACP major release line (check the version header in
  `CHANGELOG.md`).
- **Back up your Aegis state** before upgrading:

```bash
tar -czf aegis-backup-$(date +%Y%m%d).tar.gz \
  ~/.aegis/sessions/ \
  ~/.aegis/transcripts/ \
  ~/.aegis/config.json
```

### Drain Active Sessions

The ACP cutover removes the tmux runtime entirely. Active tmux sessions **cannot
continue** after the upgrade.

1. **List active sessions:**

```bash
curl -s http://localhost:9100/v1/sessions | python3 -c "
import json, sys
sessions = json.load(sys.stdin)
for s in sessions:
    if s.get('state') in ('running', 'awaiting_approval'):
        print(f\"  {s['id']} — {s.get('displayName', 'unnamed')} — {s['state']}\")
"
```

2. **Wait for running sessions to complete**, or cancel them:

```bash
# Graceful cancel
curl -X POST http://localhost:9100/v1/sessions/$SESSION_ID/cancel \
  -H "Authorization: Bearer $AEGIS_API_KEY"
```

3. **Verify zero active sessions:**

```bash
curl -s http://localhost:9100/v1/sessions | python3 -c "
import json, sys
sessions = json.load(sys.stdin)
active = [s for s in sessions if s.get('state') not in ('completed', 'failed', 'cancelled')]
print(f'{len(active)} active sessions remaining')
"
```

### Team and Enterprise Deployments

If you use Aegis in a team or enterprise deployment:

- **Postgres** is required as the durable source of truth after the ACP cutover.
  Verify your Postgres instance is healthy and accessible.
- **Redis** is required for realtime coordination (presence, driver locks, event
  fanout). Verify your Redis instance is healthy.
- Run the health check to confirm both stores are reachable:

```bash
curl -s http://localhost:9100/v1/health | python3 -c "
import json, sys
h = json.load(sys.stdin)
print('Backend:', h.get('backend'))
print('Postgres:', h.get('postgres', {}).get('status', 'not configured'))
print('Redis:', h.get('redis', {}).get('status', 'not configured'))
"
```

### Local Development

Local development remains Redis-free and may use file-backed or in-memory
adapters. No extra infrastructure is needed for single-user local use.

---

## Breaking Changes

The ACP cutover is a **major breaking release**. The `/v1` namespace is preserved,
but tmux-specific fields, endpoints, and semantics are removed.

### What Changed

| Area | Change |
|------|--------|
| **tmux is no longer a dependency** | Aegis no longer requires tmux or psmux. Do not install them. |
| **`windowId` / `windowName` removed** | Session responses no longer include tmux window identifiers. |
| **`windowExists` / `paneCommand` removed** | Health responses no longer include tmux window or pane status. |
| **`HealthResponse.tmux` removed** | The top-level `tmux` health section is gone. Use `backend` and `acp` instead. |
| **`GET /v1/sessions/:id/pane` removed** | Pane capture is no longer available. Use terminal debug and event replay. |
| **MCP `capture_pane` removed** | Replaced by ACP-native terminal debug and event tools. |
| **Keypress-based approvals removed** | Use explicit approval action APIs or MCP tools. |
| **`claude-agent-acp` ships with Aegis** | Installed as an npm dependency. Override with `AEGIS_ACP_BIN` if needed. |

### What Stayed the Same

| Area | Status |
|------|--------|
| **REST namespace** | Remains `/v1`. No `/v2` namespace. |
| **Auth / RBAC** | Bearer token auth, API key roles, and tenant boundaries unchanged. |
| **Session CRUD** | Create, list, get, kill — same endpoints, same shapes (minus tmux fields). |
| **SSE / WebSocket** | Event streams remain; event payloads now use ACP-normalized events. |
| **Dashboard** | Same URL, same auth — new Chat/Terminal/Timeline views. |
| **Pipelines** | Batch session creation works unchanged above the backend. |
| **Memory Bridge** | `GET/POST/DELETE /v1/memory/:key` unchanged. |

---

## REST API Migration

### Session Fields

**Before (tmux-backed):**

```json
{
  "id": "sess_abc123",
  "windowId": 3,
  "windowName": "aegis-sess_abc123",
  "state": "running",
  "model": "claude-sonnet-4-20250514"
}
```

**After (ACP-backed):**

```json
{
  "id": "sess_abc123",
  "displayName": "My coding session",
  "backend": "acp",
  "state": "running",
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "driver": "key_prod_abc",
  "paused": false,
  "transcriptId": "tr_def456"
}
```

**Migration steps:**

1. Remove any code that reads `windowId` or `windowName`.
2. Use `id` as the primary session identifier (unchanged).
3. Use `displayName` for human-readable session names.
4. Use `backend` to confirm the session is ACP-backed.
5. Use `transcriptId` for transcript/replay references.

### Health Endpoint

**Before:**

```json
{
  "status": "ok",
  "version": "0.6.6",
  "tmux": { "status": "ok", "socket": "aegis", "sessions": 2 }
}
```

**After:**

```json
{
  "status": "ok",
  "version": "1.0.0",
  "backend": "acp",
  "acp": { "status": "ok", "childProcesses": 2 },
  "postgres": { "status": "ok", "latencyMs": 3 },
  "redis": { "status": "ok", "latencyMs": 1 }
}
```

**Migration steps:**

1. Remove any health checks that read `tmux.*` fields.
2. Check `backend` for the active backend type.
3. Monitor `acp`, `postgres`, and `redis` sections for component health.

### Removed Endpoints

| Endpoint | Replacement |
|----------|-------------|
| `GET /v1/sessions/:id/pane` | Terminal debug endpoint (new in ACP release) |
| Any tmux-specific bash/command-discovery flows | ACP tool/result event model |

### New Endpoints

These endpoints are introduced in the ACP major release:

| Endpoint | Purpose |
|----------|---------|
| Event replay endpoint | Retrieve session events by sequence range |
| Action endpoints | Prompt, approve, reject, pause, resume, cancel, driver control |
| Terminal debug endpoint | Retrieve terminal output for debugging |

Refer to the [API Reference](api-reference.md) for full request/response shapes.

---

## MCP Tools Migration

### Removed Tools

| Tool | Reason |
|------|--------|
| `capture_pane` | tmux pane capture is no longer possible |

### Updated Tools

Existing MCP tools remain available if their semantics are backend-neutral after
the contract changes. Check the [MCP Tools Reference](mcp-tools.md) for updated
descriptions.

### New ACP-Native Tools

The ACP release introduces MCP tools aligned with the control-plane domain model:

- **Session creation and prompt submission**
- **Event subscription and replay**
- **Chat retrieval**
- **Approval response** (explicit approve/reject actions)
- **Driver claim, release, transfer, and revocation**
- **Pause, resume, and cancel**
- **Timeline retrieval**
- **Terminal debug retrieval**

Tool names and descriptions avoid agent-framework language. They describe Aegis
as the control-plane bridge to Claude Code.

**Example — approving a tool call (before and after):**

```text
# Before (keypress-based, implicit):
# Sent raw keypresses through tmux send-keys — no structured API.

# After (explicit approval action):
# MCP tool: approve
# Parameters: { "sessionId": "sess_abc123", "actionId": "act_def456", "decision": "approve" }
```

---

## SDK Migration

### TypeScript SDK

Regenerate or upgrade your TypeScript SDK from the ACP major release line:

```bash
npm install @anthropic-ai/aegis-client@^1.0.0
```

**Removed types:**

```typescript
// These types no longer exist:
// SessionInfo.windowId
// SessionInfo.windowName
// SessionHealth.windowExists
// SessionHealth.paneCommand
// HealthResponse.tmux
```

**Updated types:**

```typescript
// New fields on SessionInfo:
interface SessionInfo {
  id: string;
  displayName?: string;
  backend: "acp";
  state: SessionState;
  model?: string;
  provider?: string;
  driver?: string;
  paused: boolean;
  transcriptId?: string;
  // windowId and windowName are REMOVED
}
```

### Python SDK

```bash
pip install aegis-client>=1.0.0
```

Same type changes as TypeScript. Remove any code that accesses `window_id`,
`window_name`, `window_exists`, or `pane_command`.

### Migration Checklist for SDK Users

- [ ] Update SDK package to the ACP major release line.
- [ ] Remove references to `windowId` / `windowName` / `window_id` / `window_name`.
- [ ] Replace pane capture calls with event replay or terminal debug.
- [ ] Replace keypress-style approval flows with explicit approval action APIs.
- [ ] Update health check logic to read `backend`, `acp`, `postgres`, `redis`.
- [ ] Update type definitions in your codebase.

---

## Dashboard Migration

The dashboard undergoes a significant UX shift in the ACP release:

| View | Before (tmux) | After (ACP) |
|------|---------------|-------------|
| **Primary view** | Terminal pane mirror | Chat (conversation view) |
| **Terminal** | Main product surface | Debug view — for diagnostics only |
| **Timeline** | Not available | Operator/audit view — driver changes, prompts, approvals, pause/resume |

### What Changes for Dashboard Users

1. **Chat is the default view.** When you open a session, you see the
   conversation — messages, tool calls, thinking blocks — in a structured view.
2. **Terminal is a debug tab.** Use it to inspect raw output, troubleshoot
   issues, or verify behavior. It is not the primary interaction surface.
3. **Timeline is the audit view.** It shows the full operator history: who sent
   prompts, who approved tools, when the session was paused, driver transfers,
   and health events.

### What Stays the Same

- Dashboard URL and authentication (OIDC/SSO or bearer token).
- Session list, creation, and deletion.
- API key management.

---

## Operator Migration

### Remove tmux/psmux Dependencies

After upgrading, remove tmux and psmux from your infrastructure:

```bash
# No longer needed:
# apt-get install tmux
# npm install -g psmux
```

### Update Operational Scripts

Search your scripts and automation for tmux references:

```bash
# Find tmux references in your ops tooling:
grep -rn 'tmux\|windowId\|windowName\|paneCommand\|capture.pane\|send.keys' \
  /path/to/your/ops/scripts/
```

**Common replacements:**

| Old pattern | New approach |
|-------------|-------------|
| `tmux -L aegis attach -t <window>` | Use dashboard Chat view or event replay API |
| `GET /v1/sessions/:id/pane` | Terminal debug endpoint |
| Reading `windowId` for identification | Use session `id` and `displayName` |
| Sending keypresses for approval | Explicit approval action API |
| Checking `HealthResponse.tmux` | Check `HealthResponse.acp` and `HealthResponse.backend` |

### Update Deployment Configuration

**Docker Compose — before:**

```yaml
services:
  aegis:
    image: ghcr.io/onestepat4time/aegis:latest
    environment:
      - AEGIS_TMUX_SOCKET=aegis
```

**Docker Compose — after:**

```yaml
services:
  aegis:
    image: ghcr.io/onestepat4time/aegis:1.0.0
    environment:
      - AEGIS_DATABASE_URL=postgres://user:pass@postgres:5432/aegis
      - AEGIS_REDIS_URL=redis://redis:6379
  postgres:
    image: postgres:17
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
volumes:
  pgdata:
  redisdata:
```

### Run Health Checks After Upgrade

```bash
# Full health check
curl -s http://localhost:9100/v1/health | python3 -m json.tool

# Verify backend is ACP
curl -s http://localhost:9100/v1/health | python3 -c "
import json, sys
h = json.load(sys.stdin)
assert h.get('backend') == 'acp', f'Expected acp, got {h.get(\"backend\")}'
print('✓ Backend is ACP')
"

# Verify Postgres (team/enterprise)
curl -s http://localhost:9100/v1/health | python3 -c "
import json, sys
h = json.load(sys.stdin)
pg = h.get('postgres', {})
assert pg.get('status') == 'ok', f'Postgres not ok: {pg}'
print('✓ Postgres healthy')
"

# Verify Redis (team/enterprise)
curl -s http://localhost:9100/v1/health | python3 -c "
import json, sys
h = json.load(sys.stdin)
rd = h.get('redis', {})
assert rd.get('status') == 'ok', f'Redis not ok: {rd}'
print('✓ Redis healthy')
"

# Run doctor (if available)
npx ag doctor
```

### RBAC Verification

ACP introduces driver/observer control-plane semantics. Verify your RBAC roles:

```bash
# Check which permissions your API key has
curl -s http://localhost:9100/v1/keys/$KEY_ID \
  -H "Authorization: Bearer $ADMIN_KEY" | python3 -c "
import json, sys
key = json.load(sys.stdin)
print('Key:', key.get('id'))
print('Roles:', key.get('roles'))
print('Permissions:', key.get('permissions', []))
"
```

Ensure keys that need to send prompts have `send`, keys that approve tools have
`approve`, and keys that manage sessions have `kill`.

---

## Troubleshooting

### "tmux not found" after upgrade

This is expected. The ACP release does not require tmux. If your scripts or
monitoring check for tmux, update them to check the ACP backend instead.

### "Postgres connection refused"

Team/enterprise deployments require Postgres. Verify your `AEGIS_DATABASE_URL`
is set and the Postgres instance is reachable.

### "Redis connection refused"

Team/enterprise deployments require Redis for realtime coordination. Verify your
`AEGIS_REDIS_URL` is set and the Redis instance is reachable. Local development
does not require Redis.

### "Unknown field: windowId"

You are using code or an SDK that references removed tmux fields. Update your
SDK package and remove references to `windowId`, `windowName`, `windowExists`,
and `paneCommand`.

### Dashboard shows empty sessions

After the ACP cutover, the dashboard uses ACP-native event streams. Ensure your
browser cache is cleared. If sessions created before the upgrade appear empty,
they were tmux-backed and their raw terminal data is no longer accessible.
Historical transcript files (JSONL) remain in `~/.aegis/transcripts/`.

---

## Quick Reference

### Before → After Cheat Sheet

| Before (tmux) | After (ACP) |
|----------------|-------------|
| `session.windowId` | `session.id` + `session.displayName` |
| `session.windowName` | `session.displayName` |
| `health.tmux.status` | `health.backend` + `health.acp.status` |
| `GET /sessions/:id/pane` | Terminal debug endpoint |
| MCP `capture_pane` | Terminal debug tool |
| Keypress approval | Explicit approval action API |
| `tmux -L aegis attach` | Dashboard Chat view |
| `AEGIS_TMUX_SOCKET` | Removed (no-op if set) |
| tmux/psmux installed | `claude-agent-acp` (npm dependency) |

### Environment Variables

| Variable | Status | Notes |
|----------|--------|-------|
| `AEGIS_DATABASE_URL` | Required (team/enterprise) | Postgres connection string |
| `AEGIS_REDIS_URL` | Required (team/enterprise) | Redis connection string |
| `AEGIS_ACP_BIN` | Optional | Override path to `claude-agent-acp` binary |
| `AEGIS_TMUX_SOCKET` | Removed | Ignored if set |
