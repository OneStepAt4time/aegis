# Getting Started with Aegis

Get from zero to orchestrating Claude Code sessions in under 5 minutes.

## Prerequisites

| Requirement | Minimum Version | Check Command |
|---|---|---|
| Node.js | ≥ 20 | `node --version` |
| Claude Code CLI | Latest | `claude --version` |

Aegis bundles `claude-agent-acp` — no tmux installation required.

## 1. Bootstrap and Start Aegis

Install once, bootstrap `.aegis/config.yaml`, then start Aegis with the primary `ag` CLI:

```bash
npm install -g @onestepat4time/aegis
ag init
ag
```

> The primary CLI command is `ag`. The legacy name `aegis` is kept as an alias for backward compatibility — both resolve to the same binary.

Aegis starts on **http://localhost:9100** by default. Verify it's running:

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
  node:20-slim bash -c "npm install -g @anthropic-ai/claude-code @onestepat4time/aegis && ag"
```

> Docker requires Claude Code CLI to be installed and authenticated inside the container.

</details>

<details>
<summary>Start with authentication</summary>

**Option A: API token (simple)**

Set a bearer token to protect all endpoints (except `/v1/health`):

```bash
AEGIS_AUTH_TOKEN=your-secret-token ag
```

Then include the token in every request:

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:9100/v1/sessions
```

**Option B: OIDC / SSO (enterprise)**

For IdP-based authentication, configure OIDC and use the CLI:

```bash
export AEGIS_OIDC_ISSUER=https://your-idp.example.com
export AEGIS_OIDC_CLIENT_ID=your-client-id
ag login  # Opens browser-based device flow
ag whoami # Verify: alice@example.com  admin  (token expires in 59m)
```

See the [OIDC Configuration](#configuration) table below for all environment variables.

For **dashboard SSO**, also set `AEGIS_OIDC_CLIENT_SECRET`. The dashboard will redirect to your IdP for login. See the [Dashboard Guide — OIDC SSO](dashboard.md#oidc-sso-configuration) for full setup.

> **Tip:** If you set up auth, export the token for the curl examples below:
> ```bash
> export TOKEN=your-secret-token
> ```
> All examples from section 5 onward use `$TOKEN` for brevity. No-auth setups can omit the `-H "Authorization: Bearer $TOKEN"` headers.

</details>

## 2. Open the Dashboard

Visit **http://localhost:9100/dashboard/** in your browser. The dashboard shows all sessions, their status, and activity in real time.

> **Note:** `ag init` can create an admin API token and save it in `.aegis/config.yaml`. Use that token to sign in, or keep using `AEGIS_AUTH_TOKEN` if you prefer an environment-based setup. If OIDC SSO is configured, the dashboard uses IdP-based login instead.

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
ag create "Analyze this project. List the main technologies, directory structure, and any issues you spot." --cwd /path/to/your/project
```

`ag create` prints the session ID and next-step curl commands for you:

```text
✅ Session created: cc-analyze-this-projec
   ID: a1b2c3d4

Next steps:
  Status:   curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9100/v1/sessions/a1b2c3d4/health
  Read:     curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9100/v1/sessions/a1b2c3d4/read
  Kill:     curl -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9100/v1/sessions/a1b2c3d4
```

Save the `id` — you'll need it for follow-up commands.

> **Note:** `workDir` must be under an allowed directory. By default, Aegis allows `$HOME`, `/tmp`, and the current working directory. To restrict sessions to specific directories, set `allowedWorkDirs` in `.aegis/config.yaml` (or `aegis.config.json`). Changes are hot-reloaded without restart.

## 5. Monitor Progress

Watch the session in the dashboard, or poll the API:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/sessions/a1b2c3d4
```

> **Tip:** Set `TOKEN` once and reuse it: `TOKEN=your-secret-token` (or `TOKEN=$(cat .aegis/config.yaml | grep authToken | cut -d' ' -f2)`).

For real-time updates, use the SSE event stream (requires an SSE token — see [SSE Auth](#configuration)):

```bash
# Step 1: Get an SSE token
SSE_TOKEN=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/auth/sse-token | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")

# Step 2: Connect to the stream
curl -N "http://localhost:9100/v1/events?token=$SSE_TOKEN"
```

## 6. Send a Follow-Up

```bash
curl -X POST http://localhost:9100/v1/sessions/a1b2c3d4/send \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Now create a detailed plan to fix the issues you found."}'
```

## 7. Read the Results

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/sessions/a1b2c3d4/read
```

This returns the parsed transcript — Claude Code's full response in structured JSON.

## 8. Handle Permission Prompts

When Claude Code asks for approval (e.g., to run a shell command or write a file), the session status changes to `permission_prompt`. Approve or reject:

```bash
# Approve
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/sessions/a1b2c3d4/approve

# Reject
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/sessions/a1b2c3d4/reject
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

## 9. Run Multiple Sessions in Parallel

Aegis is designed for parallel orchestration. Each session runs as an independent ACP child process:

```bash
# Backend fix
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "backend", "workDir": "/path/to/backend", "prompt": "Fix failing API tests"}'

# Frontend improvement
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "frontend", "workDir": "/path/to/frontend", "prompt": "Add loading states to all API calls"}'

# Documentation
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "docs", "workDir": "/path/to/project", "prompt": "Update README with the new API endpoints"}'
```

List all sessions:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:9100/v1/sessions
```

Supports pagination: `?page=1&limit=20&status=active`. Invalid values (e.g. `page=-1`, `limit=999`) return `400`.

## 10. Set Up MCP Integration

Connect Aegis to Claude Code for native tool access:

```bash
claude mcp add aegis -- ag mcp
```

This registers 34 MCP tools (session management, ACP control, transcript reading, pipeline orchestration, etc.). Restart Claude Code to load the tools. MCP tool calls are authenticated automatically via the Aegis MCP server.

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
| `AEGIS_SESSION_STORE` | `file` | Session state backend: `file`, `redis`, or `postgres` |
| `AEGIS_POSTGRES_URL` | _(empty)_ | PostgreSQL connection URL (required when `AEGIS_SESSION_STORE=postgres`) |
| `AEGIS_PG_TABLE` | `aegis_sessions` | PostgreSQL table name for session state |
| `AEGIS_PG_SCHEMA` | `public` | PostgreSQL schema name |
| `AEGIS_PG_POOL_MAX` | `5` | PostgreSQL connection pool max size |
| `AEGIS_REDIS_URL` | `redis://localhost:6379` | Redis URL (used when `AEGIS_SESSION_STORE=redis`) |
| `AEGIS_REDIS_KEY_PREFIX` | `aegis` | Redis key prefix |

See the [Enterprise Deployment Guide](enterprise.md#configuration-reference) for the complete environment variable reference (rate limiting, OIDC, hooks, notifications, alerting, and more).

Or use a config file (`.aegis/config.yaml` is the preferred bootstrap path, and `aegis.config.json` remains supported):

```yaml
baseUrl: http://127.0.0.1:9100
dashboardEnabled: true
clientAuthToken: your-token
memoryBridge:
  enabled: true
```

For the full configuration reference, see [Enterprise Deployment](./enterprise.md#configuration-reference).

## Using the SDKs

Aegis provides official client SDKs for TypeScript and Python, both generated from the OpenAPI 3.1 specification.

### TypeScript SDK

```bash
npm install @onestepat4time/aegis-client
```

```typescript
import { AegisClient } from '@onestepat4time/aegis-client';

const client = new AegisClient('http://localhost:9100', process.env.AEGIS_AUTH_TOKEN);
const sessions = await client.listSessions();
await client.sendMessage(sessions[0].id, 'Continue the task');
```

See [`packages/client/`](../packages/client/) for source and the full README.

### Python SDK

```bash
pip install ag-client
```

```python
from aegis_python_client import AegisClient

client = AegisClient(base_url="http://localhost:9100", auth_token="your-token")
sessions = client.list_sessions()
client.send_message(sessions["sessions"][0]["id"], "Continue the task")
```

See [`packages/python-client/`](../packages/python-client/) for source and the full README.

## Next Steps

- **[MCP Tools Reference](./mcp-tools.md)** — Full documentation for all 34 MCP tools
- **[API Reference](./api-reference.md)** — Complete REST API documentation
- **[Verifying Releases](./verify-release.md)** — SHA verification, npm integrity, Sigstore attestations, version policy
- **[Advanced Features](./advanced.md)** — Pipelines, Memory Bridge, templates
- **[Enterprise Deployment](./enterprise.md)** — Auth, rate limiting, production setup
- **[ACP Migration Guide](./acp-migration-guide.md)** — Upgrading from `aegis-bridge`
- **[TypeDoc API](https://onestepat4time.github.io/aegis/)** — Auto-generated TypeScript reference
- **[ROADMAP](../ROADMAP.md)** — What's coming next

### For Maintainers

- **[Release Process](./release-process.md)** — Production release flow, recovery releases, and hotfixes
- **[Disaster Recovery](./DISASTER_RECOVERY.md)** — Data loss and infrastructure failure recovery procedures
- **[Incident and Rollback Runbook](./incident-rollback-runbook.md)** — Deployment rollbacks and version pinning

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
| `claude: command not found` | Install Claude Code: `npm install -g @anthropic-ai/claude-code` and run `claude` to authenticate |
| `Claude Code CLI not found` | Install Claude Code: `npm install -g @anthropic-ai/claude-code` and run `claude` to authenticate |
| `401 Unauthorized` | Set `AEGIS_AUTH_TOKEN` or include `Authorization: Bearer <token>` header |
| Session stuck on `stalled` | Send an interrupt: `curl -X POST http://localhost:9100/v1/sessions/:id/interrupt` |
| MCP tools not showing in Claude Code | Re-run `claude mcp add aegis -- ag mcp` and restart Claude Code |
| Dashboard won't load | Verify Aegis is running on port 9100: `curl http://localhost:9100/v1/health` |
| `EADDRINUSE` on startup | Port 9100 is in use. Set a different port: `AEGIS_PORT=9200 ag` |
| Screenshot returns 501 | Install Playwright: `npx playwright install chromium` |
| No output from `/read` | Wait for transcript entries, or check session events via SSE: `curl http://localhost:9100/v1/sessions/:id/events` |
