# Aegis Onboarding Guide

Welcome to Aegis. This guide gets you from zero to running your first session in 5 minutes.

## What is Aegis?

Aegis is a **Claude Code control plane** — a self-hosted server that wraps Claude Code sessions in tmux and exposes them via REST API, MCP tools, CLI, and a web dashboard. You orchestrate AI coding work programmatically or visually.

**Use cases:**
- Run multiple Claude Code sessions in parallel, monitored from one dashboard
- Integrate Claude Code into your CI/CD pipelines via REST API
- Give non-technical teammates a dashboard to monitor AI-assisted development
- Build multi-agent workflows that delegate to Claude Code sessions

## Prerequisites

- **Node.js 20+**
- **tmux 3.2+** (or psmux on Windows)
- **Claude Code CLI** installed and configured (`claude --version`)

Install tmux:
```bash
# Linux
sudo apt install tmux

# macOS
brew install tmux

# Windows (WSL2)
sudo apt install tmux
```

## Quick Start

```bash
# 1. Install Aegis
npm install -g @onestepat4time/aegis

# 2. Bootstrap configuration (creates ~/.aegis/config.json)
ag init

# 3. Start the server
ag
```

The server starts on `http://localhost:9100`. Open `http://localhost:9100/dashboard/` for the web UI.

## Core Concepts

### Sessions

A **session** is one Claude Code process running in a tmux window. Each session has:
- A unique ID (UUID)
- A display name (e.g., `cc-my-task`)
- A working directory
- A JSONL transcript file

Create a session:
```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/path/to/project", "prompt": "Review the PR and summarize the changes"}'
```

The response includes a session ID. Save it for subsequent API calls.

### Session Lifecycle

```
create → working → permission_prompt? → idle → done
                    ↑_______________|
                rate_limit?
                    |
              (interactive menu)
```

1. **create** — Session starts, Claude Code initializes
2. **working** — Claude Code is processing
3. **permission_prompt** — Waiting for approval (see Permission Modes below)
4. **idle** — Claude Code finished, ready for next prompt
5. **rate_limit** — Claude Code hit a rate limit and is showing an interactive menu (choose an option or wait)
6. **done** — Session terminated

Poll for status:
```bash
curl http://localhost:9100/v1/sessions/{id}
```

Read the transcript when idle:
```bash
curl http://localhost:9100/v1/sessions/{id}/read
```

Send a follow-up:
```bash
curl -X POST http://localhost:9100/v1/sessions/{id}/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Now implement the fix"}'
```

### Permission Modes

When creating a session, choose how Claude Code handles sensitive operations:

| Mode | Behavior |
|------|----------|
| `default` | Prompts for dangerous operations (recommended) |
| `bypassPermissions` | Auto-approves every operation |
| `plan` | Runs in plan mode first, waits for confirmation |
| `acceptEdits` | Auto-accepts non-destructive edits only |
| `dontAsk` | No prompts — fails on dangerous operations |
| `auto` | Claude Code decides (context-dependent) |

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/path", "prompt": "...", "permissionMode": "bypassPermissions"}'
```

## CLI Reference

```bash
ag                          # Start the server
ag "do something"           # Create session + send brief (shorthand)
ag init                     # Bootstrap config interactively
ag init --list-templates    # List available templates
ag init --from-template X   # Scaffold from a template
ag doctor                   # Run diagnostics
ag mcp                      # Start MCP server (stdio mode)
ag login                    # Authenticate via OIDC device flow
ag logout                   # Remove stored credentials
ag whoami                   # Show current identity and role
```

### Built-in Templates

Scaffold predefined Claude Code configurations:

```bash
ag init --list-templates    # See all templates
ag init --from-template code-reviewer   # Review agent
ag init --from-template pr-reviewer     # PR review agent
ag init --from-template ci-runner       # CI quality gate
ag init --from-template docs-writer     # Documentation agent
```

### CLI Authentication (OIDC)

Requires `AEGIS_OIDC_ISSUER` and `AEGIS_OIDC_CLIENT_ID` to be set. The CLI authenticates directly with your IdP using the OAuth2 device authorization grant (RFC 8628).

#### `ag login`

Opens a browser-based auth flow. Prints a verification URL and code — visit the URL, enter the code, and the CLI polls until you authorize.

```bash
ag login                          # Interactive auth
ag login --server http://aegis:9100  # Override server URL
ag login --no-open                 # Don't auto-open browser
ag login --json                    # Machine-readable output
```

**Exit codes:** `0` = success, `1` = auth failed/timeout, `2` = config error (OIDC not set up).

#### `ag logout`

Removes stored credentials. Attempts token revocation at the IdP (best-effort).

```bash
ag logout              # Logout from default server
ag logout --all        # Logout from all servers
ag logout --server URL # Logout from a specific server
ag logout --json       # Machine-readable output
```

#### `ag whoami`

Shows the currently authenticated identity, role, and token expiry. Automatically refreshes expired tokens if a refresh token is available.

```bash
ag whoami              # Show current identity
ag whoami --server URL # Show identity for a specific server
ag whoami --json       # Machine-readable output
```

Tokens are stored in `~/.aegis/auth/` by default (configurable via `AEGIS_OIDC_AUTH_DIR`).

## MCP Integration

Connect Aegis tools directly inside Claude Code. This lets Claude Code create sub-sessions, send prompts, and orchestrate other agents.

```bash
# Register Aegis MCP tools in Claude Code
claude mcp add aegis -- npx @onestepat4time/aegis mcp
```

Aegis exposes **24 MCP tools** covering:
- Session management (create, send, kill, interrupt, approve, reject)
- Observability (transcript, metrics, SSE events, screenshots)
- State (key-value memory bridge)
- Orchestration (batch create, pipelines)

See [MCP Tools](mcp-tools.md) for the full reference.

## REST API

All endpoints are under `/v1/`. Base URL: `http://localhost:9100`

**Key endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/health` | Server health check |
| `POST` | `/v1/sessions` | Create a session |
| `GET` | `/v1/sessions` | List all sessions |
| `GET` | `/v1/sessions/:id` | Get session status |
| `POST` | `/v1/sessions/:id/send` | Send a message |
| `GET` | `/v1/sessions/:id/read` | Read transcript |
| `DELETE` | `/v1/sessions/:id` | Kill session |
| `GET` | `/v1/sessions/:id/sse` | SSE event stream |
| `POST` | `/v1/sessions/:id/approve` | Approve permission |
| `POST` | `/v1/sessions/:id/reject` | Reject permission |
| `GET` | `/v1/metrics` | Prometheus metrics |
| `GET` | `/v1/openapi.json` | OpenAPI 3.1 spec |

See [API Reference](api-reference.md) for the full endpoint documentation.

## Dashboard

The web dashboard is at `http://localhost:9100/dashboard/`.

Features:
- Session list with live status
- Session detail with transcript viewer
- New session creation
- Audit log
- Settings

The dashboard requires authentication. Run `ag init` to set up your auth token.

## Configuration

Config file: `~/.aegis/config.json`

```json
{
  "host": "127.0.0.1",
  "port": 9100,
  "authToken": "your-secret-token",
  "allowedWorkDirs": ["~/projects", "/tmp"],
  "tmux": {
    "socketName": "aegis"
  }
}
```

Environment variables override config values. Prefix with `AEGIS_`:
- `AEGIS_HOST`, `AEGIS_PORT`, `AEGIS_AUTH_TOKEN`, `AEGIS_STATE_DIR`

See [Configuration Reference](getting-started.md#configuration) for all options.

## Troubleshooting

**Server won't start:**
```bash
ag doctor   # Run diagnostics
# Check: tmux installed? port 9100 free? Claude Code available?
```

**Session stuck on `permission_prompt`:**
```bash
curl -X POST http://localhost:9100/v1/sessions/{id}/approve
# or reject:
curl -X POST http://localhost:9100/v1/sessions/{id}/reject
```

**Claude Code not found:**
```bash
claude --version   # Verify installation
export PATH="$PATH:$(which claude)"   # Add to PATH
```

**tmux not found:**
```bash
tmux -V   # Should print tmux version
# If not: sudo apt install tmux (Linux) or brew install tmux (macOS)
```

See the [Troubleshooting](troubleshooting.md) guide for more.

## Next Steps

- [Getting Started](getting-started.md) — Full walkthrough
- [API Reference](api-reference.md) — All REST endpoints
- [MCP Tools](mcp-tools.md) — All MCP tool definitions
- [Advanced Features](advanced.md) — Pipelines, templates, memory bridge
- [Deployment Guide](deployment.md) — Production deployment
