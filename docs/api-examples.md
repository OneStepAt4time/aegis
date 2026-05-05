# API Examples

Concrete `curl` examples for every Aegis API endpoint. For full schema documentation, see [API Reference](api-reference.md).

**Base URL:** `http://localhost:9100`  
**Auth:** `Authorization: Bearer $AEGIS_AUTH_TOKEN` (required unless noted)

---

## Authentication

### Verify token

```bash
curl -X POST http://localhost:9100/v1/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "'$AEGIS_AUTH_TOKEN'"}'
```

**Response `200`:**
```json
{"ok": true, "role": "admin", "expiresAt": null}
```

**Response `401`** — invalid token:
```json
{"error": "Invalid token"}
```

**Response `429`** — rate limited:
```json
{"error": "Too many requests"}
```

---

### Create API key

```bash
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-bot", "role": "operator"}'
```

Roles: `admin`, `operator`, `viewer`

**Response `201`:**
```json
{
  "id": "key-abc123",
  "name": "ci-bot",
  "key": "aegis_ko_live_abc123...",
  "role": "operator",
  "createdAt": "2026-04-22T10:00:00.000Z"
}
```

**Response `403`** — forbidden (non-admin):
```json
{"error": "Forbidden"}
```

> **Save the `key` field** — it is only shown once on creation.

---

### List API keys

```bash
curl http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
[
  {"id": "key-abc123", "name": "ci-bot", "role": "operator", "createdAt": "2026-04-22T10:00:00.000Z"},
  {"id": "key-def456", "name": "dashboard", "role": "viewer", "createdAt": "2026-04-20T08:00:00.000Z"}
]
```

---

### Revoke API key

```bash
curl -X DELETE http://localhost:9100/v1/auth/keys/key-abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

**Response `404`** — key not found:
```json
{"error": "Not found"}
```

---

### Rotate API key

```bash
curl -X POST http://localhost:9100/v1/auth/keys/key-abc123/rotate \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlDays": 90}'
```

**Request body (optional):**
- `ttlDays` — key expiry in days (admin only, default: unlimited)

**Response `200`:**
```json
{
  "id": "key-abc123",
  "name": "ci-bot",
  "key": "aegis_ko_live_xyz789...",
  "role": "operator",
  "createdAt": "2026-04-22T12:00:00.000Z"
}
```

---

### Generate SSE token

```bash
curl -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `201`:**
```json
{"token": "sse_tok_abc123...", "expiresAt": "2026-04-22T13:00:00.000Z"}
```

**Response `429`** — SSE token limit reached:
```json
{"error": "SSE token limit reached"}
```

---

## Sessions

### List active sessions

```bash
curl "http://localhost:9100/v1/sessions?page=1&limit=20&status=active" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Query parameters:**
- `page` — page number (default: 1)
- `limit` — items per page (default: 20, max: 100)
- `status` — filter by status: `active`, `idle`, `stalled`, `dead`
- `project` — filter by workDir substring

**Response `200`:**
```json
{
  "items": [
    {
      "id": "abc123",
      "status": "active",
      "workDir": "/home/user/project",
      "createdAt": "2026-04-22T09:00:00.000Z",
      "lastActivity": "2026-04-22T10:30:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

### Create session

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/home/user/project",
    "prompt": "Fix the authentication bug in src/auth.ts",
    "permissionMode": "bypassPermissions"
  }'
```

**Request body:**
- `workDir` — working directory (required)
- `prompt` — initial user message
- `permissionMode` — `default | bypassPermissions | plan | acceptEdits | dontAsk | auto`
- `autoApprove` — skip permission prompts
- `stallThresholdMs` — stall timeout 1–3600000ms
- `env` — environment variables map

**Response `201`** (new session):
```json
{"id": "abc123", "status": "active", "windowId": "@1"}
```

**Response `200`** (reused existing idle session):
```json
{"id": "abc123", "status": "active", "windowId": "@1", "reused": true}
```

**Response `422`** — Claude Code version too old:
```json
{"error": "Claude Code version 1.0.0 is too old. Minimum required: 1.2.0", "code": "CLAUDE_TOO_OLD"}
```

---

### Session history

```bash
curl "http://localhost:9100/v1/sessions/history?page=1&limit=20&status=active" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Same query parameters as List sessions. Returns created + killed sessions.

---

### Session statistics

```bash
curl http://localhost:9100/v1/sessions/stats \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{
  "active": 3,
  "byStatus": {"active": 2, "idle": 1},
  "totals": {"created": 47, "killed": 44}
}
```

---

### Bulk health check

```bash
curl http://localhost:9100/v1/sessions/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns health status for all visible sessions. Admin sees all; operator/viewer sees owned sessions.

**Response `200`:**
```json
[
  {"id": "abc123", "status": "active", "healthy": true, "stalled": false},
  {"id": "def456", "status": "stalled", "healthy": false, "stalled": true}
]
```

---

### Bulk delete sessions

```bash
curl -X DELETE http://localhost:9100/v1/sessions/batch \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["abc123", "def456"]}'
```

**Request body — at least one of:**
- `ids` — array of session UUIDs
- `status` — kill all sessions with this status

**Response `200`:**
```json
{"deleted": 2}
```

---

### Get session

```bash
curl http://localhost:9100/v1/sessions/abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{
  "id": "abc123",
  "status": "active",
  "workDir": "/home/user/project",
  "windowId": "@1",
  "permissionMode": "bypassPermissions",
  "actionHint": null,
  "createdAt": "2026-04-22T09:00:00.000Z",
  "lastActivity": "2026-04-22T10:30:00.000Z"
}
```

**Response `403`** — not owner:
```json
{"error": "Forbidden"}
```

---

### Session health check

```bash
curl http://localhost:9100/v1/sessions/abc123/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"status": "active", "healthy": true, "stalled": false, "lastActivity": "2026-04-22T10:30:00.000Z"}
```

---

## Session Actions

### Send message

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/send \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me the current git status"}'
```

**Response `200`:**
```json
{"ok": true, "stalled": false}
```

**Response `400`** — stalled session:
```json
{"ok": false, "stalled": true, "message": "Session is stalled"}
```

---

### Send slash command

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/command \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "/clear"}'
```

Sends a slash command. Prefix with `/` if not provided.

**Response `200`:**
```json
{"ok": true}
```

---

### Execute bash command

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/bash \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la", "waitMs": 5000}'
```

**Request body:**
- `command` **(required)** — bash command to execute
- `waitMs` — milliseconds to wait for output (default: 5000, max: 60000)

**Response `200`:**
```json
{"ok": true, "output": "total 24\ndrwxr-xr-x 5 user user 4096 Apr 22 09:00 .\n"}
```

**Response `400`** — validation error:
```json
{"error": "Validation failed", "details": [...]}
```

---

### Send Escape key

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/escape \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Use to cancel multi-step operations or exit edit mode.

**Response `200`:**
```json
{"ok": true}
```

---

### Send Ctrl+C (interrupt)

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/interrupt \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

---

### Kill session

```bash
curl -X DELETE http://localhost:9100/v1/sessions/abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

---

### Capture raw pane

```bash
curl http://localhost:9100/v1/sessions/abc123/pane \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"pane": "user@host:~/project $ claude\n"}
```

---

### Get child sessions

```bash
curl http://localhost:9100/v1/sessions/abc123/children \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"children": [{"id": "def456", "status": "active", "workDir": "/home/user/project/subdir"}]}
```

---

### Spawn child session

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/spawn \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/home/user/project/subdir", "prompt": "Run tests"}'
```

**Response `201`:**
```json
{"id": "def456", "status": "active", "workDir": "/home/user/project/subdir"}
```

---

### Fork session

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/fork \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/home/user/project", "prompt": "Refactor the API layer"}'
```

**Response `201`:**
```json
{"id": "ghi789", "status": "active", "workDir": "/home/user/project"}
```

---

### Approve permission request

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/approve \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Approves the currently pending permission prompt in the session.

**Response `200`:**
```json
{"ok": true}
```

---

### Reject permission request

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/reject \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

---

### Answer pending question

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/answer \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "q1", "answer": "yes"}'
```

**Request body:**
- `questionId` **(required)** — ID of the pending question
- `answer` **(required)** — answer text

**Response `200`:**
```json
{"ok": true}
```

**Response `409`** — no matching pending question:
```json
{"error": "No pending question matching questionId: q1"}
```

---

## Session Data

### Read session messages

```bash
curl http://localhost:9100/v1/sessions/abc123/read \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns recent messages from the session.

**Response `200`:**
```json
{"messages": [...]}
```

---

### Paginated transcript

```bash
curl "http://localhost:9100/v1/sessions/abc123/transcript?page=1&limit=50&role=user" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Query parameters:**
- `page` — page number (default: 1)
- `limit` — entries per page (default: 50, max: 200)
- `role` — filter: `user`, `assistant`, or `system`

**Response `200`:**
```json
{"items": [...], "total": 120, "page": 1}
```

---

### Cursor-based transcript replay

```bash
curl "http://localhost:9100/v1/sessions/abc123/transcript/cursor?limit=50&role=assistant" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Query parameters:**
- `limit` — max entries (default: 50, max: 200)
- `before_id` — cursor for previous page (entry ID)
- `role` — filter: `user`, `assistant`, or `system`

**Response `200`:**
```json
{"items": [...], "hasMore": true, "nextCursor": "msg-abc123"}
```

---

### Session summary

```bash
curl http://localhost:9100/v1/sessions/abc123/summary \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns an AI-generated summary of the session.

**Response `200`:**
```json
{"summary": "Fixed authentication bug in src/auth.ts by adding proper token validation."}
```

---

### Per-session metrics

```bash
curl http://localhost:9100/v1/sessions/abc123/metrics \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"messages": 24, "tokens": 12000, "durationMs": 180000}
```

---

### Per-session latency

```bash
curl http://localhost:9100/v1/sessions/abc123/latency \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"p50": 120, "p95": 450, "p99": 890}
```

---

### Per-session tool usage

```bash
curl http://localhost:9100/v1/sessions/abc123/tools \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"Read": 5, "Write": 2, "Bash": 12, "WebFetch": 3}
```

---

### Capture screenshot

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/screenshot \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"format": "png"}'
```

**Request body:**
- `format` — `png` or `jpeg` (default: `png`)

**Response `200`:**
```json
{"url": "data:image/png;base64,..."}
```

**Response `501`** — Playwright not installed:
```json
{"error": "Screenshot requires Playwright"}
```

---

### Run verification protocol

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/verify \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true, "verified": true}
```

**Response `422`** — verification failed:
```json
{"error": "Verification failed: unexpected state"}
```

---

### Per-session SSE event stream

```bash
curl -N http://localhost:9100/v1/sessions/abc123/events \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Long-lived SSE stream of events for this session. Use `curl -N` to disable buffering.

**SSE format:**
```
event: message
data: {"role":"assistant","content":"Hello"}

event: permission
data: {"prompt":"Allow ls?","mode":"default"}
```

---

## Permissions

### Get permission policy

```bash
curl http://localhost:9100/v1/sessions/abc123/permissions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"rules": [{"path": "/api/*", "allow": true}]}
```

---

### Set permission policy

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permissions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"path": "/api/*", "allow": true}, {"path": "/admin/*", "allow": false}]'
```

**Response `200`:**
```json
{"rules": [...]}
```

---

### Get permission profile

```bash
curl http://localhost:9100/v1/sessions/abc123/permission-profile \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"profile": "restricted"}
```

---

### Set permission profile

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permission-profile \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"profile": "restricted"}'
```

Profiles: `default`, `restricted`, `minimal`

---

## Hooks

### Permission hook callback

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Allow lsof to check open files?",
    "expectedAllow": true
  }'
```

Called internally by Claude Code when a permission prompt occurs.

**Response `200`:**
```json
{"ok": true}
```

---

### Stop hook callback

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/stop \
  -H "Content-Type: application/json" \
  -d '{"reason": "user_interrupt"}'
```

Called internally when a session stops.

**Response `200`:**
```json
{"ok": true}
```

---

### Generic hook callback

```bash
curl -X POST "http://localhost:9100/v1/hooks/Stop?sessionId=abc123" \
  -H "Content-Type: application/json" \
  -H "X-Hook-Secret: your-hook-secret" \
  -d '{"sessionId": "abc123", "reason": "completed"}'
```

Claude Code hook event endpoint. Set `AEGIS_HOOK_SECRET_HEADER_ONLY=true` to enforce header-only secrets.

**Response `200`:**
```json
{"ok": true}
```

**Response `400`** — validation error:
```json
{"error": "Validation failed", "details": [...]}
```

---

## Memory Bridge

### Write memory entry

```bash
curl -X POST http://localhost:9100/v1/memory \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "project-context", "value": "Using Fastify v5", "ttlMs": 3600000}'
```

**Request body:**
- `key` **(required)** — memory key (string)
- `value` **(required)** — memory value
- `ttlMs` — time-to-live in milliseconds (optional)

**Response `200`:**
```json
{"ok": true}
```

**Response `413`** — value too large:
```json
{"error": "Value exceeds maximum size"}
```

---

### List memory entries

```bash
# All entries
curl http://localhost:9100/v1/memory \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Filter by prefix
curl "http://localhost:9100/v1/memory?prefix=project-" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
[
  {"key": "project-context", "value": "Using Fastify v5", "ttlMs": 3600000},
  {"key": "project-version", "value": "2.1.0", "ttlMs": null}
]
```

---

### Get memory entry

```bash
curl http://localhost:9100/v1/memory/project-context \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"key": "project-context", "value": "Using Fastify v5", "ttlMs": 3600000}
```

**Response `404`** — key not found:
```json
{"error": "Not found"}
```

---

### Delete memory entry

```bash
curl -X DELETE http://localhost:9100/v1/memory/project-context \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

---

### Write session-scoped memory

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/memories \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "task-status", "value": "in-progress"}'
```

Memory entries scoped to a specific session.

**Response `200`:**
```json
{"ok": true}
```

---

### List session memories

```bash
curl http://localhost:9100/v1/sessions/abc123/memories \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
[{"key": "task-status", "value": "in-progress"}]
```

---

## Templates

### Create template

```bash
curl -X POST http://localhost:9100/v1/templates \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-review",
    "description": "Standard code review session",
    "prompt": "Review {{repo}} for bugs and style issues",
    "workDir": "/home/user/repos/{{repo}}",
    "permissionMode": "bypassPermissions"
  }'
```

**Request body:**
- `name` **(required)** — template name (max 100 chars)
- `description` — description (max 500 chars)
- `sessionId` — base session UUID to copy settings from
- `workDir` — default working directory
- `prompt` — template prompt with `{{variable}}` substitution (max 100k chars)
- `claudeCommand` — Claude Code CLI arguments
- `env` — environment variables map
- `stallThresholdMs` — stall timeout 1–3600000ms
- `permissionMode` — `default | bypassPermissions | plan | acceptEdits | dontAsk | auto`
- `autoApprove` — skip permission prompts

**Response `201`:**
```json
{"id": "tpl-abc123", "name": "code-review", ...}
```

---

### List templates

```bash
curl http://localhost:9100/v1/templates \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
[{"id": "tpl-abc123", "name": "code-review", ...}]
```

---

### Get template

```bash
curl http://localhost:9100/v1/templates/tpl-abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"id": "tpl-abc123", "name": "code-review", "prompt": "Review {{repo}}...", "permissionMode": "bypassPermissions"}
```

---

### Update template

```bash
curl -X PUT http://localhost:9100/v1/templates/tpl-abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description", "prompt": "New prompt"}'
```

Partially updates a template. Only include fields to change.

**Response `200`:**
```json
{"id": "tpl-abc123", "name": "code-review", "description": "Updated description", ...}
```

---

### Delete template

```bash
curl -X DELETE http://localhost:9100/v1/templates/tpl-abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

---

## Pipelines

### Batch create sessions

```bash
curl -X POST http://localhost:9100/v1/sessions/batch \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {"workDir": "/home/user/repo-a", "prompt": "Review PR #1"},
      {"workDir": "/home/user/repo-b", "prompt": "Review PR #2"}
    ]
  }'
```

Create up to 50 sessions in a single request.

**Request body:**
- `sessions` **(required)** — array of session creation objects

**Response `201`:**
```json
{"sessions": [{"id": "abc123", "status": "active"}, {"id": "def456", "status": "active"}]}
```

**Response `429`** — rate limit or session cap exceeded:
```json
{"error": "Session cap exceeded (max: 50)"}
```

---

### Create pipeline

```bash
curl -X POST http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pr-review-pipeline",
    "stages": [
      {"type": "session", "config": {"prompt": "Review PR"}},
      {"type": "session", "config": {"prompt": "Run tests"}}
    ]
  }'
```

**Response `201`:**
```json
{"id": "pipe-abc123", "name": "pr-review-pipeline", "status": "pending"}
```

---

### List pipelines

```bash
curl http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
[{"id": "pipe-abc123", "name": "pr-review-pipeline", "status": "running"}]
```

---

### Get pipeline status

```bash
curl http://localhost:9100/v1/pipelines/pipe-abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"id": "pipe-abc123", "name": "pr-review-pipeline", "status": "completed", "stages": [...]}
```

---

## Health

### Health check

```bash
curl http://localhost:9100/v1/health
```

No auth required.

**Response `200`:**
```json
{
  "status": "ok",
  "tmux": "connected",
  "claudeCli": "available",
  "version": "0.6.1",
  "uptime": 3600
}
```

---

### Protocol handshake

```bash
curl -X POST http://localhost:9100/v1/handshake \
  -H "Content-Type: application/json" \
  -d '{"version": "1.0", "capabilities": ["sessions", "batch"]}'
```

**Request body:**
- `version` **(required)** — protocol version string
- `capabilities` **(required)** — array of supported capabilities

**Response `200`:**
```json
{"ok": true, "version": "1.0", "capabilities": ["sessions", "batch"]}
```

**Response `409`** — incompatible protocol:
```json
{"error": "Incompatible protocol version"}
```

---

### Swarm awareness scan

```bash
curl http://localhost:9100/v1/swarm
```

Scans for other Aegis instances on the network.

**Response `200`:**
```json
{"instances": [{"host": "192.168.1.10", "port": 9100, "status": "active"}]}
```

---

### Alert manager stats

```bash
curl http://localhost:9100/v1/alerts/stats
```

**Response `200`:**
```json
{"active": 2, "firing": 1, "resolved": 5}
```

---

### Fire test alert

```bash
curl -X POST http://localhost:9100/v1/alerts/test \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response `200`:**
```json
{"ok": true}
```

**Response `502`** — alert delivery failed:
```json
{"error": "Alert delivery failed"}
```

---

### Webhook dead letter queue

```bash
curl http://localhost:9100/v1/webhooks/dead-letter \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Lists failed webhook deliveries for inspection and retry.

**Response `200`:**
```json
[{"id": "dlq-abc123", "webhook": "https://example.com/hook", "attempts": 3, "lastError": "Connection timeout"}]
```

---

### Channel health

```bash
curl http://localhost:9100/v1/channels/health
```

Returns health status for all connected channels (Telegram, Slack, Email, webhooks).

**Response `200`:**
```json
[{"channel": "telegram", "status": "connected"}, {"channel": "slack", "status": "connected"}]
```

---

## Metrics

### Global metrics

```bash
curl http://localhost:9100/v1/metrics
```

Prometheus-format metrics. Includes session counts, request latency histograms, error rates.

**Response `200`:**
```
# HELP aegis_sessions_active Active sessions
# TYPE aegis_sessions_active gauge
aegis_sessions_active 3
```

---

### Audit log

```bash
# JSON response
curl "http://localhost:9100/v1/audit?from=2026-04-22T00:00:00Z&limit=50" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# CSV export
curl "http://localhost:9100/v1/audit?format=csv" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# NDJSON export
curl "http://localhost:9100/v1/audit?format=ndjson" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Query parameters:**
- `from` — ISO 8601 lower timestamp bound (inclusive)
- `to` — ISO 8601 upper timestamp bound (inclusive)
- `cursor` — pagination cursor (record hash)
- `limit` — max records (default: 100, max: 1000)
- `format` — `json` (default), `csv`, or `ndjson`

Admin only.

**Response `200` (JSON):**
```json
{
  "items": [
    {
      "id": "aud-abc123",
      "timestamp": "2026-04-22T10:00:00.000Z",
      "action": "session.create",
      "actor": "admin",
      "sessionId": "abc123",
      "details": {}
    }
  ],
  "hasMore": true,
  "nextCursor": "aud-def456"
}
```

---

### Diagnostics

```bash
curl "http://localhost:9100/v1/diagnostics?limit=50" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Query parameters:**
- `limit` — max entries (default: 50, max: 100)

**Response `200`:**
```json
{"items": [...]}
```

---

### Global tool definitions

```bash
curl http://localhost:9100/v1/tools
```

Lists all globally registered MCP tools.

**Response `200`:**
```json
[{"name": "read_file", "description": "Read a file from disk", "schema": {...}}]
```

---

## Events

### Global SSE event stream

```bash
curl -N http://localhost:9100/v1/events \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Aggregates events from ALL active sessions via Server-Sent Events. Use `curl -N` to disable buffering.

**SSE format:**
```
event: session.created
data: {"id":"abc123","workDir":"/home/user/project"}

event: session.message
data: {"sessionId":"abc123","role":"assistant","content":"Done"}
```

---

## Usage & Metering

> **Roles required:** `admin` (all endpoints) or `operator` (summary & session detail). Added in v0.6.0.

### Total usage summary

```bash
curl http://localhost:9100/v1/usage \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns aggregate usage metrics with optional time-range and API key filtering.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO 8601 | Lower bound (inclusive) |
| `to` | ISO 8601 | Upper bound (inclusive) |
| `keyId` | string | Filter to a specific API key |

**Response:**
```json
{
  "schema_version": 1,
  "total_tokens": 128400,
  "total_cost_usd": 0.42,
  "total_sessions": 15,
  "rate_tiers": [
    { "tier": "free", "limit": 100000, "unit": "tokens" }
  ]
}
```

### Per-key usage breakdown

```bash
curl http://localhost:9100/v1/usage/by-key \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Role:** `admin` only.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO 8601 | Lower bound (inclusive) |
| `to` | ISO 8601 | Upper bound (inclusive) |

**Response:**
```json
{
  "schema_version": 1,
  "keys": [
    {
      "keyId": "ak_abc123",
      "total_tokens": 64200,
      "total_cost_usd": 0.21,
      "session_count": 8
    }
  ],
  "total_keys": 1
}
```

### Per-session usage records

```bash
curl http://localhost:9100/v1/usage/sessions/abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Role:** `admin` or `operator`.

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `from` | ISO 8601 | Lower bound (inclusive) |
| `to` | ISO 8601 | Upper bound (inclusive) |

**Response:**
```json
{
  "schema_version": 1,
  "sessionId": "abc123",
  "records": [
    {
      "timestamp": "2026-05-01T10:00:00Z",
      "tokens_in": 1200,
      "tokens_out": 800,
      "cost_usd": 0.012,
      "model": "claude-sonnet-4-20250514"
    }
  ],
  "total_records": 1
}
```

### Current rate tiers

```bash
curl http://localhost:9100/v1/usage/tiers \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns the configured rate tier configuration. No role restriction.

**Response:**
```json
{
  "schema_version": 1,
  "tiers": [
    { "tier": "free", "limit": 100000, "unit": "tokens" },
    { "tier": "pro", "limit": 1000000, "unit": "tokens" }
  ]
}
```
