# Cursor Integration

Use Aegis as an MCP server inside Cursor.

## Prerequisites

- `aegis` installed or runnable via `npx`
- Cursor with MCP support enabled
- Local Aegis server reachable on `127.0.0.1:9100`

## Configuration

Add an MCP server entry that launches Aegis in stdio mode:

```json
{
  "mcpServers": {
    "aegis": {
      "command": "npx",
      "args": ["aegis", "mcp"]
    }
  }
}
```

## Verification

1. Start Aegis: `aegis start`
2. Restart Cursor
3. Check that Aegis tools appear
4. Call `server_health` and `list_sessions`

## Expected Working Tools

- `create_session`
- `list_sessions`
- `get_status`
- `get_transcript`
- `send_message`
- `approve_permission`
- `state_get` / `state_set` / `state_delete`

## Troubleshooting

- If the host cannot start the server, run `npx @onestepat4time/aegis mcp` manually.
- If HTTP calls fail, verify `http://127.0.0.1:9100/v1/health`.
- If tools are stale, restart the host after config changes.
