# Cursor Integration

Use Aegis as an MCP server inside Cursor.

## Prerequisites

- [Aegis installed](https://github.com/OneStepAt4time/aegis#installation) so the primary `ag` CLI is on your PATH
- Cursor with MCP support enabled
- Aegis server running on `127.0.0.1:9100`

## Configuration

Add an MCP server entry in your Cursor settings (`~/.cursor/settings.json` or the GUI MCP settings):

```json
{
  "mcpServers": {
    "aegis": {
      "command": "ag",
      "args": ["mcp"]
    }
  }
}
```

Without a global install, use:

```json
{
  "mcpServers": {
    "aegis": {
      "command": "npx",
      "args": ["--package=@onestepat4time/aegis", "ag", "mcp"]
    }
  }
}
```

Then restart Cursor.

## Setup

1. Start the Aegis server (in a terminal):
   ```bash
   ag
   # or with custom port:
   ag --port 9100
   ```
2. Verify Aegis is running:
   ```bash
   curl http://127.0.0.1:9100/v1/health
   ```
3. Restart Cursor to load the MCP tools

## Available MCP Tools (24 total)

**Session management:**
- `create_session` — create a new Claude Code session
- `list_sessions` — list all sessions (filter by status or workDir)
- `get_status` — get session status
- `get_session_summary` — session summary with message count

**Messaging:**
- `send_message` — send a message to a session
- `get_transcript` — read the full message transcript

**Session control:**
- `approve_permission` — approve a pending permission prompt
- `reject_permission` — reject a pending permission prompt
- `interrupt_session` — interrupt the running Claude Code
- `escape_session` — escape from ask_question mode
- `kill_session` — terminate a session

**Observability:**
- `server_health` — check Aegis server health
- `get_session_metrics` — token usage, duration, tool call counts
- `get_session_latency` — per-operation latency breakdown

**Batch & pipelines:**
- `batch_create_sessions` — create multiple sessions at once
- `create_pipeline` — create a multi-step pipeline

**Memory:**
- `state_get` — read a value from session-scoped memory
- `state_set` — write a value to session-scoped memory
- `state_delete` — delete a memory entry

For the full reference, see [MCP Tools](../mcp-tools.md).

## Troubleshooting

| Problem | Solution |
|---------|---------|
| Tools don't appear in Cursor | Restart Cursor after saving MCP config |
| "Server not reachable" errors | Ensure Aegis is running: `curl http://127.0.0.1:9100/v1/health` |
| Auth errors | Set `AEGIS_AUTH_TOKEN` env var before starting Aegis |
| Stale tool data | Restart the Aegis server and Cursor |

For more help, see the [full MCP tools reference](../mcp-tools.md).
