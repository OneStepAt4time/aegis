# Real-Time Events (SSE)

Aegis streams real-time events via Server-Sent Events (SSE). This guide covers how to authenticate, connect, and consume the event streams — whether you're building a dashboard, writing a CLI tool, or integrating with external systems.

## Quick Start

```bash
# 1. Get an SSE token (requires API key)
SSE_TOKEN=$(curl -s -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $API_KEY" | jq -r '.token')

# 2. Connect to the global event stream (all sessions)
curl -N "http://localhost:9100/v1/events?token=$SSE_TOKEN"

# 3. Or connect to a single session
curl -N "http://localhost:9100/v1/sessions/abc123/events?token=$SSE_TOKEN"
```

## Authentication

SSE endpoints **do not accept regular API keys**. You must obtain a short-lived SSE token first.

### Create an SSE Token

```
POST /v1/auth/sse-token
```

```bash
curl -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer $API_KEY"
```

**Response:**

```json
{
  "token": "sse_abc123...",
  "expiresIn": 300
}
```

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | `sse_`-prefixed token for SSE stream auth |
| `expiresIn` | number | Token lifetime in seconds |

**Limits:** Max 10 outstanding SSE tokens per API key. Returns `429` if exceeded.

### Using the Token

Pass the token in one of two ways:

1. **Query parameter:** `?token=<sse-token>`
2. **Bearer header:** `Authorization: Bearer sse_...`

## Endpoints

### Global Event Stream

```
GET /v1/events?token=<sse-token>
```

Streams events from **all** active sessions. Events are scoped to the caller's API key tenant — admin/master keys see everything, operator/viewer keys see only their own sessions.

### Per-Session Event Stream

```
GET /v1/sessions/:id/events?token=<sse-token>
```

Streams events for a single session. Also available as `GET /v1/sessions/:id/stream` (alias).

### SSE Bridge (Dashboard)

```
GET /v1/sse?token=<sse-token>
```

Bridges the internal `SessionEventBus` to browser/dashboard clients. Same event format as the global stream, with tenant-scoped filtering and connection limiting. Also accepts dashboard cookie authentication.

## Event Reference

### Per-Session Event Types

These events are emitted on the per-session stream (`/v1/sessions/:id/events`):

| Event | Description | Payload Fields |
|-------|-------------|----------------|
| `status` | Session status changed | `status`, `detail` |
| `message` | User or assistant message | `role`, `text`, `contentType`, `tool_name`, `tool_id` |
| `system` | System-generated message | `role` (always `"system"`), `text`, `contentType`, `isSystem` (always `true`) |
| `approval` | Approval/permission request | `prompt` |
| `approval_resolved` | Approval granted or rejected | `action` (`"approved"` or `"rejected"`), `approvalId` |
| `permission_denied` | Permission denied by policy | varies |
| `heartbeat` | Keep-alive + cost data | `sessionCosts` map with `estimatedCostUsd` per session |
| `ended` | Session terminated | `reason` |
| `stall` | Session stalled | `stallType`, `detail` |
| `dead` | Session unresponsive | `reason` |
| `hook` | Claude Code hook fired | `hookEvent`, plus hook-specific fields |
| `subagent_start` | Sub-agent spawned | varies |
| `subagent_stop` | Sub-agent stopped | varies |
| `verification` | Verification result | verification result fields |
| `circuit_breaker` | Circuit breaker triggered | varies |

### Global Event Types

The global stream (`/v1/events`) maps per-session events to a namespaced format:

| Global Event | Source Event | Description |
|-------------|-------------|-------------|
| `session_status_change` | `status`, `heartbeat` | Any session status transition |
| `session_message` | `message`, `system`, `hook` | Message or hook event |
| `session_approval` | `approval` | Approval request |
| `session_ended` | `ended` | Session ended |
| `session_created` | — | New session created |
| `session_stall` | `stall` | Session stalled |
| `session_dead` | `dead` | Session unresponsive |
| `session_subagent_start` | `subagent_start` | Sub-agent started |
| `session_subagent_stop` | `subagent_stop` | Sub-agent stopped |
| `session_verification` | `verification` | Verification result |
| `shutdown` | — | Server shutting down |

All global events include `sessionId`, `timestamp`, and `data` fields.

### Connection Event

Both streams emit a `connected` event on successful connection:

```
data: {"event":"connected","timestamp":"2026-05-27T10:00:00.000Z","data":{"activeSessions":5}}
```

## Event Replay

Both streams support the `Last-Event-ID` header for replaying missed events after a reconnect:

```bash
# After reconnect, replay from last seen event ID
curl -N "http://localhost:9100/v1/events?token=$SSE_TOKEN" \
  -H "Last-Event-ID: 42"
```

Aegis buffers the last 50 events per session and 50 global events for replay. Events beyond the buffer are lost.

## Heartbeat and Cost Tracking

The `heartbeat` event fires periodically and includes a `sessionCosts` map:

```
data: {
  "event": "heartbeat",
  "sessionId": "abc123",
  "timestamp": "2026-05-27T10:00:30.000Z",
  "data": {
    "sessionCosts": {
      "abc123": { "estimatedCostUsd": 0.042 },
      "def456": { "estimatedCostUsd": 0.118 }
    }
  }
}
```

Use this for real-time cost tracking in dashboards.

## Status Values

Sessions emit `status` events with these values:

| Status | Description |
|--------|-------------|
| `pending` | Created but not yet running |
| `working` | Actively processing |
| `waiting_for_input` | Waiting for user/approval input |
| `idle` | Finished processing, session alive |
| `compacting` | Compacting context window |
| `awaiting_approval` | Waiting for session-level approval |

Terminal states (session ended): `completed`, `killed`, `crashed`.

## Rate Limiting

- **Per-IP connection limit:** Prevents any single IP from opening too many SSE connections
- **Global connection limit:** Total concurrent SSE connections across all clients
- **SSE token limit:** Max 10 outstanding tokens per API key

If rate limited, the connection returns `429 Too Many Requests`.

## Reconnection Strategy

SSE connections can drop. Best practices for consumers:

1. **Use native EventSource** — it auto-reconnects
2. **Track `Last-Event-ID`** — pass it on reconnect to replay missed events
3. **Exponential backoff** — if reconnect fails, wait 1s → 2s → 4s → 8s (max 30s)
4. **Refresh SSE tokens** — tokens expire (default 5 min); obtain a new one before reconnecting

### Example: JavaScript EventSource

```javascript
// 1. Get SSE token
const { token } = await fetch('/v1/auth/sse-token', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` }
}).then(r => r.json());

// 2. Connect with auto-reconnect
const source = new EventSource(`/v1/events?token=${token}`);

source.addEventListener('session_status_change', (e) => {
  const data = JSON.parse(e.data);
  console.log(`Session ${data.sessionId} → ${data.data.status}`);
});

source.addEventListener('session_approval', (e) => {
  const data = JSON.parse(e.data);
  console.log(`Approval needed: ${data.data.prompt}`);
});

source.onerror = () => {
  // EventSource auto-reconnects, but check if token expired
  console.log('Connection lost, reconnecting...');
};
```

## Architecture

```
┌──────────────┐     emit()      ┌──────────────────┐
│ Session      │ ───────────────▶│ SessionEventBus  │
│ Monitor      │                 │ (src/events.ts)  │
│ Hooks        │                 │                  │
│ Metering     │                 │  per-session     │
└──────────────┘                 │  emitters +      │
                                 │  global emitter  │
                                 └────────┬─────────┘
                                          │
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                   /v1/events    /v1/sessions/:id/events  Dashboard
                   (global SSE)  (per-session SSE)        (React hook)
```

The `SessionEventBus` is the central hub. All event producers (hooks, monitor, metering) call `emit()`, and SSE route handlers subscribe to receive events in real time.

## Security

SSE streams are protected at multiple layers:

### Authentication

- **SSE tokens required** — regular API keys are rejected with `401`. Tokens are obtained via `POST /v1/auth/sse-token` and are short-lived (default 5 minutes).
- **Token limit** — max 10 outstanding SSE tokens per API key. Prevents token farming.

### Authorization

**Per-session stream** (`/v1/sessions/:id/events`):
1. Session lookup → 404 if not found (generic error, doesn't leak existence)
2. Master key / null auth → bypasses ownership checks
3. **Tenant scoping** — if caller has a `tenantId` that's not `SYSTEM_TENANT`, cross-tenant sessions return 404
4. Admin role → bypasses ownership
5. Otherwise → must match `session.ownerKeyId` or get 403

**Global stream** (`/v1/events`):
- Events are filtered by `isGlobalEventVisibleToRequest()` which checks `session.tenantId === requestTenantId`
- Admin/master keys see all events
- Operator/viewer keys see only events from sessions owned by their tenant
- The `toGlobalEvent()` mapping preserves `sessionId` so tenant filtering can look up the session's tenant at the route level

### Connection Limits

- `SSEConnectionLimiter` enforces per-IP and global connection limits
- `SSEWriter` handles back-pressure and socket timeouts
- Consecutive failure tracking prevents zombie connections

### Audit

Security audit completed by Themis (2026-05-28). Both SSE endpoints confirmed secure with proper tenant isolation.

## Dashboard Integration (for developers)

When building the SSE consumer in the Aegis dashboard (see issue #4347):

### Recommended Hook: `useSSEEvents`

```typescript
// src/hooks/useSSEEvents.ts
function useSSEEvents() {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState<'connected' | 'reconnecting' | 'disconnected'>('disconnected');

  // 1. Fetch SSE token
  // 2. Create EventSource to /v1/events
  // 3. Listen for relevant event types
  // 4. Auto-reconnect with exponential backoff
  // 5. Debounce rapid events (tool calls) to avoid render storms

  return { events, status };
}
```

### Event Type Filters

The dashboard should prioritize these events for the MVP:

- `session_status_change` — update session list in real time
- `session_approval` — show approval notifications with one-tap action
- `session_ended` — move session to completed/killed/crashed
- `heartbeat` — update cost ticker

Tool call streaming (`session_message` with tool metadata) is a nice-to-have for follow-up.

## See Also

- [API Reference: SSE Endpoints](../api-reference.md#13-events-sse-stream) — full endpoint specs
- [API Reference: SSE Token](../api-reference.md#create-sse-token) — token creation details
- [Architecture Overview](../architecture.md) — system design
- [Phone Approvals Guide](./phone-approvals.md) — Telegram one-tap approval flow
