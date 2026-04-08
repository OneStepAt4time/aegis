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

No install required — run directly with npx:

```bash
npx @onestepat4time/aegis
```

Aegis starts on **http://localhost:9100**. Verify it's running:

```bash
curl http://localhost:9100/v1/health
```

Expected response:

```json
{"status": "ok", "version": "0.3.0-alpha", "uptime": 12, "sessions": {"active": 0, "total": 0}}
```

<details>
<summary>Install globally (optional)</summary>

```bash
npm install -g @onestepat4time/aegis
aegis
```

</details>

<details>
<summary>Start with authentication</summary>

Set a bearer token to protect all endpoints (except `/v1/health`):

```bash
AEGIS_AUTH_TOKEN=your-secret-token npx @onestepat4time/aegis
```

Then include the token in every request:

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:9100/v1/sessions
```

</details>

## 2. Open the Dashboard

Visit **http://localhost:9100/dashboard/** in your browser. The dashboard shows all sessions, their status, and activity in real time.

![Dashboard](docs/assets/aegis-hero.jpg)

No extra setup needed — the dashboard is built into Aegis.

## 3. Create Your First Session

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "explore-project",
    "workDir": "/path/to/your/project",
    "prompt": "Analyze this project. List the main technologies, directory structure, and any issues you spot."
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

## 4. Monitor Progress

Watch the session in the dashboard, or poll the API:

```bash
curl http://localhost:9100/v1/sessions/a1b2c3d4
```

For real-time updates, use the SSE event stream:

```bash
curl -N http://localhost:9100/v1/sessions/a1b2c3d4/events
```

## 5. Send a Follow-Up

```bash
curl -X POST http://localhost:9100/v1/sessions/a1b2c3d4/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Now create a detailed plan to fix the issues you found. Start with the highest priority one."}'
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
| `bypassPermissions` | Auto-approves everything (use with caution) |

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "auto-approve", "workDir": "/path/to/project", "prompt": "Fix lint errors", "permissionMode": "bypassPermissions"}'
```

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

## Next Steps

- **[MCP Integration](README.md#mcp-server)** — Connect any MCP-compatible agent (Claude Code, OpenClaw, custom orchestrators)
- **[Ecosystem Integrations](README.md#ecosystem-integrations)** — Cursor, Windsurf, MCP Registry
- **[REST API Reference](README.md#rest-api)** — Full endpoint documentation
- **[TypeDoc API Docs](https://onestepat4time.github.io/aegis/)** — Auto-generated TypeScript API reference
- **[ROADMAP.md](./ROADMAP.md)** — What's coming next

## Troubleshooting

| Problem | Solution |
|---|---|
| `tmux: command not found` | Install tmux: `sudo apt install tmux` (Ubuntu) or `brew install tmux` (macOS) |
| `Claude Code CLI not found` | Install Claude Code: `npm install -g @anthropic-ai/claude-code` and run `claude` to authenticate |
| `401 Unauthorized` | Set `AEGIS_AUTH_TOKEN` or include `Authorization: Bearer <token>` header |
| Session stuck on `stalled` | Send an interrupt: `curl -X POST http://localhost:9100/v1/sessions/:id/interrupt` |
| MCP tools not showing in Claude Code | Re-run `claude mcp add aegis -- npx @onestepat4time/aegis mcp` and restart Claude Code |
| Dashboard won't load | Verify Aegis is running on port 9100: `curl http://localhost:9100/v1/health` |
| `EADDRINUSE` on startup | Port 9100 is in use. Set a different port: `AEGIS_PORT=9200 npx @onestepat4time/aegis` |
| Screenshot returns 501 | Install Playwright: `npx playwright install chromium` |
| No output from `/read` | Wait for transcript entries, or check raw terminal: `curl /v1/sessions/:id/pane` |
