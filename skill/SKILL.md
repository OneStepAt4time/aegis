---
name: aegis-bridge
description: Orchestrate Claude Code sessions via Aegis HTTP/MCP bridge. Use when spawning CC sessions for coding tasks, implementing issues, reviewing PRs, fixing CI, batch tasks, or any multi-agent workflow. Triggers on "aegis", "spawn session", "orchestrate CC", "parallel agents", "create CC session", "send to CC". Requires Aegis server running on localhost:9100.
---

# Aegis — CC Session Orchestration

Aegis manages interactive Claude Code sessions via HTTP API (port 9100) or MCP tools. Each session runs CC in tmux with JSONL transcript parsing and bidirectional communication.

## Prerequisites

1. Aegis server running: `curl -s http://127.0.0.1:9100/v1/health`
2. MCP configured (optional, for native tool access): see [scripts/setup-mcp.sh](scripts/setup-mcp.sh)
3. Verify health: `bash scripts/health-check.sh`

## Core Workflow

```
create → send prompt → poll status → handle permissions → read result → quality gate → cleanup
```

### Step 1: Create Session

**MCP**: `create_session(workDir, name?, prompt?)`
**HTTP**:
```bash
SID=$(curl -s -X POST http://127.0.0.1:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workDir":"/path/to/project","name":"task-name"}' \
  | jq -r '.id')
```

> ⚠️ `workDir` must exist on disk or creation fails silently (returns `null` id).

Wait 8-10s for CC to boot. Check `promptDelivery.delivered` in the response — if `false`, resend via `send_message` after CC boots.

### Step 2: Send Prompt

**MCP**: `send_message(sessionId, text)`
**HTTP**:
```bash
curl -s -X POST http://127.0.0.1:9100/v1/sessions/$SID/send \
  -H "Content-Type: application/json" \
  -d '{"text":"Your task here"}'
```

### Step 3: Poll Until Idle

**MCP**: `get_status(sessionId)` — check `status` field
**HTTP**:
```bash
STATUS=$(curl -s http://127.0.0.1:9100/v1/sessions/$SID/read | jq -r '.status')
```

### Step 4: Handle Permission Prompts

While polling, react to non-idle states:

| Status | Action |
|--------|--------|
| `idle` | Done — read result |
| `working` | Wait (poll every 5s) |
| `permission_prompt` | `POST .../approve` (trust folder, tool use) |
| `bash_approval` | `POST .../approve` or `POST .../reject` |
| `plan_mode` | `POST .../approve` (option 1) or `POST .../escape` |
| `ask_question` | `POST .../send` with answer |
| `unknown` | `GET .../pane` for raw terminal output |

### Step 5: Read Transcript

**MCP**: `get_transcript(sessionId)`
**HTTP**: `curl -s http://127.0.0.1:9100/v1/sessions/$SID/read`

Returns `{ messages[], status, statusText }`. Each message: `{ role, contentType, text, timestamp }`.

### Step 6: Quality Gate

Before accepting output, verify:
1. Check transcript for tool errors or failed assertions
2. Run `tsc --noEmit` and build via `send_message` if needed
3. Confirm tests pass (request CC to run them)
4. Check for common issues: missing imports, hardcoded values, incomplete implementations

### Step 7: Cleanup

**MCP**: `kill_session(sessionId)`
**HTTP**: `curl -s -X DELETE http://127.0.0.1:9100/v1/sessions/$SID`

Always cleanup — idle sessions consume tmux windows and memory.

## Common Patterns

### Implement Issue

```
create_session(workDir=repo, name="impl-#123", prompt="Implement issue #123. Read the issue description first, then write code. Don't explain, just implement. Run tests when done.")
→ poll → approve permissions → read transcript → verify tests pass → cleanup
```

### Review PR

```
create_session(workDir=repo, name="review-PR-456", prompt="Review PR #456. Focus on: security issues, test coverage, API design. Be concise.")
→ poll → read transcript → extract review comments
```

### Fix CI

```
create_session(workDir=repo, name="fix-ci", prompt="CI is failing on main. Run the failing test suite, identify the root cause, and fix it. Don't add skip/only annotations.")
→ poll → approve bash commands → verify CI green → cleanup
```

### Batch Tasks

Spawn multiple sessions in parallel, then poll all:

```bash
for task in "task-a" "task-b" "task-c"; do
  curl -s -X POST http://127.0.0.1:9100/v1/sessions \
    -H "Content-Type: application/json" \
    -d "{\"workDir\":\"$REPO\",\"name\":\"$task\",\"prompt\":\"$task description\"}" \
    | jq -r '.id' >> /tmp/session-ids.txt
done
# Poll all until done
while read SID; do ... done < /tmp/session-ids.txt
```

## Stall Detection and Recovery

A session is **stalled** when `working` for >5 minutes with no transcript change.

### Detection

```bash
HASH1=$(curl -s http://127.0.0.1:9100/v1/sessions/$SID/read | jq -r '.messages | length')
sleep 30
HASH2=$(curl -s http://127.0.0.1:9100/v1/sessions/$SID/read | jq -r '.messages | length')
# If HASH1 == HASH2 and status is still "working", likely stalled
```

### Recovery Options (in order)

1. **Nudge** — send `send_message("Continue. What's blocking you?")`
2. **Interrupt** — `POST .../interrupt` then resend the task
3. **Refine** — send a simplified or decomposed version of the task
4. **Pivot** — kill session, create new one with a different approach
5. **Escalate** — abandon automated approach, notify human

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Connection refused` on 9100 | Aegis not running. Check `scripts/health-check.sh` |
| Session stuck at `unknown` | `GET .../pane` for raw output. May need `POST .../escape` |
| Permission loop (approve keeps coming) | Likely bash approval. Check transcript for the command. Reject if unsafe |
| `promptDelivery: "failed"` | CC didn't boot yet. Wait 10s and resend via `send_message` |
| Session not appearing in `list_sessions` | Check `workDir` filter. Session may have been killed |
| High memory usage | Kill idle sessions. Use `list_sessions` to find orphans |

## MCP Tool Reference

When MCP is configured, 21 tools are available natively:

### Session Lifecycle
| Tool | Description |
|------|-------------|
| `create_session` | Spawn new CC session (workDir, name, prompt) |
| `list_sessions` | List sessions, filter by status/workDir |
| `get_status` | Detailed session status + health |
| `kill_session` | Kill session + cleanup resources |
| `batch_create_sessions` | Spawn multiple sessions at once |

### Communication
| Tool | Description |
|------|-------------|
| `send_message` | Send text to a session |
| `send_bash` | Execute bash via `!` prefix |
| `send_command` | Send /slash command |
| `get_transcript` | Read conversation transcript |
| `capture_pane` | Raw terminal output |
| `get_session_summary` | Summary with message counts + duration |

### Permission Handling
| Tool | Description |
|------|-------------|
| `approve_permission` | Approve pending prompt |
| `reject_permission` | Reject pending prompt |
| `escape_session` | Send Escape key (dismiss dialogs) |
| `interrupt_session` | Send Ctrl+C |

### Monitoring
| Tool | Description |
|------|-------------|
| `server_health` | Server version, uptime, session counts |
| `get_session_metrics` | Per-session performance metrics |
| `get_session_latency` | Latency measurements |

### Advanced
| Tool | Description |
|------|-------------|
| `list_pipelines` | List multi-step pipelines |
| `create_pipeline` | Create orchestrated pipeline |
| `get_swarm` | Swarm status for parallel sessions |

For full API reference, see [references/api-quick-ref.md](references/api-quick-ref.md).
For agent templates, see [references/agent-template.md](references/agent-template.md).
For heartbeat/dev-loop templates, see [references/heartbeat-template.md](references/heartbeat-template.md).
