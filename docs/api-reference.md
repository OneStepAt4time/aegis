# API Reference

Aegis exposes a REST API on `http://localhost:9100` (configurable via `AEGIS_PORT`). All endpoints return JSON unless otherwise noted.

## Authentication

Set `AEGIS_AUTH_TOKEN` to enable bearer token authentication. All endpoints except `/v1/health` require the `Authorization: Bearer <token>` header when auth is enabled.

```bash
# With auth
curl -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/sessions

# Without auth (default)
curl http://localhost:9100/v1/sessions
```

For multi-key auth, see [Enterprise Deployment](./enterprise.md#authentication).

---

## 1. System

Health, swarm coordination, diagnostics, handshake, and the OpenAPI spec.

### Health Check

```
GET /v1/health
```

Returns server health, version, uptime, and Claude CLI status. **No authentication required** — unauthenticated callers receive only `{ "status": "ok" }` to prevent information leakage.

```bash
curl http://localhost:9100/v1/health
```

**Response (authenticated):**

```json
{
  "status": "ok",
  "timestamp": "2026-04-08T09:00:00.000Z",
  "version": "0.5.3-preview",
  "platform": "linux",
  "uptime": 3600,
  "sessions": { "active": 3, "total": 42 },
  "claude": {
    "available": true,
    "healthy": true,
    "version": "1.0.18",
    "minimumVersion": "1.0.10",
    "error": null
  }
}
```

**Response (unauthenticated):**

```json
{
  "status": "ok"
}
```

**Errors:** None (always returns 200). Returns `draining` status during graceful shutdown.

---

### Version Discovery

```
GET /v1/version
```

Returns the server package name and version. **No authentication required** — this is a public endpoint for service discovery and monitoring. The response also includes an `X-Aegis-Version` header.

```bash
curl http://localhost:9100/v1/version
```

**Response:**

```json
{
  "name": "@onestepat4time/aegis",
  "version": "0.6.6"
}
```

**Headers:**

| Header | Value |
|--------|-------|
| `X-Aegis-Version` | Server package version (e.g. `0.6.6`) |

**Use cases:**
- Load balancer health checks that need version info
- CI/CD pipelines verifying deployed version
- Monitoring dashboards tracking fleet versions

---

### Swarm Status

```
GET /v1/swarm
```

Returns the status of parallel session swarm coordination.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/swarm \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "swarms": []
}
```

---

### Diagnostics

```
GET /v1/diagnostics
```

Returns bounded, no-PII diagnostic events from the internal diagnostics bus.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

**Query parameters:**

| Parameter | Type | Default | Description |
|------------|------|---------|-------------|
| `limit` | integer | 50 | Max events to return (1–100) |

```bash
curl "http://localhost:9100/v1/diagnostics?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "count": 2,
  "events": [
    { "type": "session.create", "ts": "2026-04-13T10:00:00.000Z", "detail": "..." }
  ]
}
```

---

### Client Handshake

```
POST /v1/handshake
```

Performs capability negotiation with Aegis. Returns server capabilities and compatibility status.

```bash
curl -X POST http://localhost:9100/v1/handshake \
  -H "Content-Type: application/json" \
  -d '{"clientVersion": "1.2.3", "capabilities": ["streamable-events", "tool-use"]}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clientVersion` | string | yes | Client semantic version string |
| `capabilities` | string[] | yes | Array of client capability names |

**Response (`200 OK`):**

```json
{
  "compatible": true,
  "serverVersion": "0.5.3-preview",
  "capabilities": ["streamable-events", "tool-use", "permission-requests"]
}
```

**Response (`409 Conflict`):** Returned when protocol versions are incompatible.

---

### OpenAPI Spec

```
GET /v1/openapi.json
```

Returns the machine-readable OpenAPI 3.1 specification for all endpoints.

```bash
curl http://localhost:9100/v1/openapi.json
```

**Response:** OpenAPI 3.1 JSON document.

---

### Prometheus Metrics

```
GET /metrics
```

Prometheus-compatible metrics scrape endpoint (standard path, no `/v1` prefix).

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/metrics \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Prometheus text format (`Content-Type: text/plain; version=0.0.4`).

---

### API v2 Migration Stub

```
GET /v2/
```

Returns versioning metadata for the planned v2 API. No v2 endpoints exist yet.

```bash
curl http://localhost:9100/v2/
```

**Response:**

```json
{
  "version": 2,
  "status": "planned",
  "message": "API v2 is not yet available. Continue using /v1/ endpoints.",
  "migration_guide": "/v1/openapi.json",
  "v1_base": "/v1/"
}
```

---

## 2. Authentication

Token verification, API key management, SSE tokens, and OAuth2 device authorization.

### Verify Auth Token

```
POST /v1/auth/verify
```

Verifies if the current auth token is valid. Returns token metadata and sets a dashboard session cookie.

```bash
curl -X POST http://localhost:9100/v1/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"token": "your-token"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | yes | The auth token to verify |

**Response (`200 OK`):**

```json
{
  "valid": true,
  "role": "admin"
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Invalid token |
| 429 | Rate limited |

---

### Create API Key

```
POST /v1/auth/keys
```

Creates a new API key. **Admin only.**

```bash
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-bot", "role": "operator"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Key name |
| `role` | string | yes | One of: `admin`, `operator`, `viewer` |
| `rateLimit` | number | no | Requests per minute |
| `ttlDays` | number | no | Key expiration in days |
| `permissions` | string[] | no | Permission names: `create`, `send`, `approve`, `reject`, `kill` |
| `tenantId` | string | no | Assign key to a tenant |

**Response (`201 Created`):**

```json
{
  "id": "key-abc123",
  "key": "ak_...",
  "name": "ci-bot",
  "expiresAt": null,
  "role": "operator",
  "permissions": ["create", "send"]
}
```

> **Convenience alias:** `POST /v1/keys` — identical behavior.

---

### List API Keys

```
GET /v1/auth/keys
```

Lists all registered API keys (metadata only, no secrets). **Admin only.**

```bash
curl http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Array of key summary objects with `id`, `name`, `createdAt`, `lastUsedAt`, `rateLimit`, `expiresAt`, `role`, `permissions`.

> **Convenience alias:** `GET /v1/keys`

---

### Delete API Key

```
DELETE /v1/auth/keys/:id
```

Revokes an API key by ID. **Admin only.**

```bash
curl -X DELETE http://localhost:9100/v1/auth/keys/key-abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Key not found |

> **Convenience alias:** `DELETE /v1/keys/:id`

---

### Rotate API Key

```
POST /v1/auth/keys/:id/rotate
```

Rotates an API key in place. The old key is immediately invalidated. **Admin only.**

```bash
curl -X POST http://localhost:9100/v1/auth/keys/key-abc123/rotate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlDays": 365}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ttlDays` | number | no | New TTL in days |

**Response:** Rotated key object with new `key` value.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Key not found |

---

### Rotate API Key (Zero-Downtime)

```
POST /v1/auth/keys/rotate
```

Rotates an API key with a **grace period** during which both old and new keys are valid. **Admin only.**

```bash
curl -X POST http://localhost:9100/v1/auth/keys/rotate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keyId": "key-abc123", "gracePeriodSeconds": 120, "ttlDays": 365}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `keyId` | string | yes | ID of the key to rotate |
| `gracePeriodSeconds` | number | no | How long old key stays valid (default: `AEGIS_KEY_ROTATION_GRACE_SECONDS`, min: 1, max: 86400) |
| `ttlDays` | number | no | New TTL in days |

**Response:**

```json
{
  "keyId": "key-abc123",
  "key": "ak-new-...",
  "expiresAt": "2027-04-23T12:00:00.000Z",
  "graceEndsAt": "2026-04-23T12:02:00.000Z"
}
```

---

### Create SSE Token

```
POST /v1/auth/sse-token
```

Returns a short-lived token (`sse_`-prefixed) required to authenticate SSE event stream connections. **SSE endpoints reject regular Bearer tokens** — you must obtain an SSE token first.

```bash
curl -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $TOKEN"
```

**Response (`201 Created`):**

```json
{ "token": "sse_3799ebe2daa4a0b6...", "expiresAt": 1778111504485 }
```

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | `sse_`-prefixed token for SSE stream auth |
| `expiresAt` | number | Expiration timestamp (ms since epoch). Tokens are valid for **60 seconds**. |

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Invalid or expired API key |
| 429 | SSE token limit reached (max 10 outstanding per key) |

---

### Get Key Quotas

```
GET /v1/auth/keys/:id/quotas
```

Returns configured quotas and current usage for a specific API key. **Admin only.**

```bash
curl http://localhost:9100/v1/auth/keys/key-abc123/quotas \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "quotas": {
    "maxConcurrentSessions": 10,
    "maxTokensPerWindow": 1000000,
    "maxSpendPerWindow": 50.00,
    "quotaWindowMs": 3600000
  },
  "usage": {
    "activeSessions": 3,
    "tokensInWindow": 245000,
    "spendInWindow": 12.50,
    "windowMs": 3600000
  }
}
```

---

### Set Key Quotas

```
PUT /v1/auth/keys/:id/quotas
```

Sets or updates quotas for an API key. Omit a field to leave unchanged; set to `null` to remove. **Admin only.**

```bash
curl -X PUT http://localhost:9100/v1/auth/keys/key-abc123/quotas \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxConcurrentSessions": 10,
    "maxTokensPerWindow": 1000000,
    "maxSpendPerWindow": 50.00
  }'
```

**Request body:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `maxConcurrentSessions` | number \| null | Max concurrent sessions |
| `maxTokensPerWindow` | number \| null | Max tokens per window |
| `maxSpendPerWindow` | number \| null | Max spend (USD) per window |
| `quotaWindowMs` | number | Window duration in ms (default: 3600000) |

---

### Device Authorization Grant (OAuth2, RFC 8628)

Aegis can act as a device-code broker between the CLI (`ag login`) and your IdP. Requires `AEGIS_OIDC_ISSUER` and `AEGIS_OIDC_CLIENT_ID`.

#### Initiate Device Flow

```
POST /v1/auth/device/authorize
```

Proxies a device authorization request to the IdP.

```bash
curl -X POST http://localhost:9100/v1/auth/device/authorize \
  -H "Content-Type: application/json" \
  -d '{"client_id": "your-client-id", "scope": "openid profile email"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `client_id` | string | yes | Must match `AEGIS_OIDC_CLIENT_ID` |
| `scope` | string | no | Defaults to configured scopes |

**Response (`200 OK`):** RFC 8628 device authorization response with `device_code`, `user_code`, `verification_uri`, `expires_in`, `interval`.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | `client_id` mismatch |
| 502 | IdP unreachable or doesn't support device auth |
| 503 | OIDC not configured |

#### Poll for Token

```
POST /v1/auth/device/token
```

Polls the IdP for the device-code grant result.

```bash
curl -X POST http://localhost:9100/v1/auth/device/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "urn:ietf:params:oauth2:grant-type:device_code",
    "device_code": "GmRhmh...",
    "client_id": "your-client-id"
  }'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `grant_type` | string | yes | Must be `urn:ietf:params:oauth2:grant-type:device_code` |
| `device_code` | string | yes | From the authorize response |
| `client_id` | string | yes | Must match configured OIDC client |

**Response (`200 OK`):** Token response with `access_token`, `token_type`, `expires_in`, `refresh_token`, `id_token`.

**Errors:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `authorization_pending` | User hasn't completed auth yet |
| 400 | `slow_down` | Poll too fast — increase interval by 5s |
| 400 | `expired_token` | Device code expired |
| 400 | `access_denied` | User denied |
| 502 | `server_error` | IdP unreachable |
| 503 | `server_error` | OIDC not configured |

---

## 3. Sessions

Session lifecycle: create, list, get, batch operations, history, and statistics.

### List Sessions

```
GET /v1/sessions
```

Lists active sessions with pagination, status, and project filters. Non-admin keys see only their own sessions.

```bash
curl "http://localhost:9100/v1/sessions?page=1&limit=20&status=working" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number (1-based) |
| `limit` | integer | 20 | Items per page (max 100) |
| `status` | string | — | Filter by session status |
| `project` | string | — | Filter by workDir substring match |

**Response:**

```json
{
  "sessions": [
    { "id": "abc123", "name": "feature-auth", "status": "working", "workDir": "/project", "createdAt": 1712650800000 }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

---

### Create Session

```
POST /v1/sessions
```

Creates a new Claude Code session. Reuses an existing idle session for the same `workDir` if available. Rate limited: 120 req/min.

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "feature-auth",
    "workDir": "/home/user/my-project",
    "model": "claude-sonnet-4-20250514",
    "prompt": "Build a login page with email/password fields.",
    "systemPrompt": "You are a senior frontend developer. Use TypeScript and React."
  }'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workDir` | string | **yes** | Absolute path to working directory (must exist) |
| `name` | string | no | Session name (max 200 chars; defaults to auto-generated) |
| `label` | string | no | Alias for `name` (backward compat; `name` takes precedence) |
| `prompt` | string | no | Initial prompt to send after boot (max 100k chars) |
| `prd` | string | no | Product Requirements Document text (max 100k chars) |
| `resumeSessionId` | string (UUID) | no | Resume an existing session by UUID |
| `model` | string | no | Model name for analytics grouping (max 200 chars) |
| `claudeCommand` | string | no | Custom Claude Code CLI flags (max 500 chars, alphanumeric/safe chars only) |
| `env` | object | no | Environment variables (subject to denylist) |
| `stallThresholdMs` | number | no | Stall detection timeout (default: 300000, max: 3600000) |
| `permissionMode` | string | no | `default`, `bypassPermissions`, `plan`, `acceptEdits`, `dontAsk`, `auto` |
| `autoApprove` | boolean | no | Skip permission prompts (= `permissionMode: bypassPermissions`) |
| `parentId` | string (UUID) | no | Set parent session — child appears in parent's `/children` |
| `memoryKeys` | string[] | no | Pre-load memory entries into session (max 50) |
| `systemPrompt` | string | no | Per-session custom system prompt passed via ACP `_meta.systemPrompt` (max 100k chars; ACP only) |

> **Multi-tenancy:** Sessions inherit `tenantId` from the creating API key.

**Response (`201 Created`):**

```json
{
  "id": "abc123",
  "name": "feature-auth",
  "workDir": "/home/user/my-project",
  "status": "working",
  "createdAt": 1712650800000,
  "promptDelivery": { "delivered": true, "attempts": 1 }
}
```

**Response (`200 OK`):** Returned when reusing an existing idle session (`reused: true`).

**Errors:**

| Status | Code | Condition |
|--------|------|-----------|
| 400 | — | Invalid request body, missing `workDir`, env denylist rejection |
| 403 | `TENANT_WORKDIR_DENIED` | workDir outside tenant root |
| 422 | `CC_VERSION_TOO_OLD` | Claude Code version below minimum |
| 429 | `QUOTA_EXCEEDED` | Per-key session quota exceeded |

---

### Get Session

```
GET /v1/sessions/:id
```

Returns session details including action hints for interactive states.

```bash
curl http://localhost:9100/v1/sessions/abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Session object with `actionHints` for current interactive state.

**Errors:**

| Status | Condition |
|--------|-----------|
| 403 | Not the session owner |
| 404 | Session not found |

---

### Batch Create Sessions

```
POST /v1/sessions/batch
```

Creates up to 50 sessions in a single request. Per-key rate limit: 1 batch per 5 seconds. Global cap: 200 concurrent sessions.

```bash
curl -X POST http://localhost:9100/v1/sessions/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      {"name": "task-1", "workDir": "/project", "prompt": "Task 1"},
      {"name": "task-2", "workDir": "/project", "prompt": "Task 2"}
    ]
  }'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessions` | array | **yes** | Array of session specs (max 50, each with `workDir`) |

**Response (`201 Created`):** Batch creation result.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid workDir in one or more specs |
| 429 | Batch rate limit or global session cap exceeded |

---

### Batch Delete Sessions

```
DELETE /v1/sessions/batch
```

Kills and removes sessions by IDs or status filter. At least one of `ids` or `status` is required.

```bash
curl -X DELETE http://localhost:9100/v1/sessions/batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": ["abc123", "def456"]}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | string[] | conditional | Session UUIDs to kill (max 100) |
| `status` | string | conditional | Kill all sessions with this status |

**Response:**

```json
{
  "deleted": 2,
  "notFound": [],
  "errors": []
}
```

---

### Session History

```
GET /v1/sessions/history
```

Returns paginated history of all sessions from the audit log and live state. Non-admin keys see only their own sessions.

```bash
curl "http://localhost:9100/v1/sessions/history?page=1&limit=20&status=active" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `limit` | integer | 50 | Items per page (max 200) |
| `status` | string | — | Filter: `active`, `killed`, `unknown` |
| `ownerKeyId` | string | — | Filter by owner API key |

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

**Response:**

```json
{
  "records": [
    {
      "id": "3f47a2b1",
      "ownerKeyId": "key-abc123",
      "createdAt": 1744531200000,
      "endedAt": 1744533000000,
      "lastSeenAt": 1744533000000,
      "finalStatus": "killed",
      "source": "audit+live"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

---

### Session Statistics

```
GET /v1/sessions/stats
```

Returns aggregated session statistics. Non-admin keys see only their own.

```bash
curl http://localhost:9100/v1/sessions/stats \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "active": 3,
  "byStatus": { "working": 2, "idle": 1 },
  "totalCreated": 142,
  "totalCompleted": 87,
  "totalFailed": 12
}
```

---

## 4. Session Observability

Transcript access, read output, metrics, latency, summary, health checks, tool usage, and per-session SSE.

### Read Session Output

```
GET /v1/sessions/:id/read
```

Reads current session messages and output.

```bash
curl http://localhost:9100/v1/sessions/abc123/read \
  -H "Authorization: Bearer $TOKEN"
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

> **Session status values:** `idle`, `working`, `compacting`, `context_warning`, `waiting_for_input`, `permission_prompt`, `plan_mode`, `ask_question`, `bash_approval`, `settings`, `error`, `rate_limit`, `unknown`.

---

### Paginated Transcript

```
GET /v1/sessions/:id/transcript
```

Returns a page-based transcript for a session.

```bash
curl "http://localhost:9100/v1/sessions/abc123/transcript?page=1&limit=50&role=user" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number |
| `limit` | integer | 50 | Entries per page (max 200) |
| `role` | string | — | Filter: `user`, `assistant`, or `system` |

**Response:** Paginated transcript entries.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid `role` filter |
| 404 | Session or transcript not found |

---

### Paginated Transcript (Cursor)

```
GET /v1/sessions/:id/transcript/cursor
```

Cursor-based transcript navigation. Use `before_id` for pagination.

```bash
curl "http://localhost:9100/v1/sessions/abc123/transcript/cursor?limit=50&role=user&before_id=100" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 50 | Max entries per page (max 200) |
| `before_id` | integer | — | Cursor — entry ID to start before |
| `role` | string | — | Filter: `user`, `assistant`, or `system` |

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

---

### Per-Session Metrics

```
GET /v1/sessions/:id/metrics
```

Returns metrics for a specific session (message counts, tool calls, token usage).

```bash
curl http://localhost:9100/v1/sessions/abc123/metrics \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Session metrics object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | No metrics for this session |

---

### Per-Session Tool Usage

```
GET /v1/sessions/:id/tools
```

Returns per-tool call counts for a session, parsed from the JSONL transcript.

```bash
curl http://localhost:9100/v1/sessions/abc123/tools \
  -H "Authorization: Bearer $TOKEN"
```

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

---

### Session Latency

```
GET /v1/sessions/:id/latency
```

Returns per-operation latency metrics for a session (hook latency, state change detection, permission response, channel delivery).

```bash
curl http://localhost:9100/v1/sessions/abc123/latency \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "sessionId": "abc123",
  "realtime": { "hookLatencyMs": 45, "permissionResponseMs": 120 },
  "aggregated": { "avgHookLatencyMs": 50, "p99HookLatencyMs": 200 }
}
```

---

### Session Summary

```
GET /v1/sessions/:id/summary
```

Returns an AI-generated summary of the session parsed from transcript. Requires the session to have a JSONL transcript.

```bash
curl http://localhost:9100/v1/sessions/abc123/summary \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `200 OK` with summary text. `404` if no summary available.

---

### Session Health

```
GET /v1/sessions/:id/health
```

Returns liveness and health data for a specific session.

```bash
curl http://localhost:9100/v1/sessions/abc123/health \
  -H "Authorization: Bearer $TOKEN"
```

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

---

### Bulk Session Health

```
GET /v1/sessions/health
```

Health status for all visible sessions (owned sessions, or all if admin).

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/sessions/health \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Object keyed by session ID, each value is a health object (same shape as per-session health).

---

### Per-Session Events (SSE)

```
GET /v1/sessions/:id/events
```

Server-Sent Events stream for session-specific events (state changes, permission requests, verification results).

**Alias:** `GET /v1/sessions/:id/stream` — identical behavior.

```bash
# Step 1: Get an SSE token
curl -s -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $API_KEY"
# Step 2: Connect to the session stream
curl -N "http://localhost:9100/v1/sessions/abc123/events?token=$SSE_TOKEN"
```

**Authentication:** SSE token via query parameter (`?token=<sse-token>`) or Bearer header (`Authorization: Bearer sse_...`). Regular API keys are rejected. See [Create SSE Token](#create-sse-token) above.

**Rate limited:** Per-IP and global connection limits apply.

**Events:** `connected`, `heartbeat`, `status.*`, `permission.*`, `verification.*`, `subagent_start`, `subagent_stop`, `circuit_breaker`.

Supports `Last-Event-ID` header for replay of missed events.

---

### Get Child Sessions

```
GET /v1/sessions/:id/children
```

Returns child sessions spawned from this session (via `/fork` or `/spawn`).

```bash
curl http://localhost:9100/v1/sessions/abc123/children \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "children": [
    { "id": "def456", "windowName": "feature-auth-child", "status": "working", "createdAt": 1712651400000 }
  ]
}
```

---

### Global Tool Definitions

```
GET /v1/tools
```

Lists all available MCP tools with their schemas.

```bash
curl http://localhost:9100/v1/tools \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "tools": [
    { "name": "Bash", "category": "shell", "description": "..." }
  ],
  "categories": ["shell", "file"],
  "totalTools": 24
}
```

---

## 5. Session Control

Send messages, interrupt, escape, kill, approve, reject, answer, fork, spawn, slash commands, bash mode, and permissions.

### Send Message

```
POST /v1/sessions/:id/send
```

Sends a text message to the Claude Code session.

**Alias:** `POST /v1/sessions/:id/input` — identical behavior.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Add form validation."}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | **yes** | Message to send |

**Response:**

```json
{
  "ok": true,
  "delivered": true,
  "attempts": 1
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid request body |
| 404 | Session not found |
| 429 | Per-key token/spend quota exceeded |

---

### Interrupt Session

```
POST /v1/sessions/:id/interrupt
```

Sends `Ctrl+C` to the Claude Code session. Useful when Claude is stuck or working on the wrong task.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/interrupt \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "ok": true }`

---

### Escape Session

```
POST /v1/sessions/:id/escape
```

Sends Escape to interrupt the current running command and return to the shell prompt.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/escape \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "ok": true }`

---

### Kill Session

```
DELETE /v1/sessions/:id
```

Terminates the Claude Code process and cleans up all resources.

**Aliases:** `POST /v1/sessions/:id/kill`, `POST /v1/sessions/:id/terminate`, `POST /v1/sessions/:id/stop` — all identical.

```bash
curl -X DELETE http://localhost:9100/v1/sessions/abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "ok": true }`

---

### Approve Permission Request

```
POST /v1/sessions/:id/approve
```

Approves a pending permission request from Claude Code.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "perm-1"}'
```

**Response:** `{ "ok": true }`

---

### Reject Permission Request

```
POST /v1/sessions/:id/reject
```

Rejects a pending permission request from Claude Code.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/reject \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"permissionId": "perm-1"}'
```

**Response:** `{ "ok": true }`

---

### Answer Pending Question

```
POST /v1/sessions/:id/answer
```

Submits an answer to a pending `AskUserQuestion` prompt in a Claude Code session.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/answer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "q-001", "answer": "my-answer"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `questionId` | string | **yes** | The question ID to answer |
| `answer` | string | **yes** | The answer string |

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing `questionId` or `answer` |
| 409 | No pending question matching this `questionId` |

---

### Spawn Child Session

```
POST /v1/sessions/:id/spawn
```

Creates a child Claude Code session. The child inherits the parent's working directory unless overridden.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/spawn \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Review the changes in the parent session."}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Child session name |
| `prompt` | string | no | Initial prompt |
| `workDir` | string | no | Override working directory |
| `permissionMode` | string | no | Override permission mode |

**Response (`201 Created`):** Child session object with `promptDelivery`.

---

### Fork Session

```
POST /v1/sessions/:id/fork
```

Creates a new independent session with the same working directory and context.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/fork \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "feature-auth-experimental", "prompt": "Try alternative approach"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | no | Fork name |
| `prompt` | string | no | Initial prompt for the fork |

**Response (`201 Created`):** Forked session object with `forkedFrom` parent ID.

---

### Send Slash Command

```
POST /v1/sessions/:id/command
```

Sends a slash command to the Claude Code session. Prefixes with `/` if not provided.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/command \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "/clear"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | **yes** | Slash command to send |

**Response:** `{ "ok": true }`

---

### Bash Mode

```
POST /v1/sessions/:id/bash
```

Sends a bash command to the session. Prefixes with `!` if not provided.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/bash \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command": "npm test"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | **yes** | Bash command to execute |

**Response:** `{ "ok": true, "output": undefined }` (output capture not available in ACP mode).

---

### Quality Gate Verification

```
POST /v1/sessions/:id/verify
```

Runs the configured verification protocol on a completed session (test suite, lint, build).

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/verify \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

| Status | Condition |
|--------|-----------|
| 200 | Verification passed |
| 422 | Verification failed |
| 404 | Session not found |
| 500 | Verification error |

---

### Get Permission Policy

```
GET /v1/sessions/:id/permissions
```

Returns the current permission policy for a session.

```bash
curl http://localhost:9100/v1/sessions/abc123/permissions \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "permissionPolicy": [...] }`

---

### Update Permission Policy

```
PUT /v1/sessions/:id/permissions
```

Sets the permission policy for a session.

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"permissionPolicy": [{"allowRead": true, "allowWrite": true, "allowBash": false}]}'
```

**Request body:** Array of permission rule objects.

**Response:** `{ "permissionPolicy": [...] }`

---

### Get Permission Profile

```
GET /v1/sessions/:id/permission-profile
```

Returns the current permission profile for a session.

```bash
curl http://localhost:9100/v1/sessions/abc123/permission-profile \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "permissionProfile": { ... } }` or `{ "permissionProfile": null }`.

---

### Update Permission Profile

```
PUT /v1/sessions/:id/permission-profile
```

Sets the permission profile for a session.

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permission-profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"profile": "restricted"}'
```

**Request body:** Permission profile object (validated against `permissionProfileSchema`).

**Response:** Updated permission profile.

---

### ACP Control Actions (Pause/Resume/Intervention)

Session pause, resume, and operator intervention for multi-agent control flows.

#### Pause Session

```
POST /v1/sessions/:id/pause
```

Pauses an active session. Queued actions are held; event ingestion continues.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/pause \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Manual review needed"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reason` | string | no | Reason for pause |
| `requestedBy` | string | no | Who requested the pause |
| `idempotencyKey` | string | no | Deduplication key |
| `metadata` | object | no | Arbitrary metadata |

**Response:** Session and pause record.

**Errors:**

| Status | Condition |
|--------|-----------|
| 409 | Already paused |
| 501 | Pause store not configured |

#### Start Intervention

```
POST /v1/sessions/:id/intervention/start
```

Starts an intervention on a paused session.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/intervention/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"interventionBy": "operator-1"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `interventionBy` | string | no | Identifier of the intervening operator |

**Response:** Session and intervention record.

**Errors:**

| Status | Condition |
|--------|-----------|
| 409 | No active pause |

#### Complete Intervention

```
POST /v1/sessions/:id/intervention/complete
```

Completes an active intervention, optionally providing guidance.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/intervention/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"completedBy": "operator-1", "guidance": "Use the updated API"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `completedBy` | string | no | Who completed the intervention |
| `guidance` | string | no | Guidance text for session resume |

**Response:** Updated pause/intervention record.

**Errors:**

| Status | Condition |
|--------|-----------|
| 409 | No active intervention |

#### Resume Session

```
POST /v1/sessions/:id/resume
```

Resumes a paused or intervening session.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/resume \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resumedBy": "operator-1"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `resumedBy` | string | no | Who resumed the session |
| `resumeMetadata` | object | no | Arbitrary metadata |

**Response:** Session and pause record.

**Errors:**

| Status | Condition |
|--------|-----------|
| 409 | Session is not paused |

#### Get Intervention Status

```
GET /v1/sessions/:id/intervention
```

Returns the active or most recent intervention record for a session.

```bash
curl http://localhost:9100/v1/sessions/abc123/intervention \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Serialized intervention record.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | No intervention found |
| 501 | Pause store not configured |

#### Cancel Session

```
POST /v1/sessions/:id/cancel
```

Cancels a running ACP session. Sends a cancel signal to the ACP backend.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/cancel \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `force` | boolean | no | Force cancel even if session is busy |

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP backend not configured |

#### Approve Permission

```
POST /v1/sessions/:id/approval/approve
```

Approves a pending permission prompt (tool execution, file access, etc.).

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/approval/approve \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"approvalId": "perm-123"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `approvalId` | string | **yes** | ID of the pending approval (max 256 chars) |
| `reason` | string | no | Reason for approval (max 2048 chars) |

**Response:** Approval result from the ACP backend.

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP backend not configured |

#### Reject Permission

```
POST /v1/sessions/:id/approval/reject
```

Rejects a pending permission prompt.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/approval/reject \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"approvalId": "perm-123", "reason": "Unsafe command"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `approvalId` | string | **yes** | ID of the pending approval (max 256 chars) |
| `reason` | string | no | Reason for rejection (max 2048 chars) |

**Response:** Rejection result from the ACP backend.

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP backend not configured |

#### Get Pending Approvals

```
GET /v1/sessions/:id/approval/pending
```

Returns the current pending permission approval, if any.

```bash
curl http://localhost:9100/v1/sessions/abc123/approval/pending \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "pending": { ... } | null }`

---

## 6. Session ACP

Claude Code hook callbacks and session-scoped operations.

### Permission Hook

```
POST /v1/sessions/:id/hooks/permission
```

Called by Claude Code when a permission prompt occurs. The server routes this to the appropriate permission approver.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/permission \
  -H "Content-Type: application/json" \
  -d '{"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}, "permission_mode": "default"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_name` | string | no | Tool requesting permission |
| `tool_input` | object | no | Tool input parameters |
| `permission_mode` | string | no | Permission mode |

**Response:** `200 OK` with empty body. `404` if session not found.

---

### Stop Hook

```
POST /v1/sessions/:id/hooks/stop
```

Called when a session stops externally. Cleans up session state.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/hooks/stop \
  -H "Content-Type: application/json" \
  -d '{"stop_reason": "user_interrupt"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `stop_reason` | string | no | Reason for stop |

**Response:** `200 OK` with empty body. `404` if session not found.

---

### Screenshot

```
POST /v1/sessions/:id/screenshot
```

Captures a screenshot of a URL using Playwright. Requires Playwright installed.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/screenshot \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3000", "fullPage": true}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | **yes** | URL to screenshot |
| `fullPage` | boolean | no | Capture full page |
| `width` | number | no | Viewport width |
| `height` | number | no | Viewport height |

**Response:** `{ "image": "<base64>", "width": 1200, "height": 800 }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid URL or SSRF risk |
| 501 | Playwright not installed |

---

### Session-Scoped Memories

```
POST /v1/sessions/:id/memories
GET  /v1/sessions/:id/memories
```

Write and read memory entries scoped to a session.

```bash
# Write
curl -X POST http://localhost:9100/v1/sessions/abc123/memories \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "task-status", "value": "in-progress"}'

# Read
curl http://localhost:9100/v1/sessions/abc123/memories \
  -H "Authorization: Bearer $TOKEN"
```

**Write request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | **yes** | Memory key (max 200 chars) |
| `value` | string | **yes** | Memory value (max 100 KB) |
| `ttlSeconds` | number | no | TTL in seconds (max 30 days) |

**Read response:** `{ "sessionId": "abc123", "entries": [...] }`

---

### ACP Event Replay

#### Get Session Events

```
GET /v1/sessions/:id/events
```

Retrieves stored ACP event stream for a session. (This is the SSE endpoint documented above in Section 4.)

#### Replay Events

```
POST /v1/sessions/:id/events/replay
```

Replays events to restore terminal or UI state. Placeholder implementation.

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/events/replay \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fromSeq": 0, "toSeq": 100}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromSeq` | number | no | Start sequence |
| `toSeq` | number | no | End sequence |

**Response:** `{ "replayed": 0, "restored": false }`

#### Get Event Schema

```
GET /v1/sessions/:id/events/schema
```

Returns the ACP event schema with supported event types and field definitions.

```bash
curl http://localhost:9100/v1/sessions/abc123/events/schema \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "version": "1.0",
  "eventTypes": ["session.created", "message.sent", "permission.requested", "..."],
  "fields": { "sessionId": { "type": "string", "description": "..." }, "..." }
}
```

---

### Driver Controls

Manage driver (operator) ownership of ACP sessions. The driver has exclusive send/control access; other connections are observers.

#### Claim Driver

```
POST /v1/sessions/:id/driver/claim
```

Claims driver ownership of a session. Only one driver can be active at a time.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/driver/claim \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"holderId": "operator-1", "ttlMs": 3600000}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `holderId` | string | no | Unique holder identifier (max 256 chars). Defaults to the auth key ID. |
| `ttlMs` | number | no | Claim TTL in milliseconds (max 3,600,000 = 1 hour) |

**Response:** Claim result from the ACP backend.

**Errors:**

| Status | Condition |
|--------|------------|
| 409 | Driver already claimed (`DRIVER_CLAIMED`) |
| 501 | ACP backend not configured |

#### Release Driver

```
POST /v1/sessions/:id/driver/release
```

Releases driver ownership, allowing another operator to claim it.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/driver/release \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"holderId": "operator-1"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `holderId` | string | no | Holder to release (max 256 chars). Defaults to the auth key ID. |

**Response:** Release result from the ACP backend.

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP backend not configured |

#### Transfer Driver

```
POST /v1/sessions/:id/driver/transfer
```

Transfers driver ownership to another subscriber.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/driver/transfer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetSubscriberId": "operator-2", "reason": "Shift change"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `targetSubscriberId` | string | **yes** | Subscriber to transfer to (max 256 chars) |
| `reason` | string | no | Reason for transfer (max 2048 chars) |

**Response:** Transfer result from the ACP backend.

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP backend not configured |

#### Get Participants

```
GET /v1/sessions/:id/participants
```

Returns the current driver and observer list for a session.

```bash
curl http://localhost:9100/v1/sessions/abc123/participants \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "driver": { "holderId": "operator-1", "claimedAt": "2026-05-07T00:00:00Z" },
  "observers": [],
  "activeCount": 1
}
```

When ACP backend is not configured: `{ "driver": null, "observers": [], "activeCount": 0 }`

---

### Terminal REST API

ACP terminal debug endpoints for programmatic terminal access (open, input, resize, reconnect, close).
These complement the WebSocket terminal streaming documented in the WebSocket section below.

#### Open Terminal

```
POST /v1/sessions/:id/terminal/open
```

Opens a new terminal session for an ACP session.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/terminal/open \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:** Terminal open result (contains `terminalId`).

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP terminal extension not supported (`TERMINAL_UNSUPPORTED`) |
| 503 | ACP runtime not active (`RUNTIME_UNAVAILABLE`) |

#### Send Terminal Input

```
POST /v1/sessions/:id/terminal/input
```

Sends raw input data to an open terminal.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/terminal/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "term-1", "data": "ls -la\n"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `terminalId` | string | **yes** | Terminal session ID |
| `data` | string | **yes** | Raw input data (max 4096 chars) |

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP terminal bridge not configured |

#### Resize Terminal

```
POST /v1/sessions/:id/terminal/resize
```

Resizes the terminal viewport.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/terminal/resize \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "term-1", "columns": 120, "rows": 40}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `terminalId` | string | **yes** | Terminal session ID |
| `columns` | number | **yes** | Column count (1–512) |
| `rows` | number | **yes** | Row count (1–512) |

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP terminal bridge not configured |

#### Reconnect Terminal

```
POST /v1/sessions/:id/terminal/reconnect
```

Reconnects to an existing terminal session (e.g., after connection drop).

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/terminal/reconnect \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "term-1"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `terminalId` | string | **yes** | Terminal session ID to reconnect |

**Response:** Reconnection result with current terminal state.

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP terminal bridge not configured |

#### Close Terminal

```
POST /v1/sessions/:id/terminal/close
```

Closes an open terminal session.

| Role | Required |
|------|----------|
| admin, operator (send) | Yes |

```bash
curl -X POST http://localhost:9100/v1/sessions/abc123/terminal/close \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"terminalId": "term-1"}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `terminalId` | string | **yes** | Terminal session ID to close |

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|------------|
| 501 | ACP terminal bridge not configured |

---

## 7. Analytics

Cost breakdowns, token usage, and rate-limit analytics.

### Get Analytics Summary

```
GET /v1/analytics/summary
```

Returns aggregated session, token, cost, duration, and error-rate data from the MetricsCache.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/analytics/summary \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "sessionVolume": [{ "date": "2026-04-22", "created": 42 }],
  "tokenUsageByModel": [
    { "model": "claude-sonnet-4-20250514", "inputTokens": 2400000, "outputTokens": 800000, "cacheCreationTokens": 100000, "cacheReadTokens": 500000, "estimatedCostUsd": 52.40 }
  ],
  "costTrends": [{ "date": "2026-04-22", "cost": 24.50, "sessions": 42 }],
  "topApiKeys": [{ "keyId": "ak_abc123", "keyName": "ci-bot", "sessions": 30, "messages": 500, "estimatedCostUsd": 18.20 }],
  "durationTrends": [{ "date": "2026-04-22", "avgDurationSec": 245, "count": 38 }],
  "errorRates": { "totalSessions": 500, "failedSessions": 12, "failureRate": 0.024, "permissionPrompts": 85, "approvals": 72, "autoApprovals": 45 },
  "generatedAt": "2026-04-22T12:00:00.000Z"
}
```

---

### Get Cost Breakdown

```
GET /v1/analytics/costs
```

Returns aggregated cost breakdown by model, key, and daily trends.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/analytics/costs \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "totalCostUsd": 152.38,
  "totalSessions": 87,
  "byModel": [
    { "model": "claude-sonnet-4-20250514", "inputTokens": 3200000, "outputTokens": 1100000, "cacheCreationTokens": 150000, "cacheReadTokens": 600000, "estimatedCostUsd": 98.50, "sessions": 52 }
  ],
  "byKey": [
    { "keyId": "ak_abc123", "keyName": "ci-bot", "estimatedCostUsd": 72.30, "sessions": 35, "messages": 500 }
  ],
  "dailyTrends": [
    { "date": "2026-04-22", "estimatedCostUsd": 24.50, "sessions": 12 }
  ],
  "generatedAt": "2026-04-28T06:00:00.000Z"
}
```

---

### Get Token Usage

```
GET /v1/analytics/tokens
```

Returns aggregated token usage with per-model distribution and daily cost trends.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/analytics/tokens \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "totalTokens": 7500000,
  "totalCostUsd": 152.38,
  "modelDistribution": [
    { "model": "claude-sonnet-4-20250514", "inputTokens": 3200000, "outputTokens": 1100000, "cacheCreationTokens": 150000, "cacheReadTokens": 600000, "estimatedCostUsd": 98.50 }
  ],
  "dailyCost": [
    { "date": "2026-04-22", "estimatedCostUsd": 24.50, "sessions": 12 }
  ],
  "generatedAt": "2026-04-28T06:00:00.000Z"
}
```

---

### Get Rate-Limit Analytics

```
GET /v1/analytics/rate-limits
```

Returns per-key quota usage, global rate-limit config, and a session forecast.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/analytics/rate-limits \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "global": { "max": 600, "timeWindowMs": 60000 },
  "perKey": [
    { "keyId": "ak_abc123", "keyName": "ci-bot", "activeSessions": 3, "maxSessions": 10, "tokensInWindow": 450000, "maxTokens": 1000000, "spendInWindowUsd": 8.50, "maxSpendUsd": 50.00, "windowMs": 3600000 }
  ],
  "forecast": { "estimatedSessionsRemaining": 7, "bottleneck": "concurrent_sessions" },
  "generatedAt": "2026-04-28T06:00:00.000Z"
}
```

---

## 8. Monitoring

Prometheus metrics, aggregated metrics, alert management, and channel health.

### Global Metrics

```
GET /v1/metrics
```

Returns token usage tracking and cost estimation across all sessions.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/metrics \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Global metrics object with session counts, token totals, and cost estimates.

---

### Aggregated Metrics

```
GET /v1/metrics/aggregate
```

Returns aggregated metrics with time-range filtering and grouping. Rate limited: 60 req/min.

| Role | Required |
|------|----------|
| admin, operator | Yes (viewer gets 403) |

```bash
curl "http://localhost:9100/v1/metrics/aggregate?from=2026-04-01T00:00:00Z&to=2026-04-28T23:59:59Z&groupBy=day" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `from` | ISO 8601 | 7 days ago | Start timestamp |
| `to` | ISO 8601 | now | End timestamp |
| `groupBy` | string | `day` | Grouping: `day`, `hour`, or `key` |

**Response:** Aggregated metrics by time period or API key.

---

### Test Alert Webhook

```
POST /v1/alerts/test
```

Tests webhook delivery. Returns `delivered: true` if the webhook responds with 2xx.

| Role | Required |
|------|----------|
| admin, operator | Yes |

```bash
curl -X POST http://localhost:9100/v1/alerts/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://example.com/alerts", "secret": "test-secret"}'
```

**Response:**

```json
{
  "success": true,
  "delivered": true
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 502 | Alert delivery failed |

---

### Get Alert Statistics

```
GET /v1/alerts/stats
```

Returns alert counts for the last 24 hours and totals.

| Role | Required |
|------|----------|
| admin, operator, viewer | Yes |

```bash
curl http://localhost:9100/v1/alerts/stats \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "last24h": { "sessionFailures": 0, "deadSessions": 0, "processCrashes": 0 },
  "totals": { "sessionFailures": 2, "deadSessions": 1, "processCrashes": 0 }
}
```

---

### Channel Health

```
GET /v1/channels/health
```

Returns health status for all connected channels (Telegram, Slack, Email, webhooks).

```bash
curl http://localhost:9100/v1/channels/health \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Array of channel health objects:

```json
[
  { "channel": "webhook", "healthy": true, "lastSuccess": "2026-04-22T10:00:00Z", "lastError": null, "pendingCount": 0 }
]
```

---

## 9. Audit

Immutable, hash-chained audit log with CSV/NDJSON export.

### Audit Log

```
GET /v1/audit
```

Returns audit log records with cursor-based or offset-based pagination, time-range filters, and multi-format export. **Admin only.** Rate limited: 30 req/min.

```bash
curl "http://localhost:9100/v1/audit?action=session.create&from=2026-04-13T00:00:00Z&limit=50" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actor` | string | — | Filter by actor label (backward compat) |
| `actorKeyId` | string | — | Filter by actor key ID (takes precedence over `actor`) |
| `action` | string | — | Filter by action (e.g. `session.create`, `session.kill`) |
| `sessionId` | string | — | Filter by session ID |
| `from` | ISO 8601 | — | Inclusive lower timestamp bound |
| `to` | ISO 8601 | — | Inclusive upper timestamp bound |
| `cursor` | string | — | Pagination cursor (64-char hex hash) |
| `offset` | integer | — | Offset (triggers export record format) |
| `limit` | integer | 100 | Max records (max 1000) |
| `reverse` | boolean | false | Return newest first |
| `verify` | boolean | false | Include chain verification metadata |
| `format` | string | `json` | `json`, `csv`, or `ndjson` |

**JSON response:**

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
  "filters": { "actor": null, "action": "session.create", "sessionId": null, "from": "2026-04-13T00:00:00Z", "to": null },
  "pagination": { "limit": 50, "hasMore": false, "nextCursor": null, "reverse": false },
  "chain": { "count": 1, "firstHash": "...", "lastHash": "...", "badgeHash": "", "firstTs": "...", "lastTs": "..." }
}
```

**CSV/NDJSON export:** Set `format=csv` or `format=ndjson`. Response includes chain metadata in headers (`X-Aegis-Audit-First-Hash`, `X-Aegis-Audit-Last-Hash`, `X-Aegis-Audit-Chain-Badge`).

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid cursor, bad date format, or `from` > `to` |
| 503 | Audit logger not enabled |

---

## 10. Pipelines & Templates

Multi-stage session pipelines and reusable session templates.

### Create Pipeline

```
POST /v1/pipelines
```

Creates a multi-stage pipeline that runs sessions sequentially.

```bash
curl -X POST http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "build-and-test",
    "workDir": "/home/user/my-project",
    "stages": [
      {"name": "build", "prompt": "Build the project"},
      {"name": "test", "prompt": "Run tests and fix failures"}
    ]
  }'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **yes** | Pipeline name |
| `workDir` | string | **yes** | Working directory |
| `stages` | array | **yes** | Array of stage objects with `name`/`prompt` and optional `workDir` |

**Response (`201 Created`):** Pipeline object with ID and status.

> **State Persistence:** Pipeline runs are persisted to the `StateStore` and survive Aegis restarts.

---

### List Pipelines

```
GET /v1/pipelines
```

Lists all registered pipelines.

```bash
curl http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Array of pipeline objects.

---

### Get Pipeline

```
GET /v1/pipelines/:id
```

Returns status and details of a specific pipeline.

```bash
curl http://localhost:9100/v1/pipelines/pipe-123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Pipeline object with stage statuses.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Pipeline not found |

---

### List Templates

```
GET /v1/templates
```

Lists all registered session templates.

```bash
curl http://localhost:9100/v1/templates \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Array of template objects.

---

### Create Template

```
POST /v1/templates
```

Creates a reusable session template with optional `{{variable}}` substitution. Rate limited: 60 req/min.

```bash
curl -X POST http://localhost:9100/v1/templates \
  -H "Authorization: Bearer $TOKEN" \
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

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | **yes** | Template name (max 100 chars) |
| `description` | string | no | Description (max 500 chars) |
| `sessionId` | string (UUID) | no | Copy settings from an existing session |
| `workDir` | string | conditional | Working directory (required if no `sessionId`) |
| `prompt` | string | no | Template prompt with `{{variable}}` substitution (max 100k chars) |
| `claudeCommand` | string | no | Claude Code CLI arguments (max 500 chars) |
| `env` | object | no | Environment variables map |
| `stallThresholdMs` | number | no | Stall timeout (1–3600000ms) |
| `permissionMode` | string | no | `default`, `bypassPermissions`, `plan`, `acceptEdits`, `dontAsk`, `auto` |
| `autoApprove` | boolean | no | Skip permission prompts |
| `memoryKeys` | string[] | no | Pre-load memory entries (max 50) |

**Response (`201 Created`):** Template object.

---

### Get Template

```
GET /v1/templates/:id
```

Returns a single template by ID.

```bash
curl http://localhost:9100/v1/templates/tpl-abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Template object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Template not found |

---

### Update Template

```
PUT /v1/templates/:id
```

Partially updates a template. Only include fields to change.

```bash
curl -X PUT http://localhost:9100/v1/templates/tpl-abc123 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description", "prompt": "New prompt {{var}}"}'
```

**Request body:** Partial template object (any fields from create schema).

**Response:** Updated template object.

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Template not found |

---

### Delete Template

```
DELETE /v1/templates/:id
```

Deletes a template by ID.

```bash
curl -X DELETE http://localhost:9100/v1/templates/tpl-abc123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Template not found |

---

## 11. Memory Bridge

Key-value memory store for cross-session context sharing.

> **Prerequisite:** Memory endpoints require `memoryBridge.enabled: true` in your Aegis config. Without this setting, the routes are not registered and will return 404.
>
> ```yaml
> memoryBridge:
>   enabled: true
>   persistPath: ~/.aegis/memory.json   # optional
>   reaperIntervalMs: 60000             # optional
> ```

### Set Memory Entry

```
POST /v1/memory
```

Writes a memory entry with optional TTL.

```bash
curl -X POST http://localhost:9100/v1/memory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "project-context", "value": "Using Fastify v5", "ttlSeconds": 3600}'
```

**Request body:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | **yes** | Memory key (max 256 chars) |
| `value` | string | **yes** | Memory value (max 100 KB) |
| `ttlSeconds` | number | no | TTL in seconds (max 30 days) |

**Response:** `{ "ok": true, "entry": { ... } }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid key format |
| 413 | Value exceeds maximum size |

---

### Get Memory Entry

```
GET /v1/memory/:key
```

Reads a memory entry by key.

```bash
curl http://localhost:9100/v1/memory/project-context \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "entry": { "key": "project-context", "value": "Using Fastify v5", "ttl": 3600 } }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Key not found |

---

### List Memory Entries

```
GET /v1/memory
```

Lists all entries, optionally filtered by prefix.

```bash
curl "http://localhost:9100/v1/memory?prefix=project-" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `prefix` | string | Filter entries by key prefix |

**Response:** `{ "entries": [...] }`

---

### Delete Memory Entry

```
DELETE /v1/memory/:key
```

Deletes a memory entry by key.

```bash
curl -X DELETE http://localhost:9100/v1/memory/project-context \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** `{ "ok": true }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 404 | Key not found |

---

### Scoped Memory Retrieval

```
GET /v1/memories
```

Lists memory entries filtered by scope prefix.

```bash
curl "http://localhost:9100/v1/memories?scope=project" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scope` | string | **yes** | One of: `project`, `user`, `team` |

**Response:** `{ "scope": "project", "entries": [...] }`

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid scope |

---

## 12. Webhooks

Claude Code hook receiver and webhook delivery inspection.

### Generic Hook Callback

```
POST /v1/hooks/:eventName
```

Inbound callback endpoint for Claude Code hooks. Requires hook secret if configured.

```bash
curl -X POST "http://localhost:9100/v1/hooks/Stop?sessionId=<session-uuid>" \
  -H "X-Hook-Secret: <hook-secret>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Authentication:**
- Send session ID via `X-Session-Id` header (or `sessionId` query fallback).
- Send hook secret via `X-Hook-Secret` header.
- Query-param `secret` is deprecated (logs warning unless `AEGIS_HOOK_SECRET_HEADER_ONLY=true`).

**Path parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `eventName` | string | Hook event name (e.g. `Stop`, `PreToolUse`, `PermissionRequest`) |

**Request body:** Validated against `hookBodySchema`. Varies by event type.

**Response:** `200 OK` with event-specific response body. Decision events (`PreToolUse`, `PermissionRequest`) return approval/rejection.

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Unknown event name, missing session ID, invalid body |
| 401 | Invalid hook secret |
| 404 | Session not found |

---

### Dead-Letter Queue

```
GET /v1/webhooks/dead-letter
```

Lists failed webhook deliveries across all channels for inspection and retry.

```bash
curl http://localhost:9100/v1/webhooks/dead-letter \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Array of failed delivery records.

---

### Webhook Delivery History

```
GET /v1/hooks/:id/deliveries
```

Returns delivery history for a specific webhook.

```bash
curl http://localhost:9100/v1/hooks/hook-abc123/deliveries \
  -H "Authorization: Bearer $TOKEN"
```

**Response:** Array of delivery records with timestamps and status codes.

---

## 13. Events (SSE Stream)

> **⚠️ Auth required:** SSE endpoints do not accept regular Bearer tokens. You must first obtain an SSE token via `POST /v1/auth/sse-token`, then pass it either as a query parameter (`?token=<sse-token>`) or as a Bearer header (`Authorization: Bearer sse_...`). Using a regular API key returns `401 Unauthorized — SSE token required for event streams`.

### Global SSE Event Stream

```
GET /v1/events
```

Server-Sent Events stream aggregating events from **all** active sessions.

```bash
# Step 1: Get an SSE token
curl -s -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $API_KEY"
# Step 2: Connect to the stream
curl -N "http://localhost:9100/v1/events?token=$SSE_TOKEN"
```

**Authentication:** SSE token via query parameter (`?token=<sse-token>`) or Bearer header (`Authorization: Bearer sse_...`). Regular API keys are rejected.

**Event types:** `connected`, `heartbeat`, `session.created`, `session.idle`, `session.working`, `session.stalled`, `session.killed`, `permission.requested`, `permission.granted`, `permission.denied`, `message.user`, `status.*`, `verification.*`, `subagent_start`, `subagent_stop`, `circuit_breaker`.

**Rate limited:** Per-IP and global connection limits apply.

**Event replay:** Supports `Last-Event-ID` header for replay of missed events.

**Tenant scoping:** Events are filtered by the caller's tenant. Admin/master keys see all events.

**Connection events:**

```
data: {"event":"connected","timestamp":"2026-04-22T10:00:00.000Z","data":{"activeSessions":5}}
```

---

## Usage & Metering

Billing and metering data with time-range filtering.

### Get Total Usage Summary

```
GET /v1/usage
```

Returns total usage across all sessions with optional time-range and key filters.

| Role | Required |
|------|----------|
| admin, operator | Yes |

```bash
curl "http://localhost:9100/v1/usage?from=2026-04-01T00:00:00Z&to=2026-04-28T23:59:59Z" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO 8601 | Start of time window (inclusive) |
| `to` | ISO 8601 | End of time window (inclusive) |
| `keyId` | string | Filter to a specific API key |

**Response:**

```json
{
  "schema_version": 1,
  "totalSessions": 150,
  "totalTokens": 4200000,
  "totalSpendUsd": 84.50,
  "rate_tiers": [
    { "tier": "free", "tokensIncluded": 100000, "pricePerMillionTokens": 0 },
    { "tier": "standard", "tokensIncluded": 1000000, "pricePerMillionTokens": 20 }
  ]
}
```

---

### Get Per-Key Usage Breakdown

```
GET /v1/usage/by-key
```

Returns usage broken down by API key. **Admin only.**

```bash
curl "http://localhost:9100/v1/usage/by-key?from=2026-04-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**

```json
{
  "schema_version": 1,
  "keys": [
    { "keyId": "ak_abc123", "keyName": "ci-bot", "sessions": 80, "tokens": 2200000, "spendUsd": 44.00 }
  ],
  "total_keys": 1
}
```

---

### Get Per-Session Usage

```
GET /v1/usage/sessions/:id
```

Returns usage records for a specific session.

| Role | Required |
|------|----------|
| admin, operator | Yes |

```bash
curl "http://localhost:9100/v1/usage/sessions/sess-xyz?from=2026-04-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `from` | ISO 8601 | Start of time window |
| `to` | ISO 8601 | End of time window |

**Response:**

```json
{
  "schema_version": 1,
  "sessionId": "sess-xyz",
  "records": [
    { "timestamp": "2026-04-22T10:30:00.000Z", "inputTokens": 1500, "outputTokens": 800, "costUsd": 0.05 }
  ],
  "total_records": 1
}
```

---

### Get Rate Tier Configuration

```
GET /v1/usage/tiers
```

Returns the current rate tier configuration. No auth required.

```bash
curl http://localhost:9100/v1/usage/tiers
```

**Response:**

```json
{
  "schema_version": 1,
  "tiers": [
    { "tier": "free", "tokensIncluded": 100000, "pricePerMillionTokens": 0 },
    { "tier": "standard", "tokensIncluded": 1000000, "pricePerMillionTokens": 20 }
  ]
}
```

---

## Dashboard Authentication

Browser-based session management for the Aegis dashboard.

### OIDC Login

```
GET /auth/login
```

Initiates OIDC login flow. Redirects to the IdP authorization endpoint.

---

### OIDC Callback

```
GET /auth/callback
```

Handles the OIDC callback. Sets a dashboard session cookie and redirects to `/dashboard/`.

---

### Session Info

```
GET /auth/session
```

Returns current dashboard session info (OIDC or token-based).

```bash
curl http://localhost:9100/auth/session \
  -H "Cookie: aegis-dashboard-session=..."
```

**Response:**

```json
{
  "oidcAvailable": true,
  "authMethod": "oidc",
  "authenticated": true,
  "userId": "...",
  "role": "admin"
}
```

---

### Logout

```
POST /auth/logout
```

Terminates the dashboard session. Clears the session cookie. May redirect to IdP end-session URL.

```bash
curl -X POST http://localhost:9100/auth/logout \
  -H "Cookie: aegis-dashboard-session=..."
```

**Response:** `204 No Content` or `303 See Other` (IdP logout redirect).

---

## WebSocket Terminal Streaming

Aegis streams live terminal output to connected dashboard clients over WebSocket.

**Endpoint:** `WS /v1/sessions/:id/terminal`

### Connection

```js
const ws = new WebSocket('ws://localhost:9100/v1/sessions/abc123/terminal', {
  headers: { Authorization: 'Bearer your-token' }
});
```

### Authentication

- **Browser clients:** Send `{ type: "auth", token: "..." }` as the first message (within 5 seconds).
- **Non-browser clients:** `Authorization: Bearer <token>` header.
- Per-connection rate limiting: 10 messages/second.

### Message Protocol

#### Server → Client

| Type | Fields | Description |
|------|--------|-------------|
| `pane` | `content` | Full pane catchup (sent on connect) |
| `stream` | `data` | Incremental PTY output chunk |
| `status` | `status` | Current UI state (`idle`, `working`, etc.) |
| `error` | `message` | Error notification |

#### Client → Server

| Type | Fields | Description |
|------|--------|-------------|
| `auth` | `token` | Authentication handshake (first message) |
| `input` | `text` | Send keystrokes to the session |
| `resize` | `cols`, `rows` | Resize the terminal |

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

## Convenience Aliases: `/v1/keys`

| Alias | Canonical | Method |
|---|---|---|
| `/v1/keys` | `/v1/auth/keys` | `GET` (list), `POST` (create) |
| `/v1/keys/:id` | `/v1/auth/keys/:id` | `DELETE` (revoke) |

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

### HTTP Status Codes

| Status Code | Meaning |
|---|---|
| 200 | Success |
| 201 | Created |
| 204 | No Content (successful deletion/logout) |
| 400 | Bad request (invalid parameters) |
| 401 | Unauthorized (missing or invalid token) |
| 403 | Forbidden (valid token but insufficient permissions) |
| 404 | Session or resource not found |
| 409 | Conflict (already exists, wrong state) |
| 422 | Unprocessable entity (validation failed) |
| 429 | Rate limited or quota exceeded |
| 500 | Internal server error |
| 501 | Not implemented (feature not available in current mode) |
| 502 | Bad gateway (upstream/IdP failure) |
| 503 | Service unavailable (feature not configured) |
| 504 | Gateway timeout |

### Aegis Error Codes

Every error response includes an Aegis-specific `code` field for programmatic handling:

| Error Code | HTTP Status | Meaning |
|---|---|---|
| `SESSION_NOT_FOUND` | 404 | Session deleted, wrong state, or never existed |
| `SESSION_CREATE_FAILED` | 500 | Claude Code launch failed |
| `PERMISSION_REJECTED` | 409 | Permission request answered with reject |
| `ACM_TIMEOUT` | 504 | Session operation timed out (retryable) |
| `ACM_ERROR` | 500 | Session operation failed |
| `VALIDATION_ERROR` | 422 | Request body or parameters failed Zod validation |
| `AUTH_ERROR` | 401 | Authentication failed |
| `RATE_LIMITED` | 429 | Per-key rate limit exceeded |
| `QUOTA_EXCEEDED` | 429 | Per-key session/token/spend quota exceeded |
| `NETWORK_ERROR` | 502 | Transient network or I/O failure (retryable) |
| `INTERNAL_ERROR` | 500 | Unexpected internal error |
| `TENANT_WORKDIR_DENIED` | 403 | workDir outside tenant root |
| `CC_VERSION_TOO_OLD` | 422 | Claude Code version below minimum |
| `ALREADY_PAUSED` | 409 | Session already paused |
| `NO_ACTIVE_PAUSE` | 409 | No active pause to start intervention |
| `NO_ACTIVE_INTERVENTION` | 409 | No active intervention to complete |
| `NOT_PAUSED` | 409 | Session not paused for resume |

---

## Session Hooks

### Circuit Breaker (StopFailure Protection)

When a user-defined Stop hook returns `ok: false`, Claude Code retries in a loop — burning the session. Aegis detects rapid `StopFailure` events and trips a **circuit breaker**, returning `ok: true` to break the retry loop.

**Behavior:**
- After `HOOK_CIRCUIT_BREAKER_MAX` failures within `HOOK_CIRCUIT_BREAKER_WINDOW_MS`, the breaker trips.
- Aegis returns `{ ok: true }` and emits a `circuit_breaker` SSE event.
- The breaker stays tripped for the session's lifetime (no auto-reset).
- A successful `Stop` hook event resets the breaker.

| Variable | Default | Range | Description |
|---|---|---|---|
| `HOOK_CIRCUIT_BREAKER_MAX` | `5` | 1–100 | Failures before breaker trips |
| `HOOK_CIRCUIT_BREAKER_WINDOW_MS` | `60000` | 1000–3600000 | Sliding window in milliseconds |

### Premature Termination Detection

Background agents can terminate mid-thought due to upstream turn limits. Aegis detects this by tracking tool use counts:

- **Detection rule:** Session ends with `toolUseCount > 0` AND `toolUseCount <= threshold` AND `duration >= minimum`.
- **Default thresholds:** `<= 30` tool uses, `>= 30,000ms` (30s) duration.

| Variable | Default | Description |
|----------|---------|-------------|
| `PREMATURE_TERMINATION_MIN_TOOLS` | `30` | Max tool uses before flagging |
| `PREMATURE_TERMINATION_MIN_DURATION_MS` | `30000` | Minimum session duration (ms) |

### Hook Payload Size Warning

Claude Code silently truncates hook payloads exceeding ~2KB. Aegis logs a warning and emits a `system` SSE event when any hook payload exceeds 1.5KB. Keep hook payloads under 1.5KB to avoid truncation.

---

## Multi-Tenancy

Aegis supports multi-tenant deployments via `tenantId` on API keys, sessions, and audit records.

- **API keys** can be assigned a `tenantId` at creation.
- **Sessions** inherit `tenantId` from the creating API key.
- **Non-admin keys** are scoped to their tenant.
- **Admin keys** bypass tenant scoping.

### Tenant Workdir Namespacing

Restrict each tenant's sessions to a specific directory root:

```yaml
tenantWorkdirs:
  tenant-a:
    root: /tenants/tenant-a
    allowedPaths: [projects, workspace]
```

Cross-tenant violations return `403 Forbidden` with audit trail.

See [ADR-0025](./adr/0025-tenant-aware-authorization-model.md) for the design decision.
