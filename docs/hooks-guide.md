# Lifecycle Hooks Guide

Aegis captures Claude Code lifecycle events via HTTP hooks and enriches them with MCP tool integration, SSE streaming, multi-channel delivery, and enterprise-grade security. This guide covers how hooks work, how to configure them, and how Aegis's architecture compares to alternatives.

> **For positioning context**, see the [Competitive Threat Matrix](./competitive-threat-matrix.md).

## Overview

When Claude Code runs a session, it emits lifecycle events at key points. Claude Code supports three native hook types:

| Type | Mechanism | Scope |
|------|-----------|-------|
| **Command** | Shell script, receives JSON on stdin | Local machine |
| **HTTP** | POST to a URL with JSON body | Network-accessible |
| **Prompt** | LLM prompt injection | In-process |

Aegis uses **HTTP hooks** exclusively — registering a single endpoint (`POST /v1/hooks/:eventName`) that receives all 29+ CC lifecycle events. This gives Aegis a centralized event bus that no shell-only or config-only approach can match.

## Complete Event Reference

Aegis handles all Claude Code lifecycle events. Here's the full taxonomy:

### Session Lifecycle

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `SessionStart` | Session begins or resumes | Track session state |
| `SessionEnd` | Session terminates | Clean up resources, emit final metrics |
| `Setup` | `--init-only` or `--maintenance` mode | One-time CI preparation |
| `Stop` | Claude finishes responding | Detect waiting-for-input, emit `session.idle` |
| `StopFailure` | Turn ends due to API error | Circuit breaker protection (see below) |

### Tool Lifecycle (Agentic Loop)

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `PreToolUse` | Before a tool call executes | Permission policy evaluation → approve/deny, OTel span start |
| `PostToolUse` | After a tool call succeeds | Record metrics, emit SSE, OTel span close |
| `PostToolUseFailure` | After a tool call fails | Log failure, emit error event, OTel span with error |
| `PostToolBatch` | After a parallel batch resolves | Batch metrics recording |
| `PermissionRequest` | Permission dialog appears | Route to dashboard/Telegram/Slack for human decision |
| `PermissionDenied` | Auto-mode classifier denies tool | Emit denial event for audit |

### Agent Orchestration

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `SubagentStart` | Subagent spawned | Track active subagents, emit `subagent_start` SSE |
| `SubagentStop` | Subagent finishes | Remove subagent tracking, emit `subagent_stop` SSE |
| `TaskCreated` | Task created via `TaskCreate` | Status → `working` |
| `TaskCompleted` | Task marked complete | Status → `idle` |
| `TeammateIdle` | Agent team teammate goes idle | Status → `idle` |

### Context Management

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `PreCompact` | Before context compaction | Update activity timestamp, status → `compacting` |
| `PostCompact` | After context compaction | Update activity timestamp, status → `idle` |
| `UserPromptSubmit` | User submits a prompt | Status → `working` |
| `UserPromptExpansion` | Slash command expands | Informational |

### File & Environment

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `FileChanged` | Watched file changes on disk | Informational, forward to SSE |
| `CwdChanged` | Working directory changes | Informational, forward to SSE |
| `ConfigChange` | Configuration file changes | Informational, forward to SSE |
| `InstructionsLoaded` | CLAUDE.md or rules file loaded | Informational, forward to SSE |
| `Notification` | CC sends a notification | Forward to SSE + channels |

### Worktree & MCP

| Event | Trigger | Aegis Action |
|-------|---------|-------------|
| `WorktreeCreate` | Worktree being created | Status → `working`, log |
| `WorktreeRemove` | Worktree being removed | Status → `idle`, log |
| `Elicitation` | MCP server requests user input | Status → `working` |
| `ElicitationResult` | User responds to MCP elicitation | Status → `working` |

## How It Works

### Hook Registration

When Aegis creates a Claude Code session, it registers HTTP hooks pointing to `POST /v1/hooks/:eventName`:

```
Claude Code → HTTP POST → Aegis /v1/hooks/PreToolUse → Permission policy evaluation → Approve/Reject
```

You don't need to configure Claude Code hooks manually — Aegis manages the entire lifecycle.

### Event Flow

Every hook event passes through a five-stage pipeline:

```
CC Session Event
    ↓
┌──────────────────────────────────────────────────────────┐
│ 1. VALIDATE    — Zod schema check (hookBodySchema)       │
│ 2. AUTHENTICATE — X-Hook-Secret timing-safe comparison   │
│ 3. DECIDE      — Permission policy evaluation            │
│ 4. OBSERVE     — OTel spans, Prometheus metrics          │
│ 5. BROADCAST   — SSE + channels (Telegram/Slack/Email)   │
└──────────────────────────────────────────────────────────┘
```

### Decision Events

Two hook events require a response body that Claude Code acts on:

- **`PreToolUse`** — Aegis evaluates the tool against the session's permission profile. Returns `allow`, `deny`, or `ask` (escalate to human).
- **`PermissionRequest`** — Aegis checks the session's permission mode. Auto-approve modes (`bypassPermissions`, `dontAsk`, `acceptEdits`, `auto`) respond immediately. Others wait for a human decision via dashboard or chat.

All other events receive `{ ok: true }` and are processed asynchronously.

## Quick Reference: curl Examples

All hook calls use the same endpoint pattern. The key differences are the event name in the URL and the response body for decision events.

### Required Headers

| Header | When | Value |
|--------|------|-------|
| `X-Session-Id` | Always | UUID of the Aegis session (also accepts `?sessionId=` query param) |
| `X-Hook-Secret` | If secret is configured | The hook secret for this session |
| `Content-Type` | Always | `application/json` |

> **Tip:** In local development without a configured secret, omit `X-Hook-Secret`.

### Informational Event (e.g. `Stop`, `SessionStart`)

```bash
curl -X POST "http://localhost:9100/v1/hooks/Stop" \
  -H "X-Session-Id: <session-uuid>" \
  -H "X-Hook-Secret: <hook-secret>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Response: `{ "ok": true }`

### PreToolUse — Approve a Tool Call

```bash
curl -X POST "http://localhost:9100/v1/hooks/PreToolUse" \
  -H "X-Session-Id: <session-uuid>" \
  -H "X-Hook-Secret: <hook-secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "Bash",
    "tool_input": { "command": "npm test" }
  }'
```

Aegis evaluates the tool against the session's permission profile and returns:

```json
{ "decision": "allow" }
```

Other possible decisions: `"deny"`, `"ask"` (escalate to human).

### PermissionRequest — Handle a Permission Dialog

```bash
curl -X POST "http://localhost:9100/v1/hooks/PermissionRequest" \
  -H "X-Session-Id: <session-uuid>" \
  -H "X-Hook-Secret: <hook-secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "Write",
    "tool_input": { "file_path": "/etc/config.yml", "content": "..." }
  }'
```

In auto-approve modes, Aegis responds immediately. In manual modes, the request is queued for human review via dashboard or chat channels. The response depends on the session's permission configuration.

### Error Responses

| Status | Error | Fix |
|--------|-------|-----|
| `400` | `Missing session ID — provide X-Session-Id header or sessionId query param` | Add `X-Session-Id` header |
| `400` | `Invalid session ID — must be a UUID` | Check the session UUID format |
| `400` | `Unknown event name` | Check the event name spelling (see [Event Reference](#complete-event-reference)) |
| `401` | `Unauthorized — hook endpoint requires valid session ID` | Verify the session UUID exists in Aegis |
| `401` | `Unauthorized — invalid hook secret` | Check `X-Hook-Secret` matches the session's configured secret |
| `401` | `Unauthorized — hook secret must be sent via X-Hook-Secret header` | Stop using `?secret=` query param (header-only mode is enabled) |
| `404` | Session not found | Verify the session UUID is correct and the session hasn't been killed |

## Configuration

### Hook Secret

Set a hook secret to authenticate inbound hook calls:

```bash
AEGIS_HOOK_SECRET=your-secret-here ag
```

Hooks must include `X-Hook-Secret: your-secret-here` header. Without a configured secret, hooks are accepted without authentication (suitable for local development only).

#### Where to Find Your Hook Secret

Aegis generates a per-session hook secret automatically and injects it into Claude Code's settings. You can retrieve it from the session details:

```bash
# Get session details (includes hookSecret)
curl http://localhost:9100/v1/sessions/<session-uuid> \
  -H "Authorization: Bearer $TOKEN"
```

Look for the `hookSecret` field in the response. This is the value to use in `X-Hook-Secret`.

### Header-Only Mode

For production deployments, enforce header-only secret delivery:

```bash
AEGIS_HOOK_SECRET_HEADER_ONLY=true
```

This rejects the deprecated `?secret=` query parameter and prevents secret leakage in URLs/logs.

### Circuit Breaker (StopFailure Protection)

When a user-defined Stop hook returns `ok: false`, Claude Code retries in an infinite loop. Aegis detects this and trips a **circuit breaker**:

| Variable | Default | Range | Description |
|---|---|---|---|
| `HOOK_CIRCUIT_BREAKER_MAX` | `5` | 1–100 | Failures before breaker trips |
| `HOOK_CIRCUIT_BREAKER_WINDOW_MS` | `60000` | 1000–3600000 | Sliding window (ms) |

After the threshold is reached, Aegis returns `{ ok: true }` to break the retry loop and emits a `circuit_breaker` SSE event. The breaker stays tripped for the session's lifetime. A successful `Stop` event resets it.

### Answer Timeout (AskUserQuestion)

When Claude Code asks a question via `AskUserQuestion`, Aegis can intercept and answer from external clients:

| Variable | Default | Range | Description |
|---|---|---|---|
| `ANSWER_TIMEOUT_MS` | `30000` | 1000–600000 | How long to wait for an external answer |

## Security Model

| Feature | Description |
|---------|---------|
| **Secret authentication** | `X-Hook-Secret` header validates inbound hook calls |
| **Header-only mode** | Prevents secret leakage via URL query parameters |
| **Permission policies** | `PreToolUse` hooks evaluate tool access against configurable policies |
| **Audit logging** | Every hook event is recorded in the audit trail with hash chain integrity |
| **Rate limiting** | Per-IP rate limits prevent hook endpoint abuse |
| **Payload validation** | All hook bodies validated against strict Zod schemas |
| **Circuit breaker** | Detects rapid `StopFailure` events and trips breaker to prevent session death loops |
| **Payload truncation protection** | Warns when hook payloads exceed 1.5KB (CC silently truncates at ~2KB) |
| **Session validation** | Rejects non-UUID session IDs before lookup |
| **Event allowlist** | Unknown event names return `400` — prevents injection |

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
- `GET /v1/sessions/:id/sse` — per-session event stream

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

---

## Competitive Comparison: Why Aegis Hooks Win

> This section is for technical decision-makers evaluating orchestration tools. For broader competitive context, see the [Competitive Threat Matrix](./competitive-threat-matrix.md).

### The Architecture Gap

Claude Code hooks are a **point-to-point mechanism**: CC fires an event, one handler responds. Most orchestration tools use this directly — a shell script or HTTP callback that makes a binary allow/deny decision.

Aegis layers a **service mesh** on top of that mechanism:

```
Shell-only tools:    CC ──hook──▶ Shell script (allow/deny)
HTTP-only tools:     CC ──hook──▶ HTTP handler (allow/deny)
Aegis:              CC ──hook──▶ Hook endpoint ──┬── Permission policy
                                                  ├── OTel tracing
                                                  ├── SSE broadcast
                                                  ├── Multi-channel fan-out
                                                  ├── Audit logging
                                                  ├── Circuit breaker
                                                  └── Prometheus metrics
```

### Side-by-Side: Permission Control

**cc-connect** (Go binary, TOML config):

```toml
# cc-connect config.toml
[hooks]
allow_tools = ["Read", "Write", "Bash"]
deny_tools = ["RMRF"]
```

Flat allow/deny list. No per-session policies. No conditional rules. No audit trail of which tool was approved by which policy.

**Native Claude Code** (shell hook):

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "/path/to/block-rm.sh"
      }]
    }]
  }
}
```

Runs a shell script on every `Bash` tool call. The script must parse JSON from stdin, make a decision, and print JSON to stdout. No built-in audit, no metrics, no fan-out. Each event spawns a new process.

**Aegis** (HTTP + MCP + policy engine):

```bash
# Create session with a permission profile
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "permissionProfile": {
      "rules": [
        { "tool": "Bash", "behavior": "ask", "reason": "Shell commands need approval" },
        { "tool": "Edit", "behavior": "allow" },
        { "tool": "Write", "behavior": "allow", "pattern": "src/**" },
        { "tool": "Write", "behavior": "deny", "pattern": "prod/**" }
      ]
    }
  }'
```

Per-session, per-tool, per-path rules. Decisions are audit-logged with hash chain integrity. Metrics track auto-approvals vs escalations. No shell scripts to maintain.

### Side-by-Side: Observability

**cc-connect**: Logs to stdout. No structured metrics. No tracing. No real-time event stream.

**OpenACP**: Telegram/Discord notifications. No OTel, no Prometheus, no SSE for external consumers.

**Aegis**: Every hook event generates:
- OpenTelemetry span (`tool.invoke` with `sessionId`, `toolName`, `toolUseId`)
- Prometheus counter (`aegis_tool_calls_total`, `aegis_auto_approvals_total`)
- SSE event (real-time broadcast to dashboard and clients)
- Audit log entry (hash-chained, tamper-proof, queryable via API)
- Channel fan-out (Telegram + Slack + Email simultaneously)

### Side-by-Side: Failure Handling

**Native CC hooks**: If a Stop hook fails (returns `ok: false`), Claude Code retries forever. The session burns tokens in an infinite loop. No automatic protection.

**Aegis**: The circuit breaker detects rapid `StopFailure` events and trips automatically, returning `{ ok: true }` to break the loop. The event is emitted as `circuit_breaker` SSE for monitoring. Configurable threshold and window.

```bash
# Trip after 5 failures in 60 seconds
HOOK_CIRCUIT_BREAKER_MAX=5
HOOK_CIRCUIT_BREAKER_WINDOW_MS=60000
```

### Side-by-Side: Multi-Agent Awareness

**cc-connect**: Tracks multiple agent backends but has no subagent lifecycle tracking within a session.

**Aegis**: `SubagentStart`/`SubagentStop` events track active subagents per session. The dashboard shows live subagent counts. `TaskCreated`/`TaskCompleted` events enable pipeline progress tracking. `TeammateIdle` enables agent team coordination.

### Feature Matrix

| Capability | Aegis | cc-connect | ClaudeClaw | OpenACP |
|-----------|-------|-----------|-----------|---------|
| **Hook transport** | HTTP + MCP | HTTP + shell | Shell only | HTTP only |
| **Authentication** | `X-Hook-Secret` (header-only mode) | Basic token | None | None |
| **Permission policies** | Per-session, per-tool, per-path rules | Flat allow/deny list | Allow/block all | Allow/block all |
| **Audit trail** | Hash-chained, immutable, API-queryable | None | None | None |
| **Real-time SSE** | Per-session + global streams | None | None | None |
| **OTel tracing** | `tool.invoke` spans with correlation | None | None | None |
| **Prometheus metrics** | Per-session tool calls, auto-approvals, latency | None | None | None |
| **Circuit breaker** | Automatic StopFailure protection | None | None | None |
| **Multi-channel fan-out** | Dashboard + Telegram + Slack + Email | Single channel | Telegram only | Telegram + Discord |
| **Subagent tracking** | `SubagentStart`/`SubagentStop` per session | No subagent events | No subagent events | No subagent events |
| **Payload validation** | Zod schema on every event | Best-effort | None | None |
| **Rate limiting** | Per-IP + global | None | None | None |
| **Events handled** | 29 lifecycle events | Subset | 3–5 basic events | 5–8 events |
| **AskUserQuestion intercept** | Yes — external answer with timeout | No | No | No |
| **RBAC on hook endpoints** | Role-based access (admin/operator/viewer) | Token-only | None | None |

### Why MCP Integration Matters

Aegis's hooks don't just receive events — they integrate with the **Model Context Protocol** server. This creates a bidirectional relationship:

1. **Inbound** (CC → Aegis): HTTP hooks deliver lifecycle events for monitoring, auditing, and permission decisions.
2. **Outbound** (Aegis → CC): MCP tools let external systems control sessions — send messages, approve permissions, kill sessions, inspect transcripts.

This means you can build **full control planes** on top of Aegis:
- A dashboard that watches tool calls via SSE and approves permissions via MCP
- A Telegram bot that receives session alerts and sends corrective instructions
- A CI/CD pipeline that creates sessions, monitors progress, and reviews results

Shell-only tools can only react. Aegis can **observe AND act**.

---

## See Also

- [API Reference — Webhooks](./api-reference.md#12-webhooks) — full endpoint documentation
- [API Reference — Session Hooks](./api-reference.md#session-hooks) — circuit breaker and truncation handling
- [Observability Guide](./OBSERVABILITY.md) — Prometheus, Grafana, OTel setup
- [Architecture — Channels](./architecture.md#5-notification-channels) — channel delivery architecture
- [Competitive Threat Matrix](./competitive-threat-matrix.md) — strategic competitive positioning
