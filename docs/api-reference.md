# API Reference

Aegis exposes a REST API on `http://localhost:9100` (configurable via `AEGIS_PORT`). All endpoints return JSON.

## Authentication

Set `AEGIS_AUTH_TOKEN` to enable bearer token authentication. All endpoints except `/v1/health` require the `Authorization: Bearer <token>` header when auth is enabled.

```bash
# With auth
curl -H "Authorization: Bearer your-token" http://localhost:9100/v1/sessions

# Without auth (default)
curl http://localhost:9100/v1/sessions
```

For multi-key auth, see [Enterprise Deployment](./enterprise.md#authentication).

## Claude Code Hook Receiver Authentication

`POST /v1/hooks/{eventName}` is the inbound callback endpoint used by Claude Code hooks.

- Send the session ID via `X-Session-Id` header (or `sessionId` query fallback).
- Send the hook secret via `X-Hook-Secret` header.
- Query-param `secret` is deprecated in compatibility mode and logs a warning.
- Set `AEGIS_HOOK_SECRET_HEADER_ONLY=true` to enforce header-only secret transport and reject query-param secrets.

```bash
curl -X POST "http://localhost:9100/v1/hooks/Stop?sessionId=<session-uuid>" \
  -H "X-Hook-Secret: <hook-secret>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

### Client Handshake

```bash
curl -X POST http://localhost:9100/v1/handshake \
  -H "Content-Type: application/json" \
  -d '{"clientVersion": "1.2.3", "capabilities": ["streamable-events", "tool-use"]}'
```

Performs capability negotiation with Aegis. Returns server capabilities and compatibility status.

**Request body:**
- `clientVersion` — client semantic version string
- `capabilities` — array of client capability names

**Response:**
```json
{
  "compatible": true,
  "serverVersion": "0.5.3-preview",
  "capabilities": ["streamable-events", "tool-use", "permission-requests"]
}
```

---

## Core Endpoints

### Health Check

```bash
curl http://localhost:9100/v1/health
```

**Response:**

```json
{
  "status": "ok",
  "version": "0.3.0-preview",
  "platform": "linux",
  "uptime": 3600,
  "sessions": { "active": 3, "total": 42 },
  "tmux": { "healthy": true, "error": null },
  "timestamp": "2026-04-08T09:00:00.000Z"
}
```

> No authentication required.

### Create Session

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "feature-auth",
    "workDir": "/home/user/my-project",
    "prompt": "Build a login page with email/password fields."
  }'
```

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | no | Session name (defaults to auto-generated) |
| `workDir` | string | yes | Absolute path to working directory (must exist) |
| `prompt` | string | no | Initial prompt to send after boot |
| `prd` | string | no | Product Requirements Document — full PRD text for the session |
| `resumeSessionId` | string (UUID) | no | Resume an existing session by its UUID |
| `claudeCommand` | string | no | Custom Claude Code CLI flags (e.g. `--model sonnet`) |
| `env` | object | no | Environment variables to set for this session (see env-var allowlist) |
| `stallThresholdMs` | number | no | Milliseconds after which an idle session is marked stalled (default: 300000, max: 3600000) |
| `permissionMode` | string | no | One of: `default`, `bypassPermissions`, `plan`, `acceptEdits`, `dontAsk`, `auto` |
| `autoApprove` | boolean | no | Skip all permission prompts (equivalent to `permissionMode: bypassPermissions`) |
| `parentId` | string (UUID) | no | Set a parent session — child appears in parent's `/children` list |
| `memoryKeys` | string[] | no | Pre-load named memory entries into this session (max 50) |

**Response:**

```json
{
  "id": "abc123",
  "name": "feature-auth",
  "workDir": "/home/user/my-project",
  "status": "working",
  "createdAt": "2026-04-08T09:00:00.000Z",
  "promptDelivery": { "delivered": true, "attempts": 1 }
}
```

### Read Session Output

```bash
curl http://localhost:9100/v1/sessions/abc123/read
```

### Paginated Transcript

```bash
curl "http://localhost:9100/v1/sessions/abc123/transcript?page=1&limit=50&role=user" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns a paginated transcript for a session using page-based navigation.

**Query parameters:**
- `page` — page number (default: 1)
- `limit` — entries per page (default: 50, max: 200)
- `role` — filter by role: `user`, `assistant`, or `system`

**Response:** `200 OK` with transcript page, or `404 Not Found`.

### Paginated Transcript (Cursor)

```bash
curl "http://localhost:9100/v1/sessions/abc123/transcript/cursor?limit=50&role=user" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Paginated transcript with cursor-based navigation. Use `before_id` for pagination.

**Query parameters:**
- `limit` — max entries per page (default: 50, max: 200)
- `before_id` — cursor for previous page (entry ID)
- `role` — filter by role: `user`, `assistant`, or `system`

**Response:**
```json
{
  "entries": [
    { "id": 1, "role": "user", "content": "...", "timestamp": "..." },
    { "id": 2, "role": "assistant", "content": "...", "timestamp": "..." }
  ],
  "hasMore": true
}
```

**Response:**

```json
{
  "id": "abc123",
  "status": "idle",
  "output": "I've created the login page with...",
  "tokenUsage": { "input": 1500, "output": 800 }
}
```

### Send Message

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Add form validation."}'
```

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Message to send to Claude Code |

### Interrupt Session

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/interrupt
```

Sends `Ctrl+C` to the Claude Code session. Useful when Claude is stuck or working on the wrong task.

### Kill Session

```bash
curl -X DELETE http://localhost:9100/v1/sessions/abc123
```

Terminates the tmux window and cleans up resources.

### Spawn Child Session

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/spawn \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Review the changes in the parent session."}'
```

Creates a child Claude Code session within the same tmux window. The child inherits the parent's working directory.

### Fork Session

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/fork
```

Creates a new independent session with the same working directory and context.

### Batch Operations

**Batch Create:**

```bash
curl -X POST http://localhost:9100/v1/sessions/batch \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {"name": "task-1", "workDir": "/project", "prompt": "Task 1"},
      {"name": "task-2", "workDir": "/project", "prompt": "Task 2"}
    ]
  }'
```

**Batch Kill:**

```bash
curl -X DELETE http://localhost:9100/v1/sessions/batch \
  -H "Content-Type: application/json" \
  -d '{"ids": ["abc123", "def456"]}'
```

### Quality Gate Verification

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/verify
```

Runs the configured verification protocol on a completed session (e.g., test suite, lint, build). Returns `200` with pass/fail result, `422` if verification failed, or `404` if the session does not exist.

---

### Session History

```bash
curl "http://localhost:9100/v1/sessions/history?page=1&limit=20&status=active" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns paginated history of all sessions from the audit log. Supports filtering by `status` and `ownerKeyId`.

**Query parameters:**
- `page` — page number (default: 1)
- `limit` — items per page (default: 50, max: 200)
- `status` — filter by status: `active`, `killed`, `stalled`
- `ownerKeyId` — filter by owner API key

**Response:**
```json
{
  "items": [
    {
      "id": "3f47a2b1",
      "ownerKeyId": "key-abc123",
      "createdAt": "2026-04-13T10:00:00.000Z",
      "endedAt": "2026-04-13T10:30:00.000Z",
      "lastSeenAt": 1744531800000,
      "finalStatus": "killed",
      "source": "audit"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

### Session Statistics

```bash
curl http://localhost:9100/v1/sessions/stats \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns aggregated session statistics. Non-admin keys only see their own sessions.

**Response:**
```json
{
  "active": 3,
  "byStatus": { "active": 2, "stalled": 1 },
  "totalCreated": 142,
  "totalCompleted": 87,
  "totalFailed": 12
}
```

### Answer Pending Question

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/answer \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "q-001", "answer": "my-answer"}'
```

Submits an answer to a pending `AskUserQuestion` prompt in a Claude Code session.

**Required fields:**
- `questionId` — the question ID to answer
- `answer` — the answer string

**Response:** `200 OK` with `{ "ok": true }`, or `409 Conflict` if no matching pending question.

### Per-Session Metrics

```bash
curl http://localhost:9100/v1/sessions/abc123/metrics \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns metrics for a specific session (message counts, tool calls, token usage).

**Response:** `404` if no metrics exist for the session.

### Per-Session Tool Usage

```bash
curl http://localhost:9100/v1/sessions/abc123/tools \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns per-tool call counts for a session, parsed from the JSONL transcript.

**Response:**
```json
{
  "sessionId": "abc123",
  "tools": [
    { "name": "Bash", "category": "shell", "count": 12, "totalTokens": 8421 }
  ],
  "totalCalls": 47
}
```

### Escape Session

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/escape \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Sends Ctrl+C to interrupt the current running command and returns control to the shell prompt.

### Session Events (SSE)

```bash
curl -N http://localhost:9100/v1/sessions/abc123/events \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Server-Sent Events stream for session-specific events (state changes, permission requests, verification results). Requires ownership.

**Rate limited:** Per-IP and global connection limits apply (see `/v1/events` for global stream).

---

### Get Child Sessions

```bash
curl http://localhost:9100/v1/sessions/abc123/children \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns a list of child session IDs spawned from this session (via `/fork` or `/spawn`).

**Response:**
```json
{
  "children": ["def456", "ghi789"]
}
```

### Capture Pane

```bash
curl http://localhost:9100/v1/sessions/abc123/pane \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns the raw terminal pane content (captured via tmux `capture-pane`).

**Response:**
```json
{
  "pane": "user@host:~$ ls\nfile1  file2\nuser@host:~$ "
}
```

### Send Slash Command

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/command \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "/clear"}'
```

Sends a slash command to the Claude Code session (e.g., `/clear`, `/commit`, `/review`). Prefixes with `/` if not provided.

**Response:** `200 OK` with session update.

### Execute Bash Command

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/bash \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la", "timeoutMs": 30000}'
```

Run a bash command directly inside the session's tmux window. Captures stdout and stderr up to `timeoutMs`. Useful for integration testing, running scripts, or querying session state.

**Request body:**
```json
{
  "command": "string",      // Bash command to run
  "timeoutMs": 30000        // Max wait time in ms (default: 30000)
}
```

**Response:** `200 OK` with `{ok: true, output: "..."}`, `400` if validation fails, `404` if session not found.

### Session Summary

```bash
curl http://localhost:9100/v1/sessions/abc123/summary \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns an AI-generated summary of the session (parsed from transcript). Requires the session to have ended or have a JSONL transcript.

**Response:** `200 OK` with summary text, or `404` if no summary is available.

### Screenshot

```bash
curl http://localhost:9100/v1/sessions/abc123/screenshot \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Captures a screenshot of the session terminal using Playwright. Returns base64 PNG image data.

**Response:** `200 OK` with `{ "image": "<base64>", "width": 1200, "height": 800 }`, or `501` if Playwright is not installed.

### Verify Auth Token

```bash
curl -X POST http://localhost:9100/v1/auth/verify \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Verifies if the current auth token is valid. Returns token metadata on success.

**Response:**
```json
{
  "valid": true
}
```

---

## Audit Endpoints

### Audit Log

```bash
curl "http://localhost:9100/v1/audit?action=session.create&from=2026-04-13T00:00:00Z&limit=50" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns immutable audit log records. Admin only.

**Query parameters:**
- `actor` — filter by actor key ID
- `action` — filter by action type (e.g., `session.create`, `session.kill`)
- `sessionId` — filter by session ID
- `from` / `to` — inclusive ISO 8601 time range
- `cursor` — cursor returned by the previous JSON page
- `limit` — max records to return for JSON mode (default: 100)
- `reverse` — return each JSON page newest first
- `format` — `json` (default), `csv`, or `ndjson`
- `verify` — include full-chain verification metadata

**Response:**
```json
{
  "count": 1,
  "total": 1,
  "records": [
    {
      "ts": "2026-04-13T10:00:00.000Z",
      "actor": "key-abc",
      "action": "session.create",
      "sessionId": "abc123",
      "detail": "Created session",
      "prevHash": "",
      "hash": "..."
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": false,
    "nextCursor": null,
    "reverse": false
  },
  "chain": {
    "count": 1,
    "firstHash": "...",
    "lastHash": "...",
    "badgeHash": "...",
    "firstTs": "2026-04-13T10:00:00.000Z",
    "lastTs": "2026-04-13T10:00:00.000Z"
  }
}
```

**Export modes:**

```bash
curl "http://localhost:9100/v1/audit?action=session.create&format=csv" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

curl "http://localhost:9100/v1/audit?actor=key-abc&format=ndjson" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

CSV and NDJSON exports apply the same filters and include chain metadata in
response headers (`X-Aegis-Audit-First-Hash`, `X-Aegis-Audit-Last-Hash`,
`X-Aegis-Audit-Chain-Badge`, etc.).

---

## Orchestration Endpoints

### Pipelines

```bash
### Get Pipeline

```bash
curl http://localhost:9100/v1/pipelines/abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns the status and details of a specific pipeline by ID.

**Response:** `200 OK` with pipeline object, or `404` if not found.

### Create pipeline

```bash
curl -X POST http://localhost:9100/v1/pipelines \
  -H "Content-Type: application/json" \
  -d '{
    "name": "build-and-test",
    "stages": [
      {"prompt": "Run tests and fix failures"},
      {"prompt": "Run lint and fix issues"}
    ]
  }'

# List pipelines
curl http://localhost:9100/v1/pipelines
```

### Session Templates

Session templates store reusable session configurations. Templates support variable substitution using `{{variable}}` syntax in prompts.

#### List Templates

```bash
curl http://localhost:9100/v1/templates
```

Returns registered session templates with variable substitution support.

#### Create Template

```bash
curl -X POST http://localhost:9100/v1/templates \
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
- `sessionId` — base session to copy settings from (UUID)
- `workDir` — default working directory
- `prompt` — template prompt with `{{variable}}` substitution (max 100k chars)
- `claudeCommand` — Claude Code CLI arguments
- `env` — environment variables map
- `stallThresholdMs` — stall timeout 1–3600000ms
- `permissionMode` — `default | bypassPermissions | plan | acceptEdits | dontAsk | auto`
- `autoApprove` — skip permission prompts

**Response:** `201 Created` with template object.

#### Get Template

```bash
curl http://localhost:9100/v1/templates/abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns a single template by ID.

**Response:** `200 OK` with template object, or `404 Not Found`.

#### Update Template

```bash
curl -X PUT http://localhost:9100/v1/templates/abc123 \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description", "prompt": "New prompt {{var}}"}'
```

Partially updates a template. Only include fields to change.

**Response:** `200 OK` with updated template, or `404 Not Found`.

#### Delete Template

```bash
curl -X DELETE http://localhost:9100/v1/templates/abc123 \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Deletes a template by ID.

**Response:** `200 OK` with `{ok: true}`, or `404 Not Found`.

### Swarm Status

```bash
curl http://localhost:9100/v1/swarm
```

Returns the status of parallel session swarm coordination.

---

## Session Hooks

Session hooks are internal callbacks triggered by Claude Code lifecycle events. These endpoints are called by the Aegis server itself — not by external clients.

### Permission Hook

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Allow lsof to check open files?",
    "expectedAllow": true
  }'
```

Called by Claude Code when a permission prompt occurs. The Aegis server routes this to the appropriate permission approver.

**Response:** `200 OK` if session found, `404 Not Found` otherwise.

### Stop Hook

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/stop \
  -H "Content-Type: application/json" \
  -d '{"reason": "user_interrupt"}'
```

Called when a session is stopped externally (e.g., via interrupt or kill). Cleans up session state.

**Response:** `200 OK` if session found, `404 Not Found` otherwise.

---

## Permission Endpoints

### Update Permission Policy

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permissions \
  -H "Content-Type: application/json" \
  -d '{"allowRead": true, "allowWrite": true, "allowBash": false}'
```

### Update Permission Profile

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permission-profile \
  -H "Content-Type: application/json" \
  -d '{"profile": "restricted"}'
```

### Approve/Reject Permission Request

```bash
# Approve
curl -X POST http://localhost:9100/v1/sessions/abc123/approve \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "perm-1"}'

# Reject
curl -X POST http://127.0.0.1:9100/v1/sessions/abc123/reject \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "perm-1"}'
```

---

## Auth Management Endpoints

### Create API Key

```bash
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-bot", "role": "operator"}'
```

### List API Keys

```bash
curl http://localhost:9100/v1/auth/keys
```

### Delete API Key

```bash
curl -X DELETE http://localhost:9100/v1/auth/keys/key-abc123
```

### Rotate API Key

```bash
curl -X POST http://localhost:9100/v1/auth/keys/key-abc123/rotate \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlDays": 365}'
```

Rotates an API key. Admin-only. Optionally set TTL in days. Returns the updated key metadata.

### Rotate API Key (Zero-Downtime)

```bash
curl -X POST http://localhost:9100/v1/auth/keys/rotate \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keyId": "key-abc123", "graceSeconds": 120, "ttlDays": 365}'
```

Rotates an API key with a **grace period** during which both the old and new keys are valid. Enables zero-downtime rotation for production systems. The old key is rejected after `graceSeconds` elapse.

| Parameter | Type | Description |
|---|---|---|
| `keyId` | string | ID of the key to rotate |
| `graceSeconds` | number | How long the old key stays valid (default: `AEGIS_KEY_ROTATION_GRACE_SECONDS`, min: 1, max: 3600) |
| `ttlDays` | number | Optional new TTL in days |

**Response:**
```json
{
  "keyId": "key-abc123",
  "key": "ak-new-...",
  "expiresAt": "2027-04-23T12:00:00.000Z",
  "graceEndsAt": "2026-04-23T12:02:00.000Z"
}
```

### Create SSE Token

```bash
curl -X POST http://localhost:9100/v1/auth/sse-token
```

Returns a short-lived token for SSE event stream authentication.

### Get Key Quotas

```bash
curl http://localhost:9100/v1/auth/keys/key-abc123/quotas \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns the configured quotas and current usage (sessions, tokens, USD spend) for a specific API key.

**Response:**
```json
{
  "keyId": "key-abc123",
  "quotas": {
    "maxSessions": 10,
    "maxTokens": 1000000,
    "maxSpendUsd": 50.00
  },
  "usage": {
    "sessions": 3,
    "tokens": 245000,
    "spendUsd": 12.50
  }
}
```

### Set Key Quotas

```bash
curl -X PUT http://localhost:9100/v1/auth/keys/key-abc123/quotas \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxSessions": 10,
    "maxTokens": 1000000,
    "maxSpendUsd": 50.00
  }'
```

Sets or updates quotas for an API key. Omit a field to leave it unchanged. Set a field to `null` to remove the limit.

---

## Memory Bridge Endpoints

### Set Memory Entry

```bash
curl -X POST http://localhost:9100/v1/memory \
  -H "Content-Type: application/json" \
  -d '{"key": "project-context", "value": "Using Fastify v5", "ttlMs": 3600000}'
```

### Get Memory Entry

```bash
curl http://localhost:9100/v1/memory/project-context
```

### List Memory Entries

```bash
# All entries
curl http://localhost:9100/v1/memory

# Filter by prefix
curl "http://localhost:9100/v1/memory?prefix=project-"
```

### Delete Memory Entry

```bash
curl -X DELETE http://localhost:9100/v1/memory/project-context
```

### Session-Scoped Memory

```bash
# Attach memory to session
curl -X POST http://localhost:9100/v1/sessions/abc123/memories \
  -H "Content-Type: application/json" \
  -d '{"key": "task-status", "value": "in-progress"}'

# Get session memories
curl http://localhost:9100/v1/sessions/abc123/memories
```

---
### Bulk Session Health

```bash
curl http://localhost:9100/v1/sessions/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns health status for all visible sessions (owned sessions, or all if admin). Useful for monitoring dashboards.

**Response:** `200 OK` with array of session health objects. `401` if unauthorized, `403` if forbidden.

### Session Health

```bash
curl http://localhost:9100/v1/sessions/{id}/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns liveness and health data for a specific session.

**Response:**

```json
{
  "alive": true,
  "windowExists": true,
  "claudeRunning": true,
  "paneCommand": "claude --no-input",
  "status": "working",
  "hasTranscript": true,
  "lastActivity": 1712650800000,
  "lastActivityAgo": 2340,
  "sessionAge": 45230000,
  "details": "Session healthy"
}
```

### Session Latency

```bash
curl http://localhost:9100/v1/sessions/{id}/latency \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns per-operation latency metrics for a session (hook latency, state change detection, permission response, channel delivery).



## Observability Endpoints

### Metrics

```bash
curl http://localhost:9100/v1/metrics
```

Returns token usage tracking and cost estimation across all sessions.

### Diagnostics

```bash
curl http://localhost:9100/v1/diagnostics
```

Returns system diagnostics (tmux health, resource usage, configuration).

### MCP Tools

```bash
curl http://localhost:9100/v1/tools
```

Lists all available MCP tools with their schemas. For full tool documentation, see [MCP Tools Reference](./mcp-tools.md).

### SSE Event Stream

```bash
curl -N http://localhost:9100/v1/events
```

Server-Sent Events stream for real-time session state changes. Supports token-based authentication via query parameter: `?token=<sse-token>`.

**Event types:** `session.created`, `session.idle`, `session.working`, `session.stalled`, `session.killed`, `permission.requested`

### Channel Health

```bash
curl http://localhost:9100/v1/channels/health
```

Returns health status for all connected channels (Telegram, Slack, Email, webhooks).

### Dead-Letter Queue

```bash
curl http://localhost:9100/v1/webhooks/dead-letter
```

Lists failed deliveries across all channels (webhooks, Slack, Email) for inspection and retry.

---

## Metering Endpoints

### Get Usage Summary

```bash
curl http://localhost:9100/v1/metering/usage \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns token usage and spend across all API keys for the current billing period.

**Response:**
```json
{
  "period": {
    "start": "2026-04-01T00:00:00.000Z",
    "end": "2026-04-30T23:59:59.999Z"
  },
  "summary": {
    "totalSessions": 482,
    "totalTokens": 12400000,
    "totalSpendUsd": 248.50
  },
  "rateTiers": [
    {"tier": "free", "tokensIncluded": 100000, "pricePerMillionTokens": 0},
    {"tier": "standard", "tokensIncluded": 1000000, "pricePerMillionTokens": 20}
  ]
}
```

### Get Per-Key Usage

```bash
curl "http://localhost:9100/v1/metering/keys/key-abc123/usage" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns token usage and spend for a specific API key.

### Get Per-Session Usage

```bash
curl "http://localhost:9100/v1/metering/sessions/sess-xyz/usage" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns token usage and cost for a specific session.

---

## Usage Endpoints

Billing and metering data with time-range filtering (Issue #1954).

### Get Total Usage Summary

```bash
curl http://localhost:9100/v1/usage \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns total usage across all sessions with optional filters.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO8601 | Start of time window (inclusive) |
| `to` | ISO8601 | End of time window (inclusive) |
| `keyId` | string | Filter to a specific API key |

**Roles:** `admin`, `operator`

**Response:** `200 OK`

```json
{
  "schema_version": 1,
  "totalSessions": 150,
  "totalTokens": 4200000,
  "totalSpendUsd": 84.50,
  "rate_tiers": [
    {"tier": "free", "tokensIncluded": 100000, "pricePerMillionTokens": 0},
    {"tier": "standard", "tokensIncluded": 1000000, "pricePerMillionTokens": 20}
  ]
}
```

### Get Per-Key Usage Breakdown

```bash
curl http://localhost:9100/v1/usage/by-key \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns usage broken down by API key.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO8601 | Start of time window (inclusive) |
| `to` | ISO8601 | End of time window (inclusive) |

**Roles:** `admin`

**Response:** `200 OK`

```json
{
  "schema_version": 1,
  "keys": [
    {"keyId": "ak_abc123", "keyName": "ci-bot", "sessions": 80, "tokens": 2200000, "spendUsd": 44.00},
    {"keyId": "ak_def456", "keyName": "dashboard", "sessions": 70, "tokens": 2000000, "spendUsd": 40.50}
  ],
  "total_keys": 2
}
```

### Get Per-Session Usage Records

```bash
curl http://localhost:9100/v1/usage/sessions/sess-xyz \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns usage records for a specific session.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO8601 | Start of time window (inclusive) |
| `to` | ISO8601 | End of time window (inclusive) |

**Roles:** `admin`, `operator`

**Response:** `200 OK`

```json
{
  "schema_version": 1,
  "sessionId": "sess-xyz",
  "records": [
    {"timestamp": "2026-04-22T10:30:00.000Z", "inputTokens": 1500, "outputTokens": 800, "costUsd": 0.05}
  ],
  "total_records": 1
}
```

### Get Rate Tier Configuration

```bash
curl http://localhost:9100/v1/usage/tiers \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns the current rate tier configuration. No auth required.

**Response:** `200 OK`

```json
{
  "schema_version": 1,
  "tiers": [
    {"tier": "free", "tokensIncluded": 100000, "pricePerMillionTokens": 0},
    {"tier": "standard", "tokensIncluded": 1000000, "pricePerMillionTokens": 20}
  ]
}
```

---

## Analytics Endpoints

### Get Analytics Summary

```bash
curl http://localhost:9100/v1/analytics/summary \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns aggregated session, token, cost, duration, and error-rate data computed from in-memory state (Issue #1970).

**Roles:** `admin`, `operator`, `viewer`

**Response:** `200 OK`

```json
{
  "sessionVolume": [
    {"date": "2026-04-22", "created": 42}
  ],
  "tokenUsageByModel": [
    {
      "model": "claude-sonnet-4-20250514",
      "inputTokens": 2400000,
      "outputTokens": 800000,
      "cacheCreationTokens": 100000,
      "cacheReadTokens": 500000,
      "estimatedCostUsd": 52.40
    }
  ],
  "costTrends": [
    {"date": "2026-04-22", "cost": 24.50, "sessions": 42}
  ],
  "topApiKeys": [
    {"keyId": "ak_abc123", "keyName": "ci-bot", "sessions": 30, "messages": 500, "estimatedCostUsd": 18.20}
  ],
  "durationTrends": [
    {"date": "2026-04-22", "avgDurationSec": 245, "count": 38}
  ],
  "errorRates": {
    "totalSessions": 500,
    "failedSessions": 12,
    "failureRate": 0.024,
    "permissionPrompts": 85,
    "approvals": 72,
    "autoApprovals": 45
  },
  "generatedAt": "2026-04-22T12:00:00.000Z"
}
```

| Field | Description |
|-------|-------------|
| `sessionVolume` | Daily session creation counts |
| `tokenUsageByModel` | Token breakdown by model, sorted by cost descending |
| `costTrends` | Daily cost and session counts |
| `topApiKeys` | Top 10 API keys by session count |
| `durationTrends` | Average session duration per day |
| `errorRates` | Failure rates and permission prompt statistics |
| `generatedAt` | Timestamp when the summary was computed |

---

## Alerting

### Test Alert Webhook

```bash
curl -X POST http://localhost:9100/v1/alerts/test \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://example.com/alerts","secret":"test-secret"}'
```

**Response:** `200 OK`

```json
{
  "success": true,
  "delivered": true
}
```

Tests webhook delivery. Returns `delivered: true` if the webhook responds with 2xx.

### Get Alert Statistics

```bash
curl http://localhost:9100/v1/alerts/stats \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response:** `200 OK`

```json
{
  "last24h": {
    "sessionFailures": 0,
    "deadSessions": 0,
    "tmuxCrashes": 0
  },
  "totals": {
    "sessionFailures": 2,
    "deadSessions": 1,
    "tmuxCrashes": 0
  }
}
```

Returns alert counts. Available to `admin`, `operator`, and `viewer` roles.

---

## Unversioned Aliases

All core session endpoints are available without the `/v1` prefix for backward compatibility:

| v1 Endpoint | Alias |
|---|---|
| `POST /v1/sessions` | `POST /sessions` |
| `GET /v1/sessions/:id/read` | `GET /sessions/:id/read` |
| `POST /v1/sessions/:id/send` | `POST /sessions/:id/send` |
| `POST /v1/sessions/:id/interrupt` | `POST /sessions/:id/interrupt` |
| `DELETE /v1/sessions/:id` | `DELETE /sessions/:id` |
| `POST /v1/sessions/:id/spawn` | `POST /sessions/:id/spawn` |
| `POST /v1/sessions/:id/fork` | `POST /sessions/:id/fork` |
| `PUT /v1/sessions/:id/permissions` | `PUT /sessions/:id/permissions` |
| `PUT /v1/sessions/:id/permission-profile` | `PUT /sessions/:id/permission-profile` |

---

## Error Responses

All endpoints return errors in a consistent envelope format:

```json
{
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND",
  "statusCode": 404
}
```

### Status Codes

| Status Code | Meaning |
|---|---|
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (missing or invalid token) |
| 403 | Forbidden (valid token but insufficient permissions) |
| 404 | Session or resource not found |
| 409 | Conflict (session already exists, etc.) |
| 422 | Unprocessable entity (validation failed) |
| 429 | Rate limited |
| 500 | Internal server error |

### Aegis Error Codes

Every error response includes an Aegis-specific `code` field for programmatic handling:

| Error Code | HTTP Status | Meaning |
|---|---|---|
| `SESSION_NOT_FOUND` | 404 | Session deleted, wrong state, or never existed |
| `SESSION_CREATE_FAILED` | 500 | Tmux window or Claude Code launch failed |
| `PERMISSION_REJECTED` | 409 | Permission request answered with reject |
| `TMUX_TIMEOUT` | 504 | Tmux command timed out (retryable) |
| `TMUX_ERROR` | 500 | Tmux operation failed |
| `VALIDATION_ERROR` | 422 | Request body or parameters failed Zod validation |
| `AUTH_ERROR` | 401 | Authentication failed (missing, invalid, or expired token) |
| `RATE_LIMITED` | 429 | Per-key rate limit exceeded |
| `NETWORK_ERROR` | 502 | Transient network or I/O failure (retryable) |
| `INTERNAL_ERROR` | 500 | Unexpected internal error |

