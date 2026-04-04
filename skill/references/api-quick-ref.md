# Aegis API Quick Reference

Base URL: `http://127.0.0.1:9100`

## Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/sessions` | Create session. Body: `{workDir, name?, prompt?, resumeSessionId?}` |
| POST | `/v1/sessions/batch` | Batch create. Body: `{sessions: [{workDir, name?, prompt?}]}` |
| GET | `/v1/sessions` | List all sessions |
| GET | `/v1/sessions/:id` | Get session details |
| GET | `/v1/sessions/:id/health` | Health check for session |
| GET | `/v1/sessions/:id/read` | Read transcript + status |
| GET | `/v1/sessions/:id/summary` | Summary: message counts, duration, status history |
| GET | `/v1/sessions/:id/metrics` | Performance metrics |
| GET | `/v1/sessions/:id/latency` | Latency measurements |
| DELETE | `/v1/sessions/:id` | Kill session |

## Communication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/sessions/:id/send` | Send message. Body: `{text}` |
| POST | `/v1/sessions/:id/command` | Slash command. Body: `{command}` |
| POST | `/v1/sessions/:id/bash` | Bash command. Body: `{command}` |
| GET | `/v1/sessions/:id/pane` | Raw terminal output |

## Interactive Prompts

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/sessions/:id/approve` | Approve current prompt |
| POST | `/v1/sessions/:id/reject` | Reject current prompt |
| POST | `/v1/sessions/:id/escape` | Escape (exit plan mode, close dialog) |
| POST | `/v1/sessions/:id/interrupt` | Ctrl+C |

## Advanced

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/pipelines` | List pipelines |
| POST | `/v1/pipelines` | Create pipeline |
| GET | `/v1/swarm` | Swarm status |

## Server

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/health` | Server health, version, uptime, session counts |

## Response Formats

### Create Session
```json
{
  "id": "uuid",
  "windowId": "@N",
  "windowName": "string",
  "status": "unknown",
  "workDir": "path",
  "claudeSessionId": "uuid",
  "promptDelivery": { "delivered": true, "attempts": 1 }
}
```

> ⚠️ `workDir` must exist on disk. If it doesn't, `id` will be `null`.
> ⚠️ Check `promptDelivery.delivered` — if `false`, CC didn't boot yet. Wait 10s and resend via `/send`.

### Read Transcript
```json
{
  "messages": [{
    "role": "user|assistant",
    "contentType": "text|thinking|tool_use|tool_result",
    "text": "...",
    "timestamp": "ISO-8601"
  }],
  "status": "idle|working|permission_prompt|bash_approval|plan_mode|ask_question|unknown",
  "statusText": "..."
}
```

### Kill Session
```json
{ "ok": true }
```

Session returns `{ "error": "Session not found" }` after kill.

## Workflow Examples

See [workflow-examples.md](./workflow-examples.md) for complete scripts for:

- Implement issue loop
- PR review loop
- Batch pipeline loop

## MCP Tool Mapping (21 tools)

| MCP Tool | REST Equivalent |
|----------|----------------|
| `create_session` | `POST /v1/sessions` |
| `list_sessions` | `GET /v1/sessions` |
| `get_status` | `GET /v1/sessions/:id` + `/health` |
| `get_transcript` | `GET /v1/sessions/:id/read` |
| `send_message` | `POST /v1/sessions/:id/send` |
| `kill_session` | `DELETE /v1/sessions/:id` |
| `approve_permission` | `POST /v1/sessions/:id/approve` |
| `reject_permission` | `POST /v1/sessions/:id/reject` |
| `escape_session` | `POST /v1/sessions/:id/escape` |
| `interrupt_session` | `POST /v1/sessions/:id/interrupt` |
| `send_bash` | `POST /v1/sessions/:id/bash` |
| `send_command` | `POST /v1/sessions/:id/command` |
| `capture_pane` | `GET /v1/sessions/:id/pane` |
| `get_session_metrics` | `GET /v1/sessions/:id/metrics` |
| `get_session_latency` | `GET /v1/sessions/:id/latency` |
| `get_session_summary` | `GET /v1/sessions/:id/summary` |
| `batch_create_sessions` | `POST /v1/sessions/batch` |
| `list_pipelines` | `GET /v1/pipelines` |
| `create_pipeline` | `POST /v1/pipelines` |
| `get_swarm` | `GET /v1/swarm` |
| `server_health` | `GET /v1/health` |
