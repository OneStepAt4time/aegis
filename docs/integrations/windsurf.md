# Windsurf Integration

Use Aegis from Windsurf as a local MCP server.

## Prerequisites

- Windsurf with MCP support enabled
- [Aegis installed](https://github.com/OneStepAt4time/aegis#installation) so `ag` is on your PATH
- Aegis server running on `127.0.0.1:9100`

## Configuration

Add to your Windsurf MCP settings:

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

Then reload Windsurf.

## Setup

1. Start the Aegis server:
   ```bash
   AEGIS_AUTH_TOKEN=your-token ag
   # or without auth:
   ag
   ```
2. Verify it's running:
   ```bash
   curl http://127.0.0.1:9100/v1/health
   ```
3. Reload Windsurf to load the tools

## How It Works

The MCP server connects to your Aegis HTTP API at `localhost:9100`. It wraps the REST API as MCP tools — any operation you can do via HTTP, you can do via the MCP tool in Windsurf.

If you set `AEGIS_AUTH_TOKEN`, the MCP server passes it as a Bearer token to Aegis.

## Available Tools

Same 24 tools as the Cursor integration. See [MCP Tools](../mcp-tools.md) for the full reference.

## Troubleshooting

| Problem | Solution |
|---------|---------|
| "Connection refused" | Start Aegis first: `ag` |
| 401 Unauthorized | Set `AEGIS_AUTH_TOKEN` env var before starting Aegis |
| Tools not loading | Reload Windsurf after saving MCP config |
| Stale schemas | Remove the `aegis` entry, restart Windsurf, re-add |
