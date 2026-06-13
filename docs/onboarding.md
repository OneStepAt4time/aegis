# Aegis Onboarding Guide

Welcome to Aegis. This guide gets you from zero to running your first Claude Code session in under 5 minutes.

## What is Aegis?

Aegis is a **Claude Code control plane** — a self-hosted server that manages Claude Code sessions via the ACP (Agent Control Protocol) runtime and exposes them via REST API, MCP tools, CLI, and a web dashboard. You orchestrate AI coding work programmatically or visually.

**Use cases:**
- Run multiple Claude Code sessions in parallel, monitored from one dashboard
- Integrate Claude Code into your CI/CD pipelines via REST API
- Give non-technical teammates a dashboard to monitor AI-assisted development
- Build multi-agent workflows that delegate to Claude Code sessions

## Prerequisites

| Requirement | Minimum Version | Check Command |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| Claude Code CLI | ≥ 2.1.145 | `claude --version` |
| Claude Code auth | Logged in | `claude auth status` |

Aegis bundles `claude-agent-acp` — no tmux or psmux required on any platform.

> **Before you start:** Claude Code must be authenticated. Run `claude auth status` — if it shows "Not logged in", run `claude login` first. Sessions created without Claude auth will silently produce no output.

## Quick Start (1 command)

```bash
npx --package=@onestepat4time/aegis ag run "Summarize this folder" --cwd ./my-project
```

That's it. Behind the scenes, `ag run`:
1. Bootstraps config (first run only — no auth prompts on localhost)
2. Starts the server on `http://127.0.0.1:9100`
3. Creates a Claude Code session
4. Streams Claude's response to your terminal

When Claude needs permission (to run a command, write a file), you'll see a prompt right in your terminal.

> **Zero-config on localhost:** When the server host is `localhost`, `127.0.0.1`, or `::1`, no auth tokens are needed. Aegis auto-configures for local use. No setup, no prompts.
>
> **System temp dirs are blocked:** `/tmp`, `/var/tmp` are not allowed as workDir for security. Run from your project directory or home folder.

Open **http://127.0.0.1:9100/dashboard/** in your browser to see your session with live status, cost tracking, and transcript.

## Step-by-Step Setup (alternative)

If you prefer to control each step separately:

### 1. Install Aegis

```bash
npm install -g @onestepat4time/aegis
```

### 2. Bootstrap configuration

```bash
ag init
```

`ag init` scaffolds `.aegis/config.yaml` with sensible defaults, auto-detects a free port (9100 default), and — if Claude Code is on your PATH — automatically offers to register Aegis as an MCP server in Claude Code.

```bash
ag init --yes       # Non-interactive — use all defaults, auto-wire MCP
ag init --force     # Overwrite existing config
ag init --no-start  # Scaffold config only (don't start the server)
ag init --no-open   # Start server but skip opening the browser
```

> **Zero-config on localhost:** On `localhost`, `127.0.0.1`, or `::1`, `ag init` skips admin token creation. No auth setup needed.
>
> **Warning:** Running `ag init` a second time overwrites `.aegis/config.yaml` and regenerates auth keys. You must restart the server for the new keys to take effect — the running server does not hot-reload keys from disk.

### 3. Start the server

```bash
ag
```

The server starts on `http://localhost:9100`. Verify:

```bash
curl http://localhost:9100/v1/health
```

### 4. Run your first session

```bash
# Via CLI (streams output to terminal)
ag run "Review the PR and summarize the changes" --cwd /path/to/project

# Via API
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/path/to/project", "prompt": "Review the PR and summarize the changes"}'
```

## Core Concepts

### Sessions

A **session** is one Claude Code process managed by Aegis via the ACP runtime. Each session has:
- A unique ID (UUID)
- A display name (e.g., `cc-my-task`)
- A working directory
- A JSONL transcript file

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
5. **rate_limit** — Claude Code hit a rate limit and is showing an interactive menu
6. **done** — Session terminated

Poll for status:
```bash
curl http://localhost:9100/v1/sessions/{id}
```

Read the transcript:
```bash
curl http://localhost:9100/v1/sessions/{id}/transcript
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
ag run "do something"       # Zero-to-session: create + stream output
ag init                     # Bootstrap config interactively
ag init --yes               # Non-interactive, auto-wire MCP
ag init --list-templates    # List available templates
ag init --from-template X   # Scaffold from a template
ag list                     # List sessions
ag status [session-id]      # Show session or server status
ag read <session-id>        # Read session output (prefix matching)
ag tail <session-id>        # Stream session output live
ag kill <session-id>        # Kill a session
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

> OIDC/SSO is a Phase 4 feature. Enable with `AEGIS_FEATURE_OIDC=1`.

#### `ag login`

Opens a browser-based auth flow. Prints a verification URL and code — visit the URL, enter the code, and the CLI polls until you authorize.

```bash
ag login                          # Interactive auth
ag login --server http://aegis:9100  # Override server URL
ag login --no-open                 # Don't auto-open browser
ag login --json                    # Machine-readable output
```

**Exit codes:** `0` = success, `1` = auth failed/timeout, `2` = config error.

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
# Auto-wired during ag init --yes (or offered interactively)
# Manual wiring:
claude mcp add aegis -- ag mcp
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
| `GET` | `/v1/sessions/:id/transcript` | Read transcript |
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
- Onboarding wizard (first run)

On localhost with zero-config, the dashboard loads without authentication. If you've set up auth tokens, you'll be prompted to log in.

## Configuration

Config file: `.aegis/config.yaml` (project-local) or `~/.aegis/config.yaml` (global)

```yaml
host: "127.0.0.1"
port: 9100
# authToken: "your-secret-token"  # Only needed for non-localhost
allowedWorkDirs:
  - "~/projects"
  - "~/workspace"
```

> **Security note:** System temp dirs (`/tmp`, `/var/tmp`) are **not** in the default safe directories list. If you need to use a temp directory as a workDir, add it explicitly to `allowedWorkDirs`.

Environment variables override config values. Prefix with `AEGIS_`:
- `AEGIS_HOST`, `AEGIS_PORT`, `AEGIS_AUTH_TOKEN`, `AEGIS_STATE_DIR`

See [Configuration Reference](getting-started.md#configuration) for all options.

## Approve from Your Phone (optional)

Set up Telegram approvals to handle Claude Code permission prompts from anywhere.

Set two environment variables, then restart Aegis:

```bash
export AEGIS_TG_TOKEN="<your-bot-token>"
export AEGIS_TG_GROUP="<your-chat-id>"   # positive for DM, negative for group
```

Or add them to `aegis.config.json`:

```json
{ "tgBotToken": "<token>", "tgGroupId": "<chat-id>" }
```

After restart, permission prompts arrive on Telegram — approve or deny from your phone.

> 📖 Full walkthrough: [Phone Approvals guide](./guides/phone-approvals.md).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `claude: command not found` | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| Session hangs without output | Run `claude auth status` — you must be logged in |
| `workDir is not in the allowed directories list` | Run from your home directory, or add the path to `allowedWorkDirs` |
| `401 Unauthorized` | On localhost with a fresh install, this shouldn't happen. If it does, delete `~/.aegis/` and retry |
| `EADDRINUSE` | Port 9100 in use: `AEGIS_PORT=9200 ag run "..." --cwd ./project` |
| Server won't start | `ag doctor` — checks ACP, port, Claude Code availability |
| Session stuck on `permission_prompt` | `curl -X POST http://localhost:9100/v1/sessions/{id}/permission/approve` |
| Dashboard won't load | Check Aegis is running: `curl http://localhost:9100/v1/health` |

See the [Troubleshooting](troubleshooting.md) guide for more.

## Next Steps

- [5-Minute Setup](five-minute-setup.md) — fastest path from zero
- [Getting Started](getting-started.md) — full configuration reference
- [API Reference](api-reference.md) — every REST endpoint
- [MCP Tools](mcp-tools.md) — all MCP tool definitions
- [Advanced Features](advanced.md) — pipelines, templates, memory bridge
- [Deployment Guide](deployment.md) — production deployment
- [i18n Guide](guides/i18n.md) — dashboard localization
