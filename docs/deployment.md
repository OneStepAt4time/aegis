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
| `AEGIS_HOST` | No | `127.0.0.1` (Docker: `0.0.0.0`) | Bind address — [auto-detects Docker](#docker-auto-detection) |
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
npm install -g @onestepat4time/aegis
ag
```

Or run without installing:

```bash
npx @onestepat4time/aegis
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

Aegis ships with `scripts/install-systemd.sh` — a parameterized installer that generates the systemd unit file and a pre-start script with the correct paths for your deployment.

```bash
# Production defaults: /opt/aegis, user=aegis
sudo ./scripts/install-systemd.sh

# Development machine (custom path and user)
sudo ./scripts/install-systemd.sh /home/user/projects/aegis user

# Preview without writing files
sudo ./scripts/install-systemd.sh /opt/aegis aegis --dry-run
```

**What it generates:**

| File | Location | Purpose |
|------|----------|----------|
| `aegis.service` | `/etc/systemd/system/` | Systemd unit with correct `User`, `WorkingDirectory`, `ExecStartPre` |
| `aegis-pre-start.sh` | `/usr/local/bin/` | Runs `npm run build` + cleans stale PID files, tmux sockets, processes |

**Options:**

| Flag | Description |
|------|-------------|
| `--dry-run` | Print generated files without writing |
| `--skip-build` | Omit `npm run build` from the pre-start script |

After running the installer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis
sudo systemctl start aegis
```

<details>
<summary>Manual setup (advanced)</summary>

If you prefer to create the unit file manually:

```ini
[Unit]
Description=Aegis Server
After=network.target

[Service]
Type=simple
User=aegis
WorkingDirectory=/opt/aegis
ExecStart=/usr/bin/node dist/server.js
Restart=always
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

</details>

### Crash Alerting (systemd)

Aegis includes systemd alerting for bare-metal/VM deployments. When the server
exhausts restart attempts or fails health checks, a webhook notification is sent.

**Setup:**

```bash
# Copy unit files and scripts (or use install-systemd.sh above for automated setup)
sudo cp deploy/systemd/aegis-failure-notify.* /etc/systemd/system/
sudo cp deploy/systemd/aegis-healthcheck.* /etc/systemd/system/
sudo cp deploy/systemd/aegis-failure-notify.sh /usr/local/bin/
sudo cp deploy/systemd/aegis-healthcheck.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/aegis-failure-notify.sh /usr/local/bin/aegis-healthcheck.sh

# Configure webhook URL (required for alerts)
sudo mkdir -p /etc/aegis
echo 'AEGIS_FAILURE_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK' | sudo tee /etc/aegis/aegis.env
sudo chmod 600 /etc/aegis/aegis.env

# Enable
sudo systemctl daemon-reload
sudo systemctl enable --now aegis aegis-healthcheck.timer
```

| Component | Trigger | Purpose |
|-----------|---------|--------|
| `aegis-failure-notify.service` | systemd `OnFailure` | Alert when restart attempts exhausted |
| `aegis-healthcheck.timer` | Every 60s | Ping `/health`, alert on failure |

Set `AEGIS_FAILURE_WEBHOOK` in `/etc/aegis/aegis.env` to a Discord, Slack, or
generic webhook URL. If unset, notifications are silently skipped.

### Docker Auto-Detection

When running inside a Docker container, Aegis automatically detects the
environment and binds to `0.0.0.0` instead of `127.0.0.1`. This avoids the
classic issue where Docker port forwarding (`-p 9100:9100`) cannot reach a
process listening on container-localhost.

Detection checks:

1. `/.dockerenv` file exists (standard Docker indicator)
2. `/proc/1/cgroup` contains `docker` or `containerd` strings

Setting `AEGIS_HOST` explicitly **always overrides** auto-detection.

| Environment | Default bind address |
|-------------|---------------------|
| Bare metal / VM | `127.0.0.1` |
| Docker (no `AEGIS_HOST`) | `0.0.0.0` |
| Any + `AEGIS_HOST=x.x.x.x` | `x.x.x.x` |

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

> **Note:** You no longer need to set `-e AEGIS_HOST=0.0.0.0` — Aegis
> auto-detects Docker and binds to all interfaces automatically.

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

The chart source lives in `deploy/helm/aegis`. Install or upgrade Aegis with:

```bash
# Build the chart from source (published Helm repo coming soon)
helm upgrade --install aegis ./deploy/helm/aegis \
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
  "version": "0.6.0-preview",
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

## OpenTelemetry Tracing

Aegis supports distributed tracing via OpenTelemetry, shipping spans to any
OTLP-compatible backend (Jaeger, Grafana Tempo, SigNoz, Honeycomb, etc.).

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_OTEL_ENABLED` | `false` | Enable tracing |
| `AEGIS_OTEL_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP exporter endpoint |
| `AEGIS_OTEL_SERVICE_NAME` | `aegis` | Service name in trace data |
| `AEGIS_OTEL_SAMPLE_RATE` | `1.0` | Sample rate (0.0–1.0) |

### Quick start with Jaeger

```bash
# Start Jaeger all-in-one (OTLP HTTP receiver on port 4318)
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/jaeger:latest

# Start Aegis with tracing enabled
AEGIS_OTEL_ENABLED=true AEGIS_OTEL_OTLP_ENDPOINT=http://localhost:4318 ag
```

Open `http://localhost:16686` to browse traces.

### Quick start with Grafana Tempo

```yaml
# docker-compose.yaml
services:
  tempo:
    image: grafana/tempo:latest
    ports:
      - "4318:4318"   # OTLP HTTP
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./tempo.yaml:/etc/tempo.yaml
```

Minimal `tempo.yaml`:

```yaml
server:
  http_listen_port: 4318

distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: "0.0.0.0:4318"

storage:
  trace:
    backend: local
    wal:
      path: /var/tempo/wal
    local:
      path: /var/tempo/traces
```

### What is traced

| Span name | Kind | Description |
|-----------|------|-------------|
| `GET /v1/...` | SERVER | Auto-instrumented Fastify HTTP routes |
| `session.create` | INTERNAL | Session creation lifecycle |
| `session.kill` | INTERNAL | Session termination |
| `acp.child_process.spawn` | INTERNAL | ACP child process lifecycle |
| `acp.json_rpc.request` | INTERNAL | JSON-RPC communication with ACP child |
| `channel.<name>.<event>` | INTERNAL | Notification channel delivery |

### Log–trace correlation

When tracing is enabled, structured log records include `traceId` and `spanId`
fields from the active span context. This lets you correlate Aegis logs with
traces in your observability backend.

## Troubleshooting

See [Troubleshooting Guide](./troubleshooting.md) for common deployment issues.

## Tenant Workdir Namespacing

When multi-tenancy is enabled, you can restrict each tenant's sessions to a
specific directory root. This prevents cross-tenant path access.

### Configuration

Add a `tenantWorkdirs` map to your config file (YAML or JSON):

**YAML** (`.aegis/config.yaml`):

```yaml
tenantWorkdirs:
  tenant-a:
    root: /tenants/tenant-a
    allowedPaths:
      - projects
      - workspace
  tenant-b:
    root: /tenants/tenant-b
```

**JSON** (`aegis.config.json`):

```json
{
  "tenantWorkdirs": {
    "tenant-a": {
      "root": "/tenants/tenant-a",
      "allowedPaths": ["projects", "workspace"]
    },
    "tenant-b": {
      "root": "/tenants/tenant-b"
    }
  }
}
```

### How it works

- **`root`** (required): The directory root for the tenant. All session `workDir`
  values must be at or under this path.
- **`allowedPaths`** (optional): Further restrict to specific subdirectories
  within the root. Paths are relative to `root`.

### Behavior

| Scenario | Result |
|----------|--------|
| Master token (no tenant) | Bypasses all workdir restrictions |
| Tenant with no config | Unrestricted (backward compatible) |
| Path under tenant root | Allowed |
| Path outside tenant root | Rejected with 403 + audit log |
| Path in unallowed subdirectory | Rejected with 403 + audit log |

Cross-tenant violations are logged to the audit trail with action
`session.action.denied` and the tenant ID.

