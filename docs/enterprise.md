# Enterprise Deployment Guide

This guide covers deploying Aegis in production and enterprise environments.

---

## Authentication

### Bearer Token (Single Key)

Set `AEGIS_AUTH_TOKEN` to enable authentication on all endpoints except `/v1/health`:

```bash
AEGIS_AUTH_TOKEN=your-secret-token npx @onestepat4time/aegis
```

Clients must include the header in every request:

```bash
curl -H "Authorization: Bearer your-secret-token" http://localhost:9100/v1/sessions
```

### Multi-Key API Keys

Aegis supports multiple API keys with different scopes:

```bash
# Create a read-only key
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "monitoring-bot", "scopes": ["sessions:read"]}'

# Create a full-access key
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-bot", "scopes": ["sessions:read", "sessions:write"]}'
```

### SSE Tokens

For SSE event streams, generate short-lived tokens:

```bash
curl -X POST http://localhost:9100/v1/auth/sse-token
```

Use via query parameter: `curl -N "http://localhost:9100/v1/events?token=<sse-token>"`

---
## Session Ownership (RBAC)

Aegis enforces session ownership — an API key can only operate on sessions it created.

### How It Works

Every session tracks its `ownerKeyId` — the API key that created it. Protected operations verify the caller's key matches the session's owner before acting.

| Operation | Check |
|-----------|-------|
| `POST /v1/sessions/:id/send` | Key must own session |
| `POST /v1/sessions/:id/approve` | Key must own session |
| `POST /v1/sessions/:id/reject` | Key must own session |
| `DELETE /v1/sessions/:id` | Key must own session |
| `POST /v1/sessions/:id/interrupt` | Key must own session |
| `POST /v1/sessions/:id/escape` | Key must own session |
| `GET /v1/sessions/:id/pane` | Key must own session |
| `GET /v1/sessions/:id/read` | Key must own session |
| `GET /v1/sessions/:id/summary` | Key must own session |
| `POST /v1/sessions/:id/command` | Key must own session |
| `POST /v1/sessions/:id/bash` | Key must own session |
| `POST /v1/sessions/batch` | Each session stamped with caller's key |
| `DELETE /v1/sessions` | Key can only delete its own sessions |

If a key attempts an operation on another key's session, the server returns `403 Forbidden`:

```json
{ "error": "Forbidden: session belongs to another owner" }
```

### Ownership Bypass

Two special cases bypass ownership checks:

- **Master key** (`keyId === 'master'`) — full access to all sessions
- **No-auth mode** (`keyId === null`) — legacy sessions remain accessible without ownership checks

### Legacy Sessions

Sessions created before this feature was introduced may not have an `ownerKeyId`. These sessions remain accessible to all keys for backward compatibility.

### Scope Requirements

Session ownership works alongside API key scopes. Even with `sessions:write` scope, a key can only send/approve/kill sessions it owns. Scope grants permission; ownership grants access.

### Verifying Ownership

Query the session's `ownerKeyId` via `GET /v1/sessions/:id`:

```json
{
  "id": "a1b2c3d4-...",
  "name": "my-session",
  "workDir": "/home/user/project",
  "ownerKeyId": "key-monitor-bot",
  "status": "working"
}
```



## Rate Limiting

Aegis includes built-in rate limiting at multiple levels:

| Layer | Limit | Description |
|---|---|---|
| Per-IP | Configurable | Limits requests per IP address |
| Auth failure | 5/min per IP | Locks out after repeated failed auth attempts |
| Per-key | Configurable | Separate limits per API key |
| SSE | Configurable | Rate limiting per SSE client connection |

Auth failure lockout triggers after 5 failed attempts per IP within 1 minute. Stale buckets are pruned automatically.

---

## Security

### Content Security Policy

The dashboard uses a restrictive CSP:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self' ws: wss: https://registry.npmjs.org
```

### Auth Middleware

All endpoints (except `/v1/health`) pass through the auth middleware. Requests are classified by token type (master vs. API key) and checked against route-level requirements.

### Permission Modes

Aegis intercepts Claude Code permission requests and routes them through the API:

- **Default mode:** Permission requests stall the session until approved/rejected via API
- **Auto-approve:** Specific operations (file reads) are auto-approved
- **Custom profiles:** Define permission profiles per session

See [API Reference — Permission Endpoints](./api-reference.md#permission-endpoints) for management APIs.

### Token Redaction

Auth tokens are automatically redacted from request logs to prevent credential leakage.

---

## Production Deployment

### Systemd Service

```ini
[Unit]
Description=Aegis Claude Code Orchestrator
After=network.target

[Service]
Type=simple
User=aegis
Group=aegis
WorkingDirectory=/opt/aegis
Environment=AEGIS_AUTH_TOKEN=your-production-token
Environment=AEGIS_PORT=9100
Environment=AEGIS_HOST=127.0.0.1
ExecStart=/usr/bin/npx @onestepat4time/aegis
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable aegis
sudo systemctl start aegis
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 443 ssl;
    server_name aegis.example.com;

    ssl_certificate /etc/letsencrypt/live/aegis.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aegis.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;  # Required for SSE
    }
}
```

### Docker

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y tmux && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code
ENV AEGIS_PORT=9100
EXPOSE 9100
CMD ["npx", "@onestepat4time/aegis"]
```

---

## Configuration Reference

All configuration is done via environment variables (prefixed `AEGIS_`). Legacy `MANUS_*` vars are still supported for backward compatibility.

| Variable | Default | Description |
|---|---|---|
| `AEGIS_PORT` | `9100` | HTTP server port |
| `AEGIS_HOST` | `127.0.0.1` | HTTP server bind address |
| `AEGIS_AUTH_TOKEN` | _(empty)_ | Master bearer token (empty = no auth) |
| `AEGIS_STATE_DIR` | `~/.aegis` | State directory (sessions, PID file) |
| `AEGIS_TMUX_SESSION` | `aegis` | Base tmux session name |
| `AEGIS_CONFIG` | _(auto)_ | Path to `aegis.config.json` |
| `AEGIS_LOG_LEVEL` | `info` | Log verbosity: `trace`, `debug`, `info`, `warn`, `error` |
| `AEGIS_MAX_SESSIONS` | _(unlimited)_ | Maximum concurrent sessions |
| `AEGIS_IDLE_TIMEOUT_MS` | `600000` | Session idle timeout (10 min default) |
| `AEGIS_STALL_THRESHOLD_MS` | `120000` | Stall detection threshold (2 min default) |

#### Notification Channels

| Variable | Default | Description |
|---|---|---|
| `AEGIS_WEBHOOKS` | _(none)_ | JSON array of webhook endpoints |
| `AEGIS_SLACK_WEBHOOK_URL` | _(none)_ | Slack Incoming Webhook URL |
| `AEGIS_SLACK_EVENTS` | _(all)_ | JSON array of events to forward to Slack |
| `AEGIS_EMAIL_HOST` | _(none)_ | SMTP server hostname |
| `AEGIS_EMAIL_PORT` | `587` | SMTP port |
| `AEGIS_EMAIL_USER` | _(none)_ | SMTP username |
| `AEGIS_EMAIL_PASS` | _(none)_ | SMTP password or app key |
| `AEGIS_EMAIL_TO` | _(none)_ | Destination email address |
| `AEGIS_EMAIL_FROM` | `aegis@localhost` | Sender email address |
| `AEGIS_EMAIL_SECURE` | `false` | Use TLS/SSL (auto-true for port 465) |
| `AEGIS_TG_BOT_TOKEN` | _(none)_ | Telegram bot token |
| `AEGIS_TG_GROUP_ID` | _(none)_ | Telegram group chat ID |

### Configuration File

Create `aegis.config.json` in the working directory or set `AEGIS_CONFIG`:

```json
{
  "port": 9100,
  "authToken": "your-token",
  "memoryBridge": {
    "enabled": true,
    "persistPath": "./memory.json",
    "reaperIntervalMs": 3600000
  },
  "modelRouter": {
    "enabled": true,
    "tiers": {
      "fast": "claude-3-5-haiku-20241022",
      "standard": "claude-sonnet-4-20250514",
      "power": "claude-opus-4-20250115"
    }
  }
}
```

---

## Monitoring

### Health Endpoint

```bash
curl http://localhost:9100/v1/health
```

Returns server status, version, uptime, active session count, and tmux health. Use this for load balancer health checks.

### Metrics

```bash
curl http://localhost:9100/v1/metrics
```

Returns token usage and cost estimation across all sessions. Track `inputTokens`, `outputTokens`, and estimated cost.

### Diagnostics

```bash
curl http://localhost:9100/v1/diagnostics
```

Returns system-level diagnostics: tmux health, resource usage, configuration state, and active connection counts.

### SSE Events

Subscribe to real-time session events:

```bash
curl -N http://localhost:9100/v1/events
```

Integrate with monitoring systems (Datadog, Prometheus via exporters, etc.) by parsing SSE events.

### Session Health

```bash
curl http://localhost:9100/v1/sessions/health
```

Returns aggregate health of all active sessions including stalled and idle detection.

---

## Multi-Tenant Considerations

- **API keys:** Use separate API keys per team/service for access control
- **Working directories:** Each tenant should use isolated working directories
- **State directory:** Use separate `AEGIS_STATE_DIR` per tenant if running multiple instances
- **Resource limits:** Set `AEGIS_MAX_SESSIONS` to prevent resource exhaustion
- **Network isolation:** Bind to `127.0.0.1` and use a reverse proxy for external access

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `EADDRINUSE` on startup | Port 9100 is in use. Set `AEGIS_PORT=9200` or kill the existing process |
| 401 on all endpoints | Check `AEGIS_AUTH_TOKEN` matches the `Authorization` header |
| Sessions stuck on `stalled` | Send interrupt: `POST /v1/sessions/:id/interrupt` |
| High memory usage | Reduce `AEGIS_MAX_SESSIONS` or increase `AEGIS_IDLE_TIMEOUT_MS` |
| tmux errors | Verify tmux is installed: `tmux -V` (requires ≥ 3.2) |
| Rate limited (429) | Wait for the rate limit window to reset or increase limits |
