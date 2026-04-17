# Getting Started with Aegis

Get from zero to orchestrating Claude Code sessions in under 5 minutes.

## Prerequisites

| Requirement | Minimum Version | Check Command |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| Claude Code CLI | Latest | `claude --version` |
| tmux | ≥ 3.2 | `tmux -V` |

> **Windows users:** Install [psmux](https://github.com/nicknisi/psmux) instead of tmux. See [Windows Setup](./windows-setup.md) for details.

## 1. Start Aegis

Install once, then start Aegis with the primary `ag` CLI:

```bash
npm install -g @onestepat4time/aegis
ag
```

> The primary CLI command is `ag`. The legacy name `aegis` is kept as an alias for backward compatibility — both resolve to the same binary.

Aegis starts on **http://localhost:9100**. Verify it's running:

```bash
curl http://localhost:9100/v1/health
```

<details>
<summary>Run without a global install (optional)</summary>

```bash
npx --package=@onestepat4time/aegis ag
```

</details>

<details>
<summary>Docker (alternative)</summary>

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -p 9100:9100 \
  node:20-slim bash -c "apt-get update && apt-get install -y tmux > /dev/null 2>&1 && npm install -g @anthropic-ai/claude-code @onestepat4time/aegis && ag"
```

> Docker requires Claude Code CLI to be installed and authenticated inside the container.

</details>

<details>
<summary>Start with authentication</summary>

Set a bearer token to protect all endpoints (except `/v1/health`):

```bash
AEGIS_AUTH_TOKEN=your-secret-token ag
```

Then include the token in every request:

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:9100/v1/sessions
```

</details>

## 2. Open the Dashboard

Visit **http://localhost:9100/dashboard/** in your browser. The dashboard shows all sessions, their status, and activity in real time.

> **Note:** The dashboard requires authentication. Set `AEGIS_AUTH_TOKEN` before starting Aegis, then log in with your token. See [Authentication](#1-start-with-authentication) above.

## 3. Dashboard Keyboard Shortcuts

Navigate the dashboard faster using keyboard shortcuts:

| Shortcut | Action |
|----------|-------|
| `?` | Toggle help modal |
| `Ctrl+K` | Toggle keyboard shortcuts help |
| `G` then `O` | Go to Overview |
| `G` then `S` | Go to Sessions |
| `G` then `P` | Go to Pipelines |
| `G` then `A` | Go to Audit |
| `G` then `U` | Go to Users |
| `Escape` | Close modal |

The dashboard displays the shortcut hint in the sidebar footer.

## 4. Create Your First Session

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "explore-project",
    "workDir": "/path/to/your/project",
    "prompt": "Analyze this project. List the main technologies, directory structure, and any issues you spot.",
    "permissionMode": "default"
  }'
```

The response includes the session ID:

```json
{
  "id": "a1b2c3d4",
  "name": "explore-project",
  "status": "working",
  "workDir": "/path/to/your/project"
}
```

Save the `id` — you'll need it for follow-up commands.

> **Note:** `workDir` must be under an allowed directory. By default, Aegis allows `$HOME`, `/tmp`, and the current working directory. To restrict sessions to specific directories, set `allowedWorkDirs` in `aegis.config.json`. Changes are hot-reloaded without restart.

## 4. Monitor Progress

Watch the session in the dashboard, or poll the API:

```bash
curl http://localhost:9100/v1/sessions/a1b2c3d4
```

For real-time updates, use the SSE event stream:

```bash
curl -N http://localhost:9100/v1/events
```

## 5. Send a Follow-Up

```bash
curl -X POST http://localhost:9100/v1/sessions/a1b2c3d4/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Now create a detailed plan to fix the issues you found."}'
```

## 6. Read the Results

```bash
curl http://localhost:9100/v1/sessions/a1b2c3d4/read
```

This returns the parsed transcript — Claude Code's full response in structured JSON.

## 7. Handle Permission Prompts

When Claude Code asks for approval (e.g., to run a shell command or write a file), the session status changes to `permission_prompt`. Approve or reject:

```bash
# Approve
curl -X POST http://localhost:9100/v1/sessions/a1b2c3d4/approve

# Reject
curl -X POST http://localhost:9100/v1/sessions/a1b2c3d4/reject
```

You can also set `permissionMode` when creating a session to control approval behavior:

| Mode | Behavior |
|---|---|
| `default` | Prompts for dangerous operations (recommended) |
| `bypassPermissions` | Auto-approves every operation without prompting |
| `plan` | Claude runs in plan mode before any edits |
| `acceptEdits` | Auto-accepts non-destructive edits only |
| `dontAsk` | Disables all permission prompts (fails on dangerous ops) |
| `auto` | Claude decides when to prompt (context-dependent) |

## 8. Run Multiple Sessions in Parallel

Aegis is designed for parallel orchestration. Each session runs in its own tmux window:

```bash
# Backend fix
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "backend", "workDir": "/path/to/backend", "prompt": "Fix failing API tests"}'

# Frontend improvement
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "frontend", "workDir": "/path/to/frontend", "prompt": "Add loading states to all API calls"}'

# Documentation
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "docs", "workDir": "/path/to/project", "prompt": "Update README with the new API endpoints"}'
```

List all sessions:

```bash
curl http://localhost:9100/v1/sessions
```

## 9. Set Up MCP Integration

Connect Aegis to Claude Code for native tool access:

```bash
claude mcp add aegis -- ag mcp
```

This registers 24 MCP tools (session management, transcript reading, pipeline orchestration, etc.). Restart Claude Code to load the tools.

For the full MCP tools reference, see [MCP Tools](./mcp-tools.md).

## Configuration

Aegis is configured via environment variables:

| Variable | Default | Description |
|---|---|---|
| `AEGIS_PORT` | `9100` | HTTP server port |
| `AEGIS_HOST` | `127.0.0.1` | Bind address |
| `AEGIS_AUTH_TOKEN` | _(empty)_ | Bearer token (empty = no auth) |
| `AEGIS_STATE_DIR` | `~/.aegis` | State directory |
| `AEGIS_LOG_LEVEL` | `info` | Log verbosity |

Or use a config file (`aegis.config.json`):

```json
{
  "port": 9100,
  "authToken": "your-token",
  "memoryBridge": {
    "enabled": true
  }
}
```

For the full configuration reference, see [Enterprise Deployment](./enterprise.md#configuration-reference).

## Next Steps

- **[MCP Tools Reference](./mcp-tools.md)** — Full documentation for all 24 MCP tools
- **[API Reference](./api-reference.md)** — Complete REST API documentation
- **[Verifying Releases](./verify-release.md)** — SHA verification, npm integrity, Sigstore attestations, version policy
- **[Advanced Features](./advanced.md)** — Pipelines, Memory Bridge, templates
- **[Enterprise Deployment](./enterprise.md)** — Auth, rate limiting, production setup
- **[Migration Guide](./migration-guide.md)** — Upgrading from `aegis-bridge`
- **[TypeDoc API](https://onestepat4time.github.io/aegis/)** — Auto-generated TypeScript reference
- **[ROADMAP](../ROADMAP.md)** — What's coming next

## Contributing to Aegis

See the [Contributing Guide](../CONTRIBUTING.md) for development workflow, branch conventions, and PR process.

For Aegis development, use **git worktrees** — never develop directly in the main repo folder:

```bash
# Create a worktree per feature
git worktree add ~/projects/aegis-my-feature origin/develop

# Inside worktree
git checkout -b feat/my-feature
```

See the [Worktree Guide](./worktree-guide.md) for detailed setup instructions.

## Troubleshooting

| Problem | Solution |
|---|---|
| `tmux: command not found` | Install tmux: `sudo apt install tmux` (Ubuntu) or `brew install tmux` (macOS) |
| `Claude Code CLI not found` | Install Claude Code: `npm install -g @anthropic-ai/claude-code` and run `claude` to authenticate |
| `401 Unauthorized` | Set `AEGIS_AUTH_TOKEN` or include `Authorization: Bearer <token>` header |
| Session stuck on `stalled` | Send an interrupt: `curl -X POST http://localhost:9100/v1/sessions/:id/interrupt` |
| MCP tools not showing in Claude Code | Re-run `claude mcp add aegis -- ag mcp` and restart Claude Code |
| Dashboard won't load | Verify Aegis is running on port 9100: `curl http://localhost:9100/v1/health` |
| `EADDRINUSE` on startup | Port 9100 is in use. Set a different port: `AEGIS_PORT=9200 ag` |
| Screenshot returns 501 | Install Playwright: `npx playwright install chromium` |
| No output from `/read` | Wait for transcript entries, or check raw terminal: `curl /v1/sessions/:id/pane` |
