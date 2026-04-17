# Deployment Guide

This guide covers deploying Aegis in development, CI/CD, and production environments.

## Prerequisites

- Node.js 20+ (LTS recommended)
- npm 10+
- Linux/macOS (Windows via WSL2)
- Tailscale, Cloudflare Tunnel, or ngrok (optional, for remote access)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AEGIS_AUTH_TOKEN` | Yes | - | Bearer token for API authentication |
| `AEGIS_PORT` | No | `9100` | HTTP server port |
| `AEGIS_HOST` | No | `0.0.0.0` | Bind address |
| `AEGIS_STATE_DIR` | No | `~/.aegis` | Session state, audit logs, and runtime metadata storage |
| `AEGIS_DASHBOARD_URL` | No | `http://localhost:9100/dashboard` | Dashboard URL |
| `CLAUDE_DATA_DIR` | No | `~/.claude` | Claude Code data directory |
| `AEGIS_SSE_IDLE_MS` | No | `120000` | SSE heartbeat interval — emit a `:ping` comment after this many ms of write-idle silence (Issue #1911) |
| `AEGIS_SSE_CLIENT_TIMEOUT_MS` | No | `300000` | SSE client idle timeout — destroy the connection if no event is sent for this many ms (Issue #1911) |
| `AEGIS_HOOK_TIMEOUT_MS` | No | `10000` | Outgoing webhook / hook fetch timeout in ms; timed-out deliveries are pushed to the dead-letter queue (Issue #1911) |
| `AEGIS_SHUTDOWN_GRACE_MS` | No | `15000` | Grace period in ms for `app.close()` to drain in-flight HTTP requests on SIGTERM/SIGINT (Issue #1911) |
| `AEGIS_SHUTDOWN_HARD_MS` | No | `20000` | Hard cap in ms for the entire graceful shutdown sequence; `process.exit(1)` is called if exceeded (Issue #1911) |

## Quick Start

```bash
npm install
npm run build
node dist/server.js
```

Visit `http://localhost:9100/dashboard/` to access the dashboard.

## Dashboard Security Defaults

Aegis serves `/dashboard` static assets and SPA fallback routes with a strict
Content Security Policy:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: wss: https://registry.npmjs.org; frame-ancestors 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

Notes:

- `style-src 'unsafe-inline'` remains enabled because the current Tailwind/xterm
  runtime injects inline styles.
- Reverse proxies should preserve this header (or an equally strict override)
  and must continue to allow same-origin HTTP, WebSocket, and SSE traffic. If
  you keep dashboard update checks enabled, also allow
  `https://registry.npmjs.org`.
- The dashboard API token is stored in memory only. Reloading the page or
  closing the tab clears the login session. Upgraded clients also remove any
  legacy `aegis_token` entry from `localStorage` during startup. See
  [ADR-0024](./adr/0024-dashboard-token-in-memory.md).

For access away from localhost, keep `AEGIS_HOST=127.0.0.1` on the host and
tunnel or proxy to loopback instead of publishing port `9100` directly. See
[Remote Access](./remote-access.md) for Tailscale, Cloudflare Tunnel, and
ngrok setups plus security guidance.

## Production Deployment

### Systemd Service

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

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis
sudo systemctl start aegis
```

### Docker

```bash
docker pull ghcr.io/onestepat4time/aegis:latest

docker run -d \
  --name aegis \
  -p 9100:9100 \
  -e AEGIS_AUTH_TOKEN=your-secure-token \
  -v aegis-data:/root/.aegis \
  -v claude-data:/root/.claude \
  ghcr.io/onestepat4time/aegis:latest
```

### Docker Compose

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

### Helm (Kubernetes / k3s)

The chart source lives in `deploy/helm/aegis`, and release tags publish a Helm repo at:

```text
https://onestepat4time.github.io/aegis/helm
```

Install or upgrade Aegis with:

```bash
helm repo add aegis https://onestepat4time.github.io/aegis/helm
helm repo update

helm upgrade --install aegis aegis/aegis \
  --namespace aegis \
  --create-namespace
```

Key chart behaviours:

- Runs as a **single-replica StatefulSet** (Aegis is not horizontally scalable yet).
- Persists `AEGIS_STATE_DIR` on a **PVC** mounted at `/var/lib/aegis` by default.
- Wires **liveness** and **readiness** probes to `GET /v1/health`.
- Supports existing Secrets, PVCs, ingress, and raw `extraEnv` / `extraVolumes` / `extraVolumeMounts` overrides for cluster-specific needs such as Claude auth material.

Override `image.repository` or `image.tag` only when you need to pin a mirrored or custom image.

Inspect every supported value with:

```bash
helm show values aegis/aegis
```

## Reverse Proxy

### Nginx

```nginx
server {
    listen 443 ssl;
    server_name aegis.example.com;

    ssl_certificate /etc/ssl/aegis.crt;
    ssl_certificate_key /etc/ssl/aegis.key;

    location / {
        proxy_pass http://localhost:9100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Health Checks

```bash
curl http://localhost:9100/v1/health
```

Response:
```json
{
  "status": "ok",
  "version": "0.5.3-alpha",
  "uptime": 3600
}
```

## Updating

```bash
# Docker
docker pull ghcr.io/onestepat4time/aegis:latest
docker restart aegis

# Systemd
cd /opt/aegis
git pull origin main
npm install
npm run build
sudo systemctl restart aegis
```

## Monitoring

- Health endpoint: `GET /v1/health`
- Metrics: `GET /v1/sessions/:id/metrics`
- Audit log: `GET /v1/audit`

## Troubleshooting

See [Troubleshooting Guide](./troubleshooting.md) for common deployment issues.
