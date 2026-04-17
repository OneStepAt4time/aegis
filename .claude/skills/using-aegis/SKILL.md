---
name: using-aegis
description: Use when delegating coding work to a background Claude Code session, running multiple Claude Code agents in parallel, approving/monitoring/messaging another Claude Code session, or when the user mentions Aegis, @onestepat4time/aegis, aegis-bridge, session swarm, or localhost:9100
---

# Using Aegis

## Overview

Aegis is a self-hosted HTTP server (default `http://localhost:9100`) that spawns Claude Code in tmux and exposes session lifecycle, messaging, permission approval, and event streams via REST and MCP. **Bridge, not orchestrator** — you own the intelligence, Aegis owns the mechanics.

## When to use

- Delegate a long-running coding task to a background Claude Code session
- Run 2+ Claude Code agents in parallel
- Programmatically approve/monitor/message another session
- Chain multi-stage work (review → fix → test) as a pipeline
- Share state between sessions via Memory Bridge

**Don't use** for work you can finish here, one-shot questions (use `claude` CLI), or as a generic tmux manager.

## Access paths

- **MCP (preferred):** `create_session`, `send_message`, etc. Setup: `claude mcp add aegis -- npx @onestepat4time/aegis mcp`.
- **REST (fallback):** `http://localhost:9100/v1/*`. Add `Authorization: Bearer $AEGIS_AUTH_TOKEN` if configured.

## Bootstrap — verify availability first

1. MCP host lists an `aegis` server → use MCP.
2. Else `curl -s http://localhost:9100/v1/health` returns `ok` → use REST.
3. Neither → ask the user to start `npx @onestepat4time/aegis`. Do **not** silently spawn it.

## Session states

| State | Meaning | Action |
|---|---|---|
| `working` | Generating | Poll every 2–5 s or read transcript |
| `idle` | Waiting for input | `send_message` or move on |
| `asking` | Claude asked a question | Read transcript, reply via `send_message` |
| `permission_prompt` | Tool call awaiting approval | `approve_permission` / `reject_permission` |
| `stalled` | No output >5 min | Nudge, `interrupt_session`, or `kill_session` |

## Core MCP tools (25 total)

| Category | Tools |
|---|---|
| Lifecycle | `create_session`, `kill_session`, `list_sessions`, `get_status`, `interrupt_session`, `escape_session` |
| Comm | `send_message`, `send_bash`, `send_command` |
| Observability | `get_transcript`, `capture_pane`, `get_session_summary`, `get_session_metrics`, `server_health` |
| Permissions | `approve_permission`, `reject_permission` |
| Orchestration | `batch_create_sessions`, `create_pipeline`, `list_pipelines`, `get_swarm` |
| Shared state | `state_set`, `state_get`, `state_delete` |

Full reference: https://github.com/OneStepAt4time/aegis/blob/main/docs/mcp-tools.md

## Example — delegate a fix (MCP)

```jsonc
create_session({ workDir: "/repo", prompt: "Fix 401 in src/auth.ts. Run tests. Commit on a new branch." })
// → { sessionId: "abc123", status: "working" }
get_status({ sessionId: "abc123" })           // poll until permission_prompt or idle
approve_permission({ sessionId: "abc123" })   // when waiting on approval
get_transcript({ sessionId: "abc123" })       // read result
kill_session({ sessionId: "abc123" })         // clean up
```

**REST equivalent:** `POST /v1/sessions` → `GET /v1/sessions/:id` → `POST /v1/sessions/:id/approve` → `GET /v1/sessions/:id/read` → `DELETE /v1/sessions/:id`. **Parallel:** `batch_create_sessions`. **Sequential stages:** `create_pipeline`.

## Session reuse gotcha

`create_session` with a `workDir` that already has an **idle** session returns `"reused": true` — the prompt goes to the existing session. Working/stalled/permission-prompt sessions are never reused. Kill first for a guaranteed fresh session.

## Common mistakes

| Mistake | Fix |
|---|---|
| Skipping health check | `server_health` first — fail fast |
| Hardcoding port 9100 | Read `AEGIS_PORT`, fall back to 9100 |
| Tight polling loop | 2–5 s backoff, or SSE `/v1/sessions/:id/events` |
| Ignoring `permission_prompt` | Every polling loop must handle it or sessions hang |
| Leaking sessions | Always `kill_session` when done |
| Parsing `capture_pane` | Use `get_transcript` (JSONL-parsed, no ANSI noise) |
| Spawning `claude`/`tmux` yourself | Use `create_session` / `batch_create_sessions` |
