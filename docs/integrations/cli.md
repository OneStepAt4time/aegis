# CLI Reference

The `aegis` command-line tool starts the Aegis server, launches MCP sessions, and provides quick session management.

## Installation

```bash
npm install -g @onestepat4time/aegis
# or via npx:
npx @onestepat4time/aegis
```

## Commands

### `aegis` — Start Server

Start the Aegis HTTP server (port 9100).

```bash
aegis                     # Default: port 9100, 127.0.0.1
aegis --port 3000         # Custom port
aegis --host 0.0.0.0      # Bind to all interfaces
```

Requires `AEGIS_AUTH_TOKEN` for production use:

```bash
AEGIS_AUTH_TOKEN=secret aegis
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_PORT` | `9100` | HTTP server port |
| `AEGIS_HOST` | `127.0.0.1` | Bind address |
| `AEGIS_AUTH_TOKEN` | _(none)_ | Bearer token (required for production) |
| `AEGIS_STATE_DIR` | `~/.aegis` | Session state directory |
| `AEGIS_TMUX_SESSION` | `aegis` | Base tmux session name |
| `AEGIS_MAX_SESSIONS` | _(unlimited)_ | Max concurrent sessions |
| `AEGIS_IDLE_TIMEOUT_MS` | `600000` | Idle timeout (10 min) |
| `AEGIS_STALL_THRESHOLD_MS` | `120000` | Stall threshold (2 min) |

### `aegis mcp` — Start MCP Server

Start Aegis as an MCP stdio server for Claude Code, Cursor, Windsurf, and other MCP hosts.

```bash
aegis mcp                    # Default: connects to localhost:9100
AEGIS_PORT=3000 aegis mcp    # Custom API port
```

The MCP server wraps the REST API as tools — authenticate with:

```bash
AEGIS_AUTH_TOKEN=secret aegis mcp
```

For Claude Code:

```bash
claude mcp add aegis -- npx @onestepat4time/aegis mcp
```

For other MCP hosts (Cursor, Windsurf), see the [Cursor integration](./cursor.md) or [Windsurf integration](./windsurf.md).

### `aegis create "brief"` — Quick Session

Create a session and send a brief in one command.

```bash
aegis create "Build a login page with email and password" --cwd /path/to/project
aegis create "Fix the failing tests"                     # Uses current directory
```

**Options:**

| Flag | Description |
|------|-------------|
| `--cwd <dir>` | Working directory for the session |
| `--port <port>` | Aegis API port (default: `AEGIS_PORT` or `9100`) |

This is a convenience wrapper that:
1. Creates a session via `POST /v1/sessions`
2. Sends the brief via `POST /v1/sessions/:id/send`
3. Polls for status until delivered

### Flags

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |
| `--port <port>` | Server port (default: 9100) |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (server failed, session creation failed) |

## Examples

**Start server with auth:**

```bash
AEGIS_AUTH_TOKEN=my-secret aegis --port 9100
```

**Start with notification channels:**

```bash
AEGIS_AUTH_TOKEN=secret \
AEGIS_TG_BOT_TOKEN=123456:ABC \
AEGIS_TG_GROUP_ID=-1001234567890 \
AEGIS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx \
AEGIS_EMAIL_HOST=smtp.example.com \
AEGIS_EMAIL_USER=alerts@example.com \
AEGIS_EMAIL_PASS=app-password \
AEGIS_EMAIL_TO=ops@example.com \
aegis
```

**Quick session from project directory:**

```bash
cd /path/to/project
AEGIS_AUTH_TOKEN=secret aegis create "Review the code and suggest improvements"
```

**Start MCP server for Claude Code:**

```bash
AEGIS_AUTH_TOKEN=secret aegis mcp
```

## Quick Reference

```
aegis                     Start HTTP server
aegis --port 3000         Custom port
aegis mcp                 Start MCP server
aegis create "brief"      Create + send
aegis --help              Show all options
aegis --version           Show version
```
