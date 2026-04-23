# External Deployment Guide

> Step-by-step guide for external teams to deploy Aegis and run their first
> Claude Code session. Target audience: teams of 1-10 developers who want to
> orchestrate Claude Code via REST, MCP, or the web dashboard.

---

## Overview

Aegis is a self-hosted control plane for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It wraps Claude Code in tmux sessions and exposes a unified REST API, MCP server, SSE event stream, and web dashboard. No browser automation, no SDK dependency.

**What you need before starting:**

- A Linux or macOS server (or laptop) with internet access
- A Claude Code subscription and authenticated CLI
- About 10 minutes

---

## 1. Prerequisites

### 1.1 System requirements

| Requirement | Minimum | Check |
|-------------|---------|-------|
| **Operating system** | Linux, macOS (Windows via WSL2) | `uname -a` |
| **Node.js** | >= 20.0.0 LTS | `node --version` |
| **npm** | >= 10 | `npm --version` |
| **tmux** | >= 3.2 | `tmux -V` |
| **Claude Code CLI** | Latest | `claude --version` |
| **Disk** | 500 MB free (for Node + Aegis) | `df -h .` |
| **RAM** | 2 GB minimum (4 GB recommended for 5+ concurrent sessions) | `free -h` |

### 1.2 Install missing dependencies

```bash
# Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# tmux (if not installed)
sudo apt install tmux          # Ubuntu/Debian
brew install tmux               # macOS

# Claude Code CLI (if not installed)
npm install -g @anthropic-ai/claude-code
claude auth login               # Authenticate with your Anthropic account
```

### 1.3 Windows setup

On Windows, use WSL2 with tmux, or psmux as the tmux-compatible backend:

```powershell
choco install psmux -y
npm install -g @onestepat4time/aegis
ag
```

See [Windows Setup](docs/windows-setup.md) for the full walkthrough.

### 1.4 BYO LLM (non-Anthropic providers)

Aegis works with any OpenAI-compatible provider that Claude Code supports. Set
these environment variables before starting sessions:

```bash
export ANTHROPIC_BASE_URL="https://openrouter.ai/api/v1"    # or your provider
export ANTHROPIC_AUTH_TOKEN="your-provider-key"
export ANTHROPIC_DEFAULT_MODEL="model-name"
export ANTHROPIC_DEFAULT_FAST_MODEL="fast-model-name"
```

See [BYO LLM](docs/byo-llm.md) for the full provider list and configuration details.

---

## 2. Installation

### 2.1 Global install (recommended)

```bash
npm install -g @onestepat4time/aegis
```

### 2.2 Verify installation

```bash
ag --version
ag --help
```

The primary command is `ag`. The legacy name `aegis` remains as a compatible alias.

### 2.3 Alternative: run without global install

```bash
npx --package=@onestepat4time/aegis ag
```

### 2.4 Alternative: Docker

```bash
docker pull ghcr.io/onestepat4time/aegis:latest

docker run -d \
  --name aegis \
  -p 9100:9100 \
  -e AEGIS_AUTH_TOKEN=your-secret-token \
  -v aegis-data:/root/.aegis \
  -v claude-data:/root/.claude \
  ghcr.io/onestepat4time/aegis:latest
```

### 2.5 Alternative: Docker Compose

```yaml
version: '3.8'
services:
  aegis:
    image: ghcr.io/onestepat4time/aegis:latest
    ports:
      - "9100:9100"
    environment:
      AEGIS_AUTH_TOKEN: ${AEGIS_AUTH_TOKEN}
      AEGIS_PORT: 9100
    volumes:
      - aegis-data:/root/.aegis
      - claude-data:/root/.claude
    restart: unless-stopped

volumes:
  aegis-data:
  claude-data:
```

### 2.6 Alternative: Kubernetes (Helm)

```bash
helm repo add aegis https://onestepat4time.github.io/aegis/helm
helm repo update

helm upgrade --install aegis aegis/aegis \
  --namespace aegis \
  --create-namespace \
  --set aegis.authToken=your-secret-token
```

---

## 3. Configuration

### 3.1 Interactive setup

```bash
ag init
```

This creates `.aegis/config.yaml` with sensible defaults and optionally generates an admin API token.

### 3.2 Required configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AEGIS_AUTH_TOKEN` | **Yes** (for any shared/team deploy) | _(none)_ | Bearer token for API authentication |
| `AEGIS_PORT` | No | `9100` | HTTP server port |
| `AEGIS_HOST` | No | `127.0.0.1` | Bind address. Use `0.0.0.0` only behind a reverse proxy |

### 3.3 Recommended configuration for teams

```bash
# Set in your environment or systemd unit
export AEGIS_AUTH_TOKEN="$(openssl rand -hex 32)"    # Generate a strong token
export AEGIS_HOST="127.0.0.1"                         # Bind to localhost; use a reverse proxy for remote access
export AEGIS_PORT="9100"
export AEGIS_STATE_DIR="$HOME/.aegis"                 # State, audit logs, session data
export AEGIS_LOG_LEVEL="info"                          # Use "debug" for troubleshooting
```

### 3.4 Config file (optional, overrides env vars)

Priority: CLI `--config` > `./.aegis/config.yaml` > `./aegis.config.json` > `~/.aegis/config.yaml` > defaults

```yaml
# .aegis/config.yaml
baseUrl: http://127.0.0.1:9100
dashboardEnabled: true
clientAuthToken: your-token
memoryBridge:
  enabled: true
```

### 3.5 Restrict session working directories

By default, sessions can use `$HOME`, `/tmp`, and the current working directory. Lock this down for team deployments:

```yaml
# .aegis/config.yaml
allowedWorkDirs:
  - /home/team/projects
  - /opt/repos
```

Changes to `allowedWorkDirs` are hot-reloaded without restarting the server.

### 3.6 RBAC setup

Aegis supports three API-key roles:

| Role | Capabilities |
|------|-------------|
| `admin` | Full access: manage keys, templates, pipelines, all sessions |
| `operator` | Create and manage own sessions, send messages, read transcripts |
| `viewer` | Read-only: list sessions, view transcripts, read metrics |

Create keys for your team:

```bash
# Admin key (for the team lead)
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "team-lead", "role": "admin"}'

# Operator keys (for developers)
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "dev-alice", "role": "operator"}'

# Viewer key (for CI/dashboard monitoring)
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-monitor", "role": "viewer"}'
```

Session ownership is enforced: operator keys can only send, kill, or interrupt their own sessions.

---

## 4. First Run

### 4.1 Start the server

```bash
ag
```

You should see:

```
Aegis listening on http://127.0.0.1:9100
```

### 4.2 Verify health

```bash
curl http://localhost:9100/v1/health
```

Expected response:

```json
{
  "status": "ok",
  "version": "X.Y.Z-preview",
  "uptime": 0
}
```

### 4.3 Run diagnostics

```bash
ag doctor
```

This checks: config loading, Node.js version, tmux, Claude CLI installation, Claude CLI authentication, state directory write access, port availability, and audit-chain integrity.

All checks should pass before proceeding.

### 4.4 Open the dashboard

Visit **http://localhost:9100/dashboard/** in your browser.

The dashboard provides real-time session monitoring, activity streams, and health overview with dark/light theme and keyboard shortcuts.

### 4.5 Create your first session

```bash
ag create "Analyze this project and list the main technologies and directory structure." \
  --cwd /path/to/your/project
```

Or via the REST API:

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/path/to/your/project",
    "prompt": "Analyze this project and list the main technologies and directory structure."
  }'
```

Save the session `id` from the response.

### 4.6 Monitor the session

```bash
# Check status
curl http://localhost:9100/v1/sessions/<id> \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Read the transcript
curl http://localhost:9100/v1/sessions/<id>/read \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Stream events in real time
curl -N http://localhost:9100/v1/sessions/<id>/events \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

### 4.7 Handle permission prompts

When Claude Code asks for approval, the session enters `permission_prompt` state:

```bash
# Approve
curl -X POST http://localhost:9100/v1/sessions/<id>/approve \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Reject
curl -X POST http://localhost:9100/v1/sessions/<id>/reject \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

### 4.8 Set up MCP integration (optional)

Connect Aegis to Claude Code as an MCP tool server:

```bash
claude mcp add aegis -- ag mcp
```

This registers 24 MCP tools. Restart Claude Code to load them. See [MCP Tools](docs/mcp-tools.md) for the full reference.

---

## 5. Remote Access

For team deployments where members connect from outside the server's local network, use one of these options:

### 5.1 Tailscale (recommended for small teams)

```bash
# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Aegis stays bound to localhost
AEGIS_HOST=127.0.0.1 ag
```

Team members access `http://<tailscale-ip>:9100/dashboard/` from their own Tailscale-connected devices.

### 5.2 Cloudflare Tunnel (recommended for stable URLs)

```bash
cloudflared tunnel create aegis
cloudflared tunnel route dns aegis aegis.your-domain.com
cloudflared tunnel run aegis
```

### 5.3 Reverse proxy (Nginx + TLS)

```nginx
server {
    listen 443 ssl;
    server_name aegis.example.com;

    ssl_certificate /etc/ssl/aegis.crt;
    ssl_certificate_key /etc/ssl/aegis.key;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

See [Remote Access](docs/remote-access.md) for the full guide covering all three options with security considerations.

---

## 6. Production Deployment

### 6.1 Systemd service

Create `/etc/systemd/system/aegis.service`:

```ini
[Unit]
Description=Aegis Server
After=network.target

[Service]
Type=simple
User=aegis
WorkingDirectory=/opt/aegis
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5
Environment=AEGIS_AUTH_TOKEN=your-secure-token
Environment=AEGIS_PORT=9100
Environment=AEGIS_HOST=127.0.0.1

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis
sudo systemctl start aegis
```

### 6.2 Updating

```bash
# npm global
npm update -g @onestepat4time/aegis

# Docker
docker pull ghcr.io/onestepat4time/aegis:latest
docker restart aegis

# Systemd (from source)
cd /opt/aegis && git pull origin main && npm install && npm run build
sudo systemctl restart aegis
```

### 6.3 Health monitoring

```bash
# Basic health
curl http://localhost:9100/v1/health

# Server diagnostics
curl http://localhost:9100/v1/diagnostics \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"

# Prometheus metrics (if exposed)
curl http://localhost:9100/metrics
```

---

## 7. Notification Channels

Set up push notifications so your team can approve and monitor sessions from anywhere.

### Telegram

```bash
export AEGIS_TG_TOKEN="your-bot-token"
export AEGIS_TG_GROUP="-100xxxxxxxxx"
```

### Slack

```bash
export AEGIS_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

### Email

```bash
export AEGIS_EMAIL_SMTP_HOST="smtp.example.com"
export AEGIS_EMAIL_SMTP_PORT="587"
export AEGIS_EMAIL_FROM="aegis@example.com"
export AEGIS_EMAIL_TO="team@example.com"
```

### Webhooks

```bash
export AEGIS_WEBHOOKS="https://your-app.com/api/aegis-events"
```

See [Notifications](docs/integrations/notifications.md) for the full configuration reference.

---

## 8. Troubleshooting

### Quick diagnostics

Always start here:

```bash
ag doctor
```

### Common issues

| Problem | Solution |
|---------|----------|
| `tmux: command not found` | `sudo apt install tmux` (Ubuntu) or `brew install tmux` (macOS) |
| `Claude Code CLI not found` | `npm install -g @anthropic-ai/claude-code` then `claude auth login` |
| `401 Unauthorized` | Verify `AEGIS_AUTH_TOKEN` matches between server and client |
| Session stuck at `stalled` | `curl -X POST http://localhost:9100/v1/sessions/<id>/interrupt` |
| `EADDRINUSE` on startup | Port 9100 is in use: `AEGIS_PORT=9200 ag` or `kill $(lsof -t -i :9100)` |
| MCP tools not appearing | Re-run `claude mcp add aegis -- ag mcp` and restart Claude Code |
| Dashboard won't load | Check `curl http://localhost:9100/v1/health`; verify `AEGIS_DASHBOARD_ENABLED=true` |
| No transcript output | Wait for JSONL entries or check raw terminal: `curl /v1/sessions/<id>/pane` |
| Config changes not taking effect | `allowedWorkDirs` is hot-reloaded; other changes require restart |
| High memory with many sessions | Set `AEGIS_MAX_SESSIONS=10` or increase available RAM |

### Enable debug logging

```bash
AEGIS_LOG_LEVEL=debug ag
```

Structured JSON logs include `errorCode` fields for rapid diagnosis.

### Getting help

1. Check the logs for `errorCode` fields
2. Run `ag doctor --json` and include the output
3. Open an issue at [github.com/OneStepAt4time/aegis/issues](https://github.com/OneStepAt4time/aegis/issues)

---

## 9. Verification Checklist

After completing the deployment, confirm everything works:

- [ ] `ag doctor` passes all checks
- [ ] `curl http://localhost:9100/v1/health` returns `{"status":"ok"}`
- [ ] Dashboard loads at `http://localhost:9100/dashboard/`
- [ ] Session creation succeeds via API or CLI
- [ ] Session transcript is readable
- [ ] Permission prompts are received and can be approved/rejected
- [ ] RBAC keys work: operator can create sessions, viewer is read-only
- [ ] Audit log records actions: `curl /v1/audit`
- [ ] Remote access works (if configured)
- [ ] Notifications deliver (if configured)

---

## Further Reading

- [Getting Started](docs/getting-started.md) — Zero to first session in 5 minutes
- [API Reference](docs/api-reference.md) — Complete REST API documentation
- [MCP Tools](docs/mcp-tools.md) — 24 MCP tools and 3 prompts
- [Deployment Guide](docs/deployment.md) — Production deployment patterns
- [Enterprise Onboarding](docs/enterprise-onboarding.md) — RBAC, audit logs, webhooks
- [BYO LLM](docs/byo-llm.md) — OpenAI-compatible provider setup
- [Remote Access](docs/remote-access.md) — Tailscale, Cloudflare Tunnel, ngrok
- [Troubleshooting](docs/troubleshooting.md) — Detailed issue resolution
- [ROADMAP](ROADMAP.md) — What's coming next
