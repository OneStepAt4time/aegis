# Windsurf Integration

Use Aegis from Windsurf as a local MCP server.

## Prerequisites

- Windsurf build with MCP host support
- Local access to `npx`
- Aegis server running locally

## Configuration

Register Aegis as a stdio MCP server:

```json
{
  "mcpServers": {
    "aegis": {
      "command": "npx",
      "args": ["aegis", "mcp", "--port", "9100"]
    }
  }
}
```

## Smoke Test

1. Start Aegis.
2. Reload Windsurf.
3. Run `server_health`.
4. Create a scratch session with `create_session`.
5. Confirm `get_status` and `send_message` work.

## Notes

- If Windsurf supports environment variables for MCP servers, point it at the same local Node runtime used for Aegis.
- If your host keeps stale tool schemas, remove and re-add the `aegis` server entry.
