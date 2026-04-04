# Aegis Skill (OpenClaw)

Install and run Aegis orchestration workflows from Claude Code via MCP.

## Prerequisites

- Node.js 20+
- Claude Code CLI available in PATH
- Aegis server running locally (`aegis-bridge start`)

## Quick Install

```bash
skill install aegis-bridge
```

Then configure MCP:

```bash
bash skill/scripts/setup-mcp.sh user
```

Or project-scoped:

```bash
bash skill/scripts/setup-mcp.sh project
```

## Verification

```bash
bash skill/scripts/health-check.sh
```

Expected output includes `OK` and exit code `0`.

## Troubleshooting

- If connection fails, start server with `aegis-bridge start`.
- If MCP server is missing, run setup script again and restart Claude Code.
- If `jq` is missing, install it and rerun scripts.

## Environment Variables

- `AEGIS_HOST` (default `127.0.0.1`)
- `AEGIS_PORT` (default `9100`)
