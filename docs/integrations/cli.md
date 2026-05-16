# CLI Reference

The `ag` command-line tool starts the Aegis server, launches MCP sessions, and provides quick session management.

> The primary CLI command is `ag`. The legacy name `aegis` is kept as an alias for backward compatibility — both resolve to the same binary, so any existing scripts using `aegis` keep working.

## Installation

```bash
npm install -g @onestepat4time/aegis
# or without a global install:
npx --package=@onestepat4time/aegis ag
```

## Commands

### `ag init` — Bootstrap a Project

Create `.aegis/config.yaml` with an API token, preferred base URL, optional BYO-LLM defaults, and dashboard settings.

```bash
ag init
ag init --yes            # Non-interactive defaults for CI
ag init --yes --force     # Overwrite existing config in non-interactive mode
ag init --list-templates
ag init --from-template code-reviewer
```

The interactive flow is idempotent: if `.aegis/config.yaml` already exists, `ag init` keeps it unless you confirm an overwrite. In `--yes` mode, existing config is preserved by default — use `--force` (or `-f`) to allow overwriting.

`ag init` also exposes the built-in starter gallery for Claude Code helpers:

- `code-reviewer` (agent)
- `ci-runner` (slash-command)
- `pr-reviewer` (slash-command)
- `docs-writer` (skill)

Scaffold one into the current directory, then validate it:

```bash
ag init --from-template docs-writer
ag doctor
```

### `ag run "prompt"` — Zero-to-Session

Bootstrap config, start the server, create a session, and stream output — all in one command.

```bash
ag run "Build a REST API for managing tasks" --cwd .
ag run "Fix the auth bug"                     # Uses current directory
ag run "Refactor the utils" --no-stream       # Print curl commands instead of streaming
ag run "Debug the tests" --port 3000          # Custom server port
ag run "Fix CI" --yes                        # Non-interactive (CI-friendly)
```

**What it does:**

1. Checks server health — is it running?
2. If not: bootstraps config (if none exists) → starts server in background → waits up to 15s
3. Creates a session with the prompt and working directory
4. Streams session output to your terminal with role icons (`👤` user, `🤖` assistant)
5. Prints the dashboard URL for follow-up monitoring

If the server is already running, skips straight to session creation. Existing config is never overwritten (respects `--force` behavior from `ag init`).

**Flags:**

| Flag | Description |
|------|-------------|
| `--cwd <path>` | Working directory (default: current directory) |
| `--port <number>` | Server port override |
| `--no-stream` | Don't stream output; print curl commands instead |

### `ag` — Start Server

Start the Aegis HTTP server (port 9100).

```bash
ag                     # Default: port 9100, 127.0.0.1
ag --port 3000         # Custom port
ag --host 0.0.0.0      # Bind to all interfaces
```

Requires `AEGIS_AUTH_TOKEN` for production use:

```bash
AEGIS_AUTH_TOKEN=secret ag
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_BASE_URL` | `http://127.0.0.1:9100` | Preferred API origin for hooks + CLI clients |
| `AEGIS_PORT` | `9100` | HTTP server port |
| `AEGIS_HOST` | `127.0.0.1` | Bind address |
| `AEGIS_AUTH_TOKEN` | _(none)_ | Bearer token (required for production) |
| `AEGIS_DASHBOARD_ENABLED` | `true` | Serve the bundled dashboard |
| `AEGIS_STATE_DIR` | `~/.aegis` | Session state directory |
| `AEGIS_MAX_SESSIONS` | _(unlimited)_ | Max concurrent sessions |
| `AEGIS_IDLE_TIMEOUT_MS` | `600000` | Idle timeout (10 min) |
| `AEGIS_STALL_THRESHOLD_MS` | `120000` | Stall threshold (2 min) |

### `ag mcp` — Start MCP Server

Start Aegis as an MCP stdio server for Claude Code, Cursor, Windsurf, and other MCP hosts.

```bash
ag mcp                    # Default: connects to localhost:9100
AEGIS_PORT=3000 ag mcp    # Custom API port
```

The MCP server wraps the REST API as tools — authenticate with:

```bash
AEGIS_AUTH_TOKEN=secret ag mcp
```

For Claude Code:

```bash
claude mcp add aegis -- ag mcp
```

For other MCP hosts (Cursor, Windsurf), see the [Cursor integration](./cursor.md) or [Windsurf integration](./windsurf.md).

### `ag list` — List Sessions

List active and recent sessions.

```bash
ag list                        # All sessions
ag list --status running      # Filter by status
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--status <value>` | Filter sessions by status (e.g. `running`, `idle`, `completed`) |

Displays each session as a compact row with truncated ID, status, and display name.

### `ag read <id>` — Read Session Output

Fetch messages from a session.

```bash
ag read abc12345               # First 200 messages
ag read abc12345 --limit 50    # Last 50 messages
ag read abc12345 --page 2      # Paginate
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--page <number>` | Page number (default: 1) |
| `--limit <number>` | Messages per page (default: 200) |

### `ag kill <id>` — Terminate a Session

Kill a running session by ID.

```bash
ag kill abc12345
```

Sends `DELETE /v1/sessions/:id` and confirms termination. Sessions in terminal states (`killed`, `completed`, `crashed`) return `404`.

### `ag status` — Server Health

Show server health and session summary.

```bash
ag status
```

Displays version, status, uptime, port, and active/total session counts.

### `ag tail <id>` — Follow Session in Real-Time

Stream session events as they arrive (SSE).

```bash
ag tail abc12345
```

Connects to the session's event stream and prints output live. Press `Ctrl+C` to stop.

### `ag create "brief"` — Quick Session

Create a session and send a brief in one command.

```bash
ag create "Build a login page with email and password" --cwd /path/to/project
ag create "Fix the failing tests"                     # Uses current directory
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

### `ag doctor` — Validate Starter Scaffolds

Run local health checks for built-in gallery files generated by `ag init --from-template`.

```bash
ag doctor
```

Today this command validates that any generated gallery files are present,
readable, and still include the self-documenting sections expected by the
template gallery.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (server failed, session creation failed) |

## Examples

**Start server with auth:**

```bash
AEGIS_AUTH_TOKEN=my-secret ag --port 9100
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
ag
```

**Quick session from project directory:**

```bash
cd /path/to/project
AEGIS_AUTH_TOKEN=secret ag create "Review the code and suggest improvements"
```

**Start MCP server for Claude Code:**

```bash
AEGIS_AUTH_TOKEN=secret ag mcp
```

## Quick Reference

```
ag                     Start HTTP server
ag init                Bootstrap .aegis/config.yaml
ag init --list-templates
ag init --from-template code-reviewer
ag run "prompt"        Zero-to-session (bootstrap + start + create + stream)
ag list                List sessions
ag read <id>           Read session output
ag kill <id>           Terminate a session
ag status              Server health + session summary
ag tail <id>           Follow session events in real-time
ag create "brief"      Create + send
ag doctor              Validate starter scaffolds
ag mcp                 Start MCP server
ag --port 3000         Custom port
ag --help              Show all options
ag --version           Show version
```

> `aegis` remains available as an alias for every command above (e.g. `aegis mcp` still works).
