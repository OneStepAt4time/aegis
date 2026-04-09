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
  "version": "0.3.0-alpha",
  "platform": "linux",
  "uptime": 3600,
  "sessions": { "active": 3, "total": 42 },
  "tmux": { "healthy": true, "error": null },
  "timestamp": "2026-04-08T09:00:00.000Z"
}
```

> No authentication required.

### Session Statistics

```bash
curl http://localhost:9100/v1/sessions/stats
```

**Response:** Aggregate session metrics (active, idle, stalled counts).

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

Runs verification checks on session output (tests, lint, build). Returns pass/fail results.

---

## Orchestration Endpoints

### Pipelines

```bash
# Create pipeline
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

```bash
curl http://localhost:9100/v1/templates
```

Returns registered session templates with variable substitution support.

### Swarm Status

```bash
curl http://localhost:9100/v1/swarm
```

Returns the status of parallel session swarm coordination.

---

## Consensus Endpoints

### Create Consensus Review

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/consensus \
  -H "Content-Type: application/json" \
  -d '{
    "criteria": ["correctness", "security", "performance"],
    "reviewers": 3
  }'
```

Creates a multi-agent consensus review. Multiple Claude Code sessions independently review the work.

### Get Consensus Result

```bash
curl http://localhost:9100/v1/consensus/review-123
```

Returns the consensus result including individual reviewer assessments and final verdict.

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
  -d '{"name": "ci-bot", "scopes": ["sessions:read", "sessions:write"]}'
```

### List API Keys

```bash
curl http://localhost:9100/v1/auth/keys
```

### Delete API Key

```bash
curl -X DELETE http://localhost:9100/v1/auth/keys/key-abc123
```

### Create SSE Token

```bash
curl -X POST http://localhost:9100/v1/auth/sse-token
```

Returns a short-lived token for SSE event stream authentication.

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

**Event types:** `session.created`, `session.idle`, `session.working`, `session.stalled`, `session.killed`, `permission.requested`, `consensus.completed`

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

### Audit Trail

```bash
# List audit records (paginated)
curl "http://localhost:9100/v1/audit?page=1&pageSize=20" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Filter by actor or session
curl "http://localhost:9100/v1/audit?actor=user@example.com&sessionId=<uuid>" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response:**

```json
{
  "records": [
    {
      "id": "audit-uuid",
      "timestamp": "2026-04-09T07:30:00.000Z",
      "actor": "user@example.com",
      "action": "session.created",
      "sessionId": "session-uuid",
      "detail": "Session my-project created"
    }
  ],
  "total": 142,
  "page": 1,
  "pageSize": 20
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | `number` | `1` | Page number |
| `pageSize` | `number` | `20` | Records per page (max 100) |
| `actor` | `string` | — | Filter by actor email/ID |
| `action` | `string` | — | Filter by action type |
| `sessionId` | `string` | — | Filter by session UUID |

**Audit actions recorded:** `session.created`, `session.ended`, `session.killed`, `permission.approved`, `permission.rejected`, `api_key.created`, `api_key.deleted`.



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

All endpoints return errors in a consistent format:

```json
{
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND",
  "statusCode": 404
}
```

| Status Code | Meaning |
|---|---|
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (missing or invalid token) |
| 404 | Session or resource not found |
| 409 | Conflict (session already exists, etc.) |
| 429 | Rate limited |
| 500 | Internal server error |
