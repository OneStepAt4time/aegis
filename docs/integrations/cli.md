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

Create `.aegis/config.yaml` with an API token, preferred base URL, optional BYO-LLM defaults, and dashboard settings. **Zero-config mode**: `ag init` scaffolds the config, starts the server, and opens the dashboard in your browser — all in one command.

```bash
ag init                              # Scaffold + start server + open browser
ag init --no-open                    # Scaffold + start server, skip browser
ag init --no-start                   # Scaffold only, don't start server
ag init --yes                        # Non-interactive defaults for CI
ag init --yes --force                # Overwrite existing config in non-interactive mode
ag init --list-templates
ag init --from-template code-reviewer
```

**Zero-config behavior (default):**

1. Scaffolds `.aegis/config.yaml` with safe defaults (localhost only)
2. Auto-detects a free port (9100 default, increments until free)
3. Starts the Aegis server as a detached child process
4. Waits for health check (up to 30s)
5. Opens the dashboard in your default browser
6. Prints success message with URL, config path, and PID

If Aegis is **already running** on the target port, `ag init` prints the dashboard URL and exits with code 2. No duplicate instance is created.

The interactive flow is idempotent: if `.aegis/config.yaml` already exists, `ag init` keeps it unless you confirm an overwrite. In `--yes` mode, existing config is preserved by default — use `--force` (or `-f`) to allow overwriting.

**Exit codes:**

| Code | Meaning |
|------|----------|
| `0` | Success — config scaffolded, server started, browser opened |
| `1` | Error (port exhaustion, health check timeout, etc.) |
| `2` | Aegis already running (prints existing URL) |

**Project-local state:** When `ag init` creates a **new** config (no existing file), state (keys, auth-token) is stored in the project-local `.aegis/` directory alongside `config.yaml`, not in the global `~/.aegis/`. Existing configs are unaffected. You can override this with `AEGIS_STATE_DIR`.

If Claude Code (`claude`) is detected on your PATH, `ag init` will automatically offer to wire the Aegis MCP server into Claude Code. This adds Aegis tools to your Claude Code session without manual setup. In `--yes` mode, MCP wiring happens automatically (skipped in CI/test environments).

**Claude CLI auto-install:** If `claude` is not found on your PATH and `ANTHROPIC_API_KEY` is not set, `ag init` will prompt you to install Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`). In `--yes` mode, installation proceeds automatically. On Windows, the CLI provides `npm install -g @anthropic-ai/claude-code` guidance instead. If `ANTHROPIC_API_KEY` is already set, the install step is skipped (ACP can authenticate without the CLI).

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

**Flags:**

| Flag | Description |
|------|------------|
| `--yes` | Non-interactive mode — use all defaults |
| `--force` / `-f` | Overwrite existing config |
| `--no-start` | Scaffold config only, don't start the server |
| `--no-open` | Start server but skip opening the browser |
| `--model <provider/model>` | Set default model during setup |
| `--name <name>` | Set display name for the session |
| `--list-templates` | List available starter templates |
| `--from-template <name>` | Scaffold from a starter template |

### `ag run "prompt"` — Zero-to-Session

Bootstrap config, start the server, create a session, and stream output — all in one command.

```bash
ag run "Build a REST API for managing tasks" --cwd .
ag run "Fix the auth bug"                     # Uses current directory
ag run "Refactor the utils" --no-stream       # Wait for completion and print output
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

**Missing Claude CLI:** If `claude` is not found on your PATH and `ANTHROPIC_API_KEY` is not set, `ag run` prints a clear error with install instructions instead of silently failing. Set `ANTHROPIC_API_KEY` to use ACP mode without the CLI.

**Flags:**

| Flag | Description |
|------|-------------|
| `--cwd <path>` | Working directory (default: current directory) |
| `--port <number>` | Server port override |
| `--yes` | Suppress status messages for non-interactive/CI usage |
| `--accept-permissions` / `-y` | Auto-approve all permission prompts |
| `--passthrough` | Bypass all permissions (alias for `--accept-permissions`) |
| `--model <provider/model>` | Override the default model for this session |
| `--effort <level>` | Set reasoning effort: `low`, `medium`, `high`, or `0.0`–`1.0` |
| `--no-stream` | Wait for session completion and print output (non-streaming) |
| `--timeout <sec>` | Maximum wait time in seconds (default: 300). Set to `0` for no timeout |

**Exit codes: **

| Code | Meaning |
|------|---------|
| `0` | Session completed successfully |
| `1` | General error (server unreachable, session failed, etc.) |
| `2` | Rate limit hit (HTTP 429 from server) |

With `--no-stream`, exits non-zero if the poll receives no output.

**Environment variables:**

| Variable | Description |
|----------|------------|
| `AEGIS_RUN_TIMEOUT` | Default timeout for `ag run` in seconds (default: 300) |
| `AEGIS_SESSION_CREATION_TIMEOUT_MS` | Timeout in ms for the session creation POST during `ag run` (default: 120000). Increase for slow server/LLM startup |

### `ag` — Start Server

Start the Aegis HTTP server (port 9100).

```bash
ag                     # Default: port 9100, 127.0.0.1
ag --port 3000         # Custom port
ag --host 0.0.0.0      # Bind to all interfaces
ag --json-logs         # Structured JSON logs (for CI/programmatic use)
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--port <number>` | HTTP server port override |
| `--host <addr>` | Bind address |
| `--json-logs` | Output structured JSON logs instead of human-friendly hints (for CI/programmatic use) |

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
| `AEGIS_STATE_DIR` | `~/.aegis` (global) or `.aegis/` (project-local) | Session state directory. `ag init` defaults new configs to project-local |
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

### `ag auth migrate` — Migrate Auth Token

Migrate a `clientAuthToken` from `config.yaml` to the canonical auth-token file (single source of truth).

```bash
ag auth migrate
```

**What it does:**

1. Reads `clientAuthToken` from `.aegis/config.yaml`
2. Writes the token to the canonical auth-token path
3. Removes `clientAuthToken` from config.yaml
4. Reports what was migrated

Run this after upgrading from a version that stored tokens in config. If the token is already in the canonical location, it reports that and exits cleanly.

### `ag list` — List Sessions

List active and recent sessions.

```bash
ag list                        # Active sessions (truncated IDs)
ag list --all                  # Include killed/completed/crashed sessions
ag list --status running      # Filter by status
ag list --full-ids            # Show full UUIDs
ag list --json                # Machine-readable JSON output
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--all` | Include terminal sessions (`killed`, `completed`, `crashed`). Without this flag, only active sessions are shown. |
| `--status <value>` | Filter sessions by status (e.g. `running`, `idle`, `completed`) |
| `--cwd <path>` | Filter sessions by working directory |
| `--full-ids` | Show full UUIDs instead of truncated 8-char IDs |
| `--json` | Output session data as JSON (full IDs included), pipeable to `jq` |

By default, `ag list` hides sessions in terminal states (`killed`, `completed`, `crashed`). Use `--all` to see every session, including terminated ones.

### `ag read <id>` — Read Session Output

Fetch messages from a session.

```bash
ag read abc12345               # First 200 messages
ag read abc12345 --limit 50    # Last 50 messages
ag read abc12345 --page 2      # Paginate
ag read a9e0                   # Prefix match (8+ chars)
```

**Prefix matching:** `ag read`, `ag kill`, `ag tail`, and `ag status <id>` accept truncated session IDs (8+ characters). If the prefix is unique, it resolves automatically. If ambiguous or missing, an error is shown.

**Flags:**

| Flag | Description |
|------|-------------|
| `--page <number>` | Page number (default: 1) |
| `--limit <number>` | Messages per page (default: 200) |

### `ag kill <id>` — Terminate a Session

Kill a running session by ID. Supports prefix matching.

```bash
ag kill abc12345
ag kill 5070c990    # Prefix match
```

Sends `DELETE /v1/sessions/:id` and confirms termination. Sessions in terminal states (`killed`, `completed`, `crashed`) return `404`.

### `ag status [id]` — Server Health or Session Status

Without an argument, show server health and session summary. With a session ID, show detailed session status and cost metrics. Supports prefix matching.

```bash
ag status              # Server health
ag status abc12345     # Session details
ag status 5070c990     # Prefix match
```

Server mode displays version, status, uptime, port, and active/total session counts. Session mode displays session details and cost metrics.

### `ag tail <id>` — Follow Session in Real-Time

Stream session events as they arrive (SSE). Supports prefix matching.

```bash
ag tail abc12345
ag tail 5070c990     # Prefix match
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
| `--model <provider/model>` | Override the default model for this session |
| `--effort <level>` | Set reasoning effort: `low`, `medium`, `high`, or `0.0`–`1.0` |
| `--session-id <id>` | Send the brief to an existing session instead of creating a new one |
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
ag kill <id>           Terminate a session (prefix match)
ag status [id]         Server health or session details (prefix match)
ag tail <id>           Follow session events in real-time (prefix match)
ag create "brief"      Create + send
ag doctor              Validate starter scaffolds
ag mcp                 Start MCP server
ag --port 3000         Custom port
ag --help              Show all options
ag --version           Show version
```

> `aegis` remains available as an alias for every command above (e.g. `aegis mcp` still works).
