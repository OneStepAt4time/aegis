# Aegis User Guide

This guide is for anyone using Aegis to run and orchestrate Claude Code sessions — as a tester, developer, or ops engineer. For contributing to Aegis itself, see the [Contributing Guide](../CONTRIBUTING.md).

---

## What is Aegis?

Aegis is a session orchestration layer around Claude Code. It gives you:

- **A REST API** to create, monitor, and interact with Claude Code sessions
- **A dashboard** for visual session management
- **Parallel orchestration** — run multiple sessions at the same time
- **MCP (Model Context Protocol) tools** for native Claude Code integration
- **Auth, audit logs, and alerting** for production use

Aegis sits in front of Claude Code; it doesn't replace it. Your sessions still run as Claude Code processes in tmux, with all the capabilities you'd get from the CLI.

---

## Quick Start

### 1. Start Aegis

```bash
npm install -g @onestepat4time/aegis
ag
```

Aegis starts on **http://localhost:9100**. Verify:

```bash
curl http://localhost:9100/v1/health
```

### 2. Create a Session

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-task",
    "workDir": "/path/to/your/project",
    "prompt": "What files are in this project?"
  }'
```

Save the session `id` from the response for subsequent calls.

### 3. Monitor Progress

```bash
# Session status
curl http://localhost:9100/v1/sessions/<session-id>

# Real-time events
curl -N http://localhost:9100/v1/events

# Read session output
curl http://localhost:9100/v1/sessions/<session-id>/read
```

### 4. Interact

```bash
# Send a follow-up message
curl -X POST http://localhost:9100/v1/sessions/<session-id>/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Now refactor the auth module."}'

# Interrupt a stalled session
curl -X POST http://localhost:9100/v1/sessions/<session-id>/interrupt
```

---

## Authentication

By default, Aegis has no authentication. To enable it:

```bash
AEGIS_AUTH_TOKEN=my-secret-token ag
```

Then include the token in every request:

```bash
curl -H "Authorization: Bearer my-secret-token" http://localhost:9100/v1/sessions
```

> **Note:** `/v1/health` and `/v1/handshake` are always unauthenticated.

### Multi-Key API Keys

For production, create named API keys with different roles:

```bash
# Admin key — full access
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -d '{"name": "admin-key", "role": "admin"}'

# Operator key — can manage sessions but not change auth config
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -d '{"name": "ci-operator", "role": "operator"}'

# Viewer key — read-only access
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -d '{"name": "monitoring", "role": "viewer"}'
```

| Role | Sessions | Auth Keys | Audit | Pipelines |
|---|---|---|---|---|
| `admin` | ✅ full | ✅ manage | ✅ view | ✅ manage |
| `operator` | ✅ full | ❌ | ✅ view | ✅ manage |
| `viewer` | ✅ read-only | ❌ | ❌ | ❌ |

---

## Permission Modes

When Claude Code encounters a potentially dangerous operation (running `rm`, modifying system files, etc.), it pauses for approval. Aegis lets you control this behaviour when creating a session:

```json
{
  "workDir": "/path/to/project",
  "permissionMode": "default"
}
```

| Mode | When to use |
|---|---|
| `default` | **Recommended.** Claude prompts for dangerous ops. You approve via the API. |
| `bypassPermissions` | Fully automated runs where you trust the prompt completely. Use with caution. |
| `plan` | When you want Claude to first outline changes before executing them. |
| `acceptEdits` | Safe for non-destructive refactoring; fails on destructive ops without prompting. |
| `dontAsk` | Strict mode — no prompts at all. Dangerous ops cause the session to error. |
| `auto` | Claude decides when to prompt based on context. Unpredictable for automation. |

### Handling Permission Prompts

When a session pauses at a permission prompt, its status becomes `permission_prompt`. To respond:

```bash
# Approve the pending action
curl -X POST http://localhost:9100/v1/sessions/<session-id>/approve

# Reject and stop the operation
curl -X POST http://localhost:9100/v1/sessions/<session-id>/reject
```

---

## Running Sessions in Parallel

Aegis is designed for multi-session orchestration:

```bash
# Service A review
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "service-a", "workDir": "./service-a", "prompt": "Run the test suite and report results."}'

# Service B review
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "service-b", "workDir": "./service-b", "prompt": "Run the test suite and report results."}'

# List all sessions
curl http://localhost:9100/v1/sessions
```

### Parent–Child Sessions

Spawn a child session linked to a parent:

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "deep-refactor",
    "workDir": "/path/to/project",
    "prompt": "Rewrite the data layer",
    "parentId": "<parent-session-id>"
  }'
```

Children are listed in the parent's `/sessions/:id/children` endpoint.

---

## Integrating with Claude Code (MCP)

Connect Aegis tools directly inside Claude Code sessions:

```bash
claude mcp add aegis -- ag mcp
```

This registers 24 Aegis MCP tools in Claude Code, covering:
- Session management (create, send, interrupt, kill)
- Transcript reading
- Pipeline orchestration
- Memory bridge

Restart Claude Code after adding the MCP server.

---

## Verifying Releases

Before installing or deploying Aegis, verify the release integrity:

→ See the full guide: **[Verifying Releases](./verify-release.md)**

This covers SHA-256 verification, npm integrity, Sigstore attestations, and version policy.

---

## Common Workflows

### Resume a Session

If a session was interrupted or you want to continue work:

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/path/to/project",
    "resumeSessionId": "<original-session-id>",
    "prompt": "Continue the refactoring. You had started on the auth module."
  }'
```

### Fork a Session

Fork an existing session to explore a different direction without losing the original:

```bash
curl -X POST http://localhost:9100/v1/sessions/<original-id>/fork \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Try a different approach using a decorator pattern."}'
```

### Batch Operations

List and manage many sessions at once:

```bash
# List all idle sessions
curl "http://localhost:9100/v1/sessions?status=idle"

# Batch-delete all errored sessions
curl -X DELETE "http://localhost:9100/v1/sessions/batch?status=error" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Session stuck on `stalled` | Claude Code is idle but Aegis thinks it's busy | `curl -X POST /v1/sessions/:id/interrupt` then send a new message |
| `401 Unauthorized` | Auth enabled but token missing or wrong | Include `Authorization: Bearer <token>` header |
| `403 Forbidden` on session action | API key doesn't own the session | Session ownership is enforced; use the key that created the session |
| `404 Session not found` | Session was cleaned up | Sessions are auto-cleaned after termination; check `/v1/sessions` |
| `/read` returns empty | Transcript not yet written | Wait for session to reach `idle`, or check `/v1/sessions/:id/pane` for live output |
| Dashboard shows no sessions | tmux not installed or not in PATH | `tmux -V` to check; install via `apt install tmux` or `brew install tmux` |
| MCP tools not registered | MCP server command was wrong | Use `claude mcp add aegis -- ag mcp`, then restart Claude Code |

---

## Next Steps

- **[API Reference](./api-reference.md)** — Full REST API reference
- **[Verifying Releases](./verify-release.md)** — Security verification steps
- **[Dashboard Guide](./dashboard.md)** — Dashboard features and keyboard shortcuts
- **[Advanced Features](./advanced.md)** — Pipelines, Memory Bridge, templates
- **[Enterprise Deployment](./enterprise.md)** — Production setup, rate limiting, multi-key auth
