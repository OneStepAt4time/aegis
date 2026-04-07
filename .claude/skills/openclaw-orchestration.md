---
name: openclaw-orchestration
description: Orchestrate Claude Code sessions via Aegis — create, monitor, prompt, approve, verify, and clean up
triggers:
  - "implement issue"
  - "review PR"
  - "fix CI"
  - "batch tasks"
  - "orchestrate session"
  - "create session"
freedom: high
---

# Skill: OpenClaw Orchestration — Aegis Session Management

Orchestrate Claude Code (CC) sessions through the Aegis bridge API. Create sessions, send prompts, monitor progress, handle permission prompts, run quality gates, and clean up.

## Prerequisites

1. **Aegis server running** — `GET http://localhost:9100/health` returns `status: "ok"`
2. **API key configured** — `AEGIS_API_KEY` env var set, or key passed via `Authorization: Bearer <key>` header
3. **tmux available** — CC runs inside tmux panes managed by Aegis
4. **Claude Code CLI installed** — `claude --version` returns >= 2.1.0

## Authentication

All endpoints except `/health` and `/handshake` require auth:

```
Authorization: Bearer <api-key>
```

Get an API key:
```bash
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer <master-key>" \
  -H "Content-Type: application/json" \
  -d '{"name": "openclaw"}'
```

## Core Workflows

### 1. Create Session and Send Prompt

```bash
# Create session with initial prompt
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/path/to/project",
    "name": "fix-auth-bug",
    "prompt": "Fix the null check in src/auth.ts line 42. The session ID can be null when the user is not logged in.",
    "permissionMode": "bypassPermissions"
  }'
```

Response includes `id`, `status`, and optional `promptDelivery` (delivery confirmation).

**Permission modes:**
- `bypassPermissions` — auto-approve all (recommended for headless)
- `plan` — CC plans first, edits require approval
- `acceptEdits` — edits auto-approved, bash commands need approval
- `default` — every tool call requires explicit approval

### 2. Monitor Session Progress

**Polling approach:**
```bash
# Check session status
curl http://localhost:9100/v1/sessions/{id} \
  -H "Authorization: Bearer <key>"

# Read new messages (advances offset — each call returns only new messages)
curl http://localhost:9100/v1/sessions/{id}/read \
  -H "Authorization: Bearer <key>"

# Get condensed summary (last 20 messages)
curl http://localhost:9100/v1/sessions/{id}/summary \
  -H "Authorization: Bearer <key>"
```

**SSE streaming (preferred for long tasks):**
```bash
# Get SSE token
TOKEN=$(curl -s -X POST http://localhost:9100/v1/auth/sse-token \
  -H "Authorization: Bearer <key>" | jq -r .token)

# Stream events
curl -N http://localhost:9100/v1/sessions/{id}/events?token=$TOKEN
```

**SSE event types to watch:**
| Event | Meaning |
|-------|---------|
| `status` | UI state changed (idle, working, permission_prompt, error) |
| `message` | New user/assistant/system message |
| `approval` | CC is waiting for permission |
| `stall` | Session is stuck (no progress) |
| `dead` | tmux window died |
| `ended` | Session terminated |
| `verification` | Quality gate result |

### 3. Handle Permission Prompts

When CC encounters a `permission_prompt` state:

**Decision tree:**
1. Is the tool call safe (read-only, no destructive side effects)? → **Approve**
2. Is it a bash command? Check if it's `rm -rf`, `git push --force`, or modifies shared state → **Reject** if destructive, **Approve** otherwise
3. Is it a file write/edit? Check if the file is in the project workspace → **Approve**
4. Uncertain? → **Reject** and let CC explain what it needs

```bash
# Approve
curl -X POST http://localhost:9100/v1/sessions/{id}/approve \
  -H "Authorization: Bearer <key>"

# Reject
curl -X POST http://localhost:9100/v1/sessions/{id}/reject \
  -H "Authorization: Bearer <key>"

# Answer AskUserQuestion
curl -X POST http://localhost:9100/v1/sessions/{id}/answer \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"questionId": "<id>", "answer": "use the existing pattern"}'
```

**Tip:** Use `permissionMode: "bypassPermissions"` to avoid prompts entirely for trusted tasks.

### 4. Stall Detection and Recovery

Aegis detects stalls automatically. Recovery escalation:

| Stage | Action | API |
|-------|--------|-----|
| 1. Nudge | Send a follow-up message | `POST /v1/sessions/{id}/send` |
| 2. Refine | Break the task into smaller steps | `POST /v1/sessions/{id}/send` with refined prompt |
| 3. Interrupt | Send Ctrl+C to cancel current operation | `POST /v1/sessions/{id}/interrupt` |
| 4. Escalate | Kill session and report failure | `DELETE /v1/sessions/{id}` |

```bash
# Nudge — remind CC of the task
curl -X POST http://localhost:9100/v1/sessions/{id}/send \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Continue with the fix. Focus on src/auth.ts line 42."}'

# Interrupt — cancel current operation
curl -X POST http://localhost:9100/v1/sessions/{id}/interrupt \
  -H "Authorization: Bearer <key>"

# Escape — dismiss a dialog
curl -X POST http://localhost:9100/v1/sessions/{id}/escape \
  -H "Authorization: Bearer <key>"
```

### 5. Quality Gate

Run `tsc + build + test` inside the session's work directory:

```bash
curl -X POST http://localhost:9100/v1/sessions/{id}/verify \
  -H "Authorization: Bearer <key>"
```

Response:
```json
{
  "ok": true,
  "steps": [
    { "name": "tsc", "ok": true, "durationMs": 4200 },
    { "name": "build", "ok": true, "durationMs": 8100 },
    { "name": "test", "ok": true, "durationMs": 21000 }
  ],
  "totalDurationMs": 33300,
  "summary": "Verification passed: tsc OK, build OK, test OK (33300ms)"
}
```

Returns HTTP 422 if any step fails. Check `steps[].error` for details.

### 6. Session Cleanup

```bash
# Kill session (kills tmux window, restores settings, cleans up)
curl -X DELETE http://localhost:9100/v1/sessions/{id} \
  -H "Authorization: Bearer <key>"

# Bulk health check — find sessions that need cleanup
curl http://localhost:9100/v1/sessions/health \
  -H "Authorization: Bearer <key>"
```

## Common Patterns

### Implement a GitHub Issue End-to-End

1. Read the issue: `gh issue view {number} --json title,body`
2. Create a branch: `git checkout -b fix/{number}-description`
3. Create session with the issue context as prompt:
   ```json
   {
     "workDir": "/path/to/project",
     "name": "fix-{number}",
     "prompt": "Implement the fix for issue #{number}:\n\nTitle: {title}\n\n{body}\n\nRun tsc --noEmit && npm run build && npm test before finishing.",
     "permissionMode": "bypassPermissions"
   }
   ```
4. Monitor via SSE until `ended` event
5. Run quality gate: `POST /v1/sessions/{id}/verify`
6. If verification passes, commit and push
7. Kill session: `DELETE /v1/sessions/{id}`

### Review a Pull Request

1. Create session with PR context:
   ```json
   {
     "workDir": "/path/to/project",
     "name": "review-{pr}",
     "prompt": "Review PR #{pr}. Run: gh pr diff {pr} --color=never\nAnalyze the changes for bugs, security issues, and code quality. Report findings.",
     "permissionMode": "bypassPermissions"
   }
   ```
2. Read the transcript for review findings
3. Kill session

### Fix a CI Failure

1. Get failed job logs: `gh run view {run_id} --job {job_id} --log-failed`
2. Create session:
   ```json
   {
     "workDir": "/path/to/project",
     "name": "fix-ci-{run}",
     "prompt": "Fix this CI failure:\n\n{error_logs}\n\nRun tsc --noEmit && npm run build && npm test to verify.",
     "permissionMode": "bypassPermissions"
   }
   ```
3. Monitor and verify
4. Push fix, check CI passes

### Batch Tasks Across Multiple Sessions

```bash
curl -X POST http://localhost:9100/v1/sessions/batch \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "sessions": [
      { "workDir": "/path/to/project", "name": "task-1", "prompt": "Fix auth bug in src/auth.ts" },
      { "workDir": "/path/to/project", "name": "task-2", "prompt": "Add tests for src/parser.ts" },
      { "workDir": "/path/to/project", "name": "task-3", "prompt": "Update README with new API docs" }
    ]
  }'
```

Or use pipelines for sequential stages with dependencies:
```bash
curl -X POST http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "full-cycle",
    "workDir": "/path/to/project",
    "steps": [
      { "name": "implement", "prompt": "Implement feature X in src/feature.ts" },
      { "name": "test", "prompt": "Write tests for the new feature in src/feature.test.ts", "dependsOn": ["implement"] },
      { "name": "verify", "prompt": "Run tsc --noEmit && npm run build && npm test", "dependsOn": ["test"] }
    ]
  }'
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `403 Forbidden` | Invalid or missing API key | Check `AEGIS_API_KEY` env var |
| `409 Conflict` on send | Session not idle (still processing) | Wait for `idle` status or `interrupt` first |
| `404 Not Found` on session | Session was killed or expired | Check with `GET /v1/sessions` |
| `422 Unprocessable` on create | `workDir` not in allowed list | Add workDir to `allowedWorkDirs` in Aegis config |
| `422` on verify | Quality gate failed | Check `steps[].error` for which step failed |
| Session stuck in `unknown` | CC still initializing or tmux issue | Wait 30s, then check pane: `GET /v1/sessions/{id}/pane` |
| Session stuck in `permission_prompt` | Awaiting approval | `POST /v1/sessions/{id}/approve` or `reject` |
| `npm error code 249` in CI | Recursive `postinstall` script | Remove `postinstall` from package.json |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_API_KEY` | — | API key for authentication |
| `AEGIS_PORT` | 9100 | Aegis server port |
| `AEGIS_HOST` | localhost | Aegis server host |

### MCP Setup (Alternative to REST)

If the agent has MCP access, the Aegis MCP server provides equivalent tools:

```
claude mcp add --scope user aegis -- npx @onestepat4time/aegis mcp
```

MCP tools: `create_session`, `send_message`, `get_transcript`, `approve_permission`, `reject_permission`, `kill_session`, `server_health`, `list_sessions`, `get_status`, `get_session_summary`, `capture_pane`, `interrupt_session`, `escape_session`, `send_bash`, `send_command`, `batch_create_sessions`, `list_pipelines`, `create_pipeline`, `get_swarm`, `get_session_metrics`, `get_session_latency`.

MCP prompts: `implement_issue`, `review_pr`, `debug_session`.

## Quick Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| Create session | POST | `/v1/sessions` |
| List sessions | GET | `/v1/sessions` |
| Get status | GET | `/v1/sessions/{id}` |
| Send message | POST | `/v1/sessions/{id}/send` |
| Read messages | GET | `/v1/sessions/{id}/read` |
| Get summary | GET | `/v1/sessions/{id}/summary` |
| Approve | POST | `/v1/sessions/{id}/approve` |
| Reject | POST | `/v1/sessions/{id}/reject` |
| Answer question | POST | `/v1/sessions/{id}/answer` |
| Interrupt | POST | `/v1/sessions/{id}/interrupt` |
| Escape | POST | `/v1/sessions/{id}/escape` |
| Run quality gate | POST | `/v1/sessions/{id}/verify` |
| Kill session | DELETE | `/v1/sessions/{id}` |
| Batch create | POST | `/v1/sessions/batch` |
| Create pipeline | POST | `/v1/pipelines` |
| Server health | GET | `/health` |
| SSE stream | GET | `/v1/sessions/{id}/events?token=T` |
