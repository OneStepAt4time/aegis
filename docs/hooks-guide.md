# Lifecycle Hooks Guide

Aegis captures Claude Code lifecycle events (tool use, permission requests, session stops) via HTTP hooks and exposes them through SSE streams, webhooks, and the REST API. This guide covers how hooks work, how to configure them, and how Aegis's hook system differs from alternatives.

## Overview

When Claude Code runs a session, it emits lifecycle events at key points:

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `PreToolUse` | Before a tool executes | Evaluate permission policy, approve or reject |
| `PostToolUse` | After a tool completes | Record tool usage, emit SSE event |
| `PostToolUseFailure` | After a tool fails | Log failure, emit error event |
| `PermissionRequest` | CC asks for user approval | Route to dashboard / Telegram / Slack for human decision |
| `Stop` | Session completes | Clean up resources, emit session.idle event |

Aegis registers these hooks automatically when creating a session. You don't need to configure Claude Code hooks manually — Aegis manages the entire lifecycle.

## How It Works

### Hook Registration

When Aegis creates a Claude Code session, it registers HTTP hooks pointing to `POST /v1/hooks/:eventName`:

```
Claude Code → HTTP POST → Aegis /v1/hooks/PreToolUse → Permission policy evaluation → Approve/Reject
```

### Event Flow

```
CC Session Event
    ↓
Aegis Hook Endpoint (/v1/hooks/:eventName)
    ├── Permission Guard → approve / reject
    ├── Tool Registry → record metrics
    ├── SSE Emitter → broadcast to dashboard
    ├── Channel Manager → fan-out to Telegram/Slack/Email
    └── OTel Tracing → create tool spans
```

Every hook event is:
1. **Validated** — checked against `hookBodySchema`
2. **Authenticated** — verified via `X-Hook-Secret`
3. **Acted on** — permission decisions, metric recording, event broadcasting
4. **Traced** — OpenTelemetry spans for observability

## Configuration

### Hook Secret

Set a hook secret to authenticate inbound hook calls:

```bash
AEGIS_HOOK_SECRET=your-secret-here ag
```

Hooks must include `X-Hook-Secret: your-secret-here` header. Without a configured secret, hooks are accepted without authentication (suitable for local development only).

### Header-Only Mode

For production deployments, enforce header-only secret delivery:

```bash
AEGIS_HOOK_SECRET_HEADER_ONLY=true
```

This rejects the deprecated `?secret=` query parameter and prevents secret leakage in URLs/logs.

## Security Model

Aegis hooks are designed for production security:

| Feature | Description |
|---------|-------------|
| **Secret authentication** | `X-Hook-Secret` header validates inbound hook calls |
| **Header-only mode** | Prevents secret leakage via URL query parameters |
| **Permission policies** | `PreToolUse` hooks evaluate tool access against configurable policies |
| **Audit logging** | Every hook event is recorded in the audit trail with hash chain integrity |
| **Rate limiting** | Per-IP rate limits prevent hook endpoint abuse |
| **Payload validation** | All hook bodies validated against strict Zod schemas |
| **Circuit breaker** | Detects rapid `Stop` hook failures and trips breaker to prevent session death loops |
| **Payload truncation protection** | Warns when hook payloads exceed 1.5KB (CC silently truncates at ~2KB) |

## Observability

### OTel Tracing

Hook events create OpenTelemetry spans:

- `PreToolUse` / `PostToolUse` → `tool.invoke` spans with `toolName`, `toolUseId`, token counts
- `PostToolUseFailure` → `tool.invoke` span with error status
- Spans include `sessionId` for correlation

Enable tracing:
```bash
AEGIS_OTEL_ENABLED=true AEGIS_OTEL_OTLP_ENDPOINT=http://localhost:4318 ag
```

### SSE Events

Hook events are broadcast via SSE in real-time:

- `GET /v1/events` — global event stream (requires SSE token)
- `GET /v1/sessions/:id/events` — per-session event stream

### Prometheus Metrics

Tool invocations from hooks are tracked in Prometheus:

- `aegis_tool_calls_total` — total tool calls per session
- `aegis_auto_approvals_total` — permissions auto-approved by policy

## Webhook Delivery

Aegis can forward session events to external webhooks:

- **Telegram** — bidirectional (approve/reject from chat)
- **Slack** — incoming webhooks for session alerts
- **Email** — SMTP alerts for stall/dead/error events
- **Generic HTTP** — configurable per-endpoint webhooks

Delivery tracking includes a dead-letter queue for failed deliveries:

```bash
curl http://localhost:9100/v1/webhooks/dead-letter \
  -H "Authorization: Bearer $TOKEN"
```

## Comparison: Aegis vs Shell/HTTP Hook Systems

Some Claude Code orchestration tools offer simpler hook systems based on shell commands or raw HTTP callbacks. Here's how Aegis's approach differs:

| Capability | Aegis (MCP + HTTP) | Shell/HTTP Only |
|-----------|-------------------|-----------------|
| **Authentication** | Secret-based with header-only mode | Often none or basic token |
| **Permission control** | Configurable policies per tool, per session | Allow/block all |
| **Audit trail** | Hash-chained, immutable, queryable | Typically none |
| **Real-time observability** | SSE streams, OTel spans, Prometheus metrics | Limited or custom logging |
| **Multi-channel delivery** | Dashboard + Telegram + Slack + Email + webhooks | Usually single channel |
| **Circuit breaker** | Automatic detection of hook failure loops | Manual intervention |
| **Payload validation** | Strict schema validation (Zod) | Best-effort or none |
| **Rate limiting** | Per-IP + global limits | Often none |
| **Tool-level metrics** | Per-session tool usage, token counts, latency | Aggregate or none |

### Why MCP-Based Hooks Matter

Aegis's hooks integrate with the **Model Context Protocol** server, not just HTTP endpoints. This means:

1. **Agent-native** — Claude Code interacts with Aegis via MCP tools, not just callbacks
2. **Composable** — Other MCP hosts can use the same tools
3. **Auditable** — Every MCP tool call is logged with parameters and results
4. **RBAC-ready** — Per-tool role-based access control (Phase 4)

## See Also

- [API Reference — Webhooks](./api-reference.md#12-webhooks) — full endpoint documentation
- [API Reference — Session Hooks](./api-reference.md#session-hooks) — circuit breaker and truncation handling
- [Observability Guide](./OBSERVABILITY.md) — Prometheus, Grafana, OTel setup
- [Architecture — Channels](./architecture.md#5-notification-channels) — channel delivery architecture
