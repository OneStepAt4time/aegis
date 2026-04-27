# API Quick Reference

A compact summary of all Aegis API endpoints. For detailed documentation, examples, and schemas, see [API Reference](api-reference.md) and [API Examples](api-examples.md).

**Base URL:** `http://localhost:9100`  
**Auth:** `Authorization: Bearer $AEGIS_AUTH_TOKEN` — required unless marked **No Auth**.

---

## Sessions

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/sessions` | Bearer | List active sessions with pagination |
| `POST` | `/v1/sessions` | Bearer | Create a new Claude Code session |
| `GET` | `/v1/sessions/history` | Bearer | Paginated session history |
| `GET` | `/v1/sessions/stats` | Bearer | Aggregated session statistics |
| `GET` | `/v1/sessions/health` | Bearer | Bulk health check for all sessions |
| `DELETE` | `/v1/sessions/batch` | Bearer | Kill and remove sessions by ID or status |

## Session (by ID)

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/sessions/{id}` | Bearer | Get session details |
| `GET` | `/v1/sessions/{id}/health` | Bearer | Single session health check |

## Session Actions

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/sessions/{id}/send` | Bearer | Send a message |
| `POST` | `/v1/sessions/{id}/command` | Bearer | Send a slash command |
| `POST` | `/v1/sessions/{id}/bash` | Bearer | Execute a bash command |
| `POST` | `/v1/sessions/{id}/escape` | Bearer | Send Escape key |
| `POST` | `/v1/sessions/{id}/interrupt` | Bearer | Send Ctrl+C (interrupt) |
| `DELETE` | `/v1/sessions/{id}` | Bearer | Kill session |
| `GET` | `/v1/sessions/{id}/pane` | Bearer | Capture raw terminal pane |
| `GET` | `/v1/sessions/{id}/children` | Bearer | Get child sessions |
| `POST` | `/v1/sessions/{id}/spawn` | Bearer | Spawn a child session |
| `POST` | `/v1/sessions/{id}/fork` | Bearer | Fork the session |
| `POST` | `/v1/sessions/{id}/approve` | Bearer | Approve permission request |
| `POST` | `/v1/sessions/{id}/reject` | Bearer | Reject permission request |
| `POST` | `/v1/sessions/{id}/answer` | Bearer | Answer a pending question |

## Session Data

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/sessions/{id}/read` | Bearer | Read recent messages |
| `GET` | `/v1/sessions/{id}/transcript` | Bearer | Paginated transcript |
| `GET` | `/v1/sessions/{id}/transcript/cursor` | Bearer | Cursor-based transcript replay |
| `GET` | `/v1/sessions/{id}/summary` | Bearer | AI-generated session summary |
| `GET` | `/v1/sessions/{id}/metrics` | Bearer | Per-session metrics (tokens, duration) |
| `GET` | `/v1/sessions/{id}/latency` | Bearer | Latency percentiles (p50/p95/p99) |
| `GET` | `/v1/sessions/{id}/tools` | Bearer | Per-session tool usage counts |
| `POST` | `/v1/sessions/{id}/screenshot` | Bearer | Capture screenshot (Playwright) |
| `POST` | `/v1/sessions/{id}/verify` | Bearer | Run verification protocol |
| `GET` | `/v1/sessions/{id}/events` | Bearer | Per-session SSE event stream |

## Permissions

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/sessions/{id}/permissions` | Bearer | Get permission policy |
| `PUT` | `/v1/sessions/{id}/permissions` | Bearer | Set permission policy |
| `GET` | `/v1/sessions/{id}/permission-profile` | Bearer | Get permission profile |
| `PUT` | `/v1/sessions/{id}/permission-profile` | Bearer | Set permission profile |

## Hooks

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/sessions/{id}/hooks/permission` | Bearer | Permission hook callback |
| `POST` | `/v1/sessions/{id}/hooks/stop` | Bearer | Session stop hook callback |
| `POST` | `/v1/hooks/{eventName}` | Bearer | Generic hook event endpoint |

## Memory Bridge

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/memory` | Bearer | Write a memory entry |
| `GET` | `/v1/memory` | Bearer | List memory entries |
| `GET` | `/v1/memory/{key}` | Bearer | Get a memory entry |
| `DELETE` | `/v1/memory/{key}` | Bearer | Delete a memory entry |
| `POST` | `/v1/sessions/{id}/memories` | Bearer | Write session-scoped memory |
| `GET` | `/v1/sessions/{id}/memories` | Bearer | List session-scoped memories |

## Authentication

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/auth/verify` | No Auth | Verify bearer token |
| `POST` | `/v1/auth/keys` | Bearer | Create API key |
| `GET` | `/v1/auth/keys` | Bearer | List API keys |
| `DELETE` | `/v1/auth/keys/{id}` | Bearer | Revoke API key |
| `POST` | `/v1/auth/keys/{id}/rotate` | Bearer | Rotate API key |
| `POST` | `/v1/auth/sse-token` | Bearer | Generate SSE auth token |

## Templates

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/templates` | Bearer | Create session template |
| `GET` | `/v1/templates` | Bearer | List templates |
| `GET` | `/v1/templates/{id}` | Bearer | Get template |
| `PUT` | `/v1/templates/{id}` | Bearer | Update template |
| `DELETE` | `/v1/templates/{id}` | Bearer | Delete template |

## Pipelines

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `POST` | `/v1/sessions/batch` | Bearer | Batch create up to 50 sessions |
| `POST` | `/v1/pipelines` | Bearer | Create pipeline |
| `GET` | `/v1/pipelines` | Bearer | List pipelines |
| `GET` | `/v1/pipelines/{id}` | Bearer | Get pipeline status |

## Health

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/health` | No Auth | Server health check |
| `POST` | `/v1/handshake` | No Auth | Protocol handshake |
| `GET` | `/v1/swarm` | Bearer | Swarm awareness scan |
| `GET` | `/v1/alerts/stats` | Bearer | Alert manager stats |
| `POST` | `/v1/alerts/test` | Bearer | Fire test alert |
| `GET` | `/v1/webhooks/dead-letter` | Bearer | Webhook dead letter queue |
| `GET` | `/v1/channels/health` | Bearer | Channel health reporting |

## Metrics

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/metrics` | Bearer | Prometheus-format global metrics |
| `GET` | `/v1/audit` | Bearer | Audit log (JSON/CSV/NDJSON) |
| `GET` | `/v1/diagnostics` | Bearer | Diagnostics channel |
| `GET` | `/v1/tools` | Bearer | Global MCP tool definitions |

## Events

| Method | Path | Auth | Summary |
|--------|------|------|---------|
| `GET` | `/v1/events` | Bearer | Global SSE event stream (all sessions) |

---

## Common Response Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Validation error |
| `401` | Unauthorized — invalid or missing token |
| `403` | Forbidden — insufficient role |
| `404` | Not found |
| `409` | Conflict |
| `413` | Value too large |
| `422` | Unprocessable (e.g., Claude Code too old) |
| `429` | Rate limited |
| `500` | Internal server error |

## Rate Limit Headers

Every response includes:

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 27
X-RateLimit-Reset: 1713782460
```

See [API Rate Limiting](api-rate-limiting.md) for full documentation.

## See Also

- [API Reference](api-reference.md) — detailed endpoint docs with schemas
- [API Examples](api-examples.md) — curl examples for all 58 endpoints
- [Authentication](api-reference.md#authentication) — auth setup
- [Rate Limiting](api-rate-limiting.md) — rate limits and headers
- [Webhook Retry](webhook-retry.md) — webhook delivery with retry
