# Production Deployment Guide

This guide covers deploying Aegis in production environments. For development setup, see [Getting Started](docs/getting-started.md).

---

## Prerequisites

- **Node.js 20+** (LTS recommended)
- **tmux 3.2+** or **psmux** (Windows)
- **Claude Code CLI** installed and configured
- **Docker** (optional, for containerized deployment)
- **nginx** (optional, for reverse proxy + TLS termination)

---

## Docker

### Dockerfile

Aegis runs as a minimal Node.js container. Use multi-stage builds to keep the image small:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-slim

# Install tmux and Claude Code dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r aegis && useradd -r -g aegis aegis

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Copy Claude Code binary if bundled
COPY --chown=aegis:aegis . /app

USER aegis
EXPOSE 9100

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:9100/v1/health || exit 1

ENTRYPOINT ["node", "dist/server.js"]
```

### Build and Run

```bash
# Build
docker build -t aegis:latest .

# Run
docker run -d \
  --name aegis \
  -p 9100:9100 \
  -v ~/.aegis:/home/aegis/.aegis \
  -v /var/run/tmux:/var/run/tmux \
  -e AEGIS_AUTH_TOKEN=your-secret-token \
  -e AEGIS_HOST=0.0.0.0 \
  --restart unless-stopped \
  aegis:latest
```

### Docker Compose (Full Stack)

For a complete production stack with nginx reverse proxy:

```yaml
version: '3.8'

services:
  aegis:
    build: .
    container_name: aegis
    restart: unless-stopped
    ports:
      - "127.0.0.1:9100:9100"
    volumes:
      - aegis-data:/home/aegis/.aegis
      - /var/run/tmux:/var/run/tmux
    environment:
      - AEGIS_AUTH_TOKEN=${AEGIS_AUTH_TOKEN}
      - AEGIS_HOST=127.0.0.1
      - AEGIS_PORT=9100
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9100/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    container_name: aegis-proxy
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      aegis:
        condition: service_healthy

volumes:
  aegis-data:
```

---

## Nginx Reverse Proxy + TLS

### nginx.conf

```nginx
worker_processes auto;
worker_rlimit_nofile 65536;

events {
    worker_connections 4096;
    use epoll;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"     always;
    add_header X-Content-Type-Options "nosniff"        always;
    add_header X-XSS-Protection       "1; mode=block"  always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Logging
    access_log /var/log/nginx/aegis.access.log combined;
    error_log  /var/log/nginx/aegis.error.log warn;

    # Performance
    sendfile           on;
    tcp_nopush         on;
    tcp_nodelay        on;
    keepalive_timeout  65;
    gzip               on;
    gzip_types         text/plain application/json application/javascript;

    # Rate limiting zones
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=login:10m rate=1r/s;

    upstream aegis_backend {
        server 127.0.0.1:9100;
        keepalive 32;
    }

    server {
        listen 80;
        server_name aegis.yourdomain.com;

        # Redirect HTTP to HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name aegis.yourdomain.com;

        # TLS configuration
        ssl_certificate     /etc/nginx/certs/aegis.crt;
        ssl_certificate_key /etc/nginx/certs/aegis.key;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers off;
        ssl_session_cache   shared:SSL:10m;
        ssl_session_timeout 1d;

        # Security
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;

        # Proxy to Aegis
        location / {
            proxy_pass         http://aegis_backend;
            proxy_http_version 1.1;
            proxy_set_header   Host              $host;
            proxy_set_header   X-Real-IP         $remote_addr;
            proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto $scheme;
            proxy_set_header   Connection         "";

            # Timeouts
            proxy_connect_timeout 10s;
            proxy_send_timeout    60s;
            proxy_read_timeout    60s;

            # SSE / WebSocket support
            proxy_buffering        off;
            proxy_cache           off;
        }

        # SSE endpoint — long-lived connections
        location /v1/events {
            proxy_pass         http://aegis_backend;
            proxy_http_version 1.1;
            proxy_set_header   Host            $host;
            proxy_set_header   X-Real-IP       $remote_addr;
            proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header   X-Forwarded-Proto $scheme;
            proxy_set_header   Connection      upgrade;
            proxy_buffering    off;
            proxy_cache       off;
            proxy_read_timeout 86400s;
            chunked_transfer_encoding on;
        }
    }
}
```

### Obtaining TLS Certificates

```bash
# Using Let's Encrypt + Certbot
sudo certbot --nginx -d aegis.yourdomain.com

# Or manual with openssl (self-signed for testing)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout certs/aegis.key -out certs/aegis.crt \
    -subj "/CN=aegis.yourdomain.com"
```

---

## Systemd Service

For bare-metal or VM deployments:

```ini
[Unit]
Description=Aegis Session Orchestrator
After=network.target tmux.service
Wants=network.target

[Service]
Type=simple
User=aegis
Group=aegis
WorkingDirectory=/home/aegis
ExecStart=/usr/local/bin/node /home/aegis/dist/server.js
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

# Environment
Environment=NODE_ENV=production
Environment=AEGIS_AUTH_TOKEN=change-me-in-production
Environment=AEGIS_HOST=127.0.0.1
Environment=AEGIS_PORT=9100

# Security: restrict syscalls
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/home/aegis/.aegis /var/run/tmux /tmp

[Install]
WantedBy=multi-user.target
```

Install and enable:

```bash
sudo cp aegis.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable aegis
sudo systemctl start aegis
```

---

## Production Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` behind reverse proxy) |
| `AEGIS_PORT` | `9100` | HTTP server port |
| `AEGIS_AUTH_TOKEN` | — | **Required.** Secret token for API authentication |
| `AEGIS_STATE_DIR` | `~/.aegis` | Directory for sessions, transcripts, config |
| `AEGIS_ALLOWED_WORK_DIRS` | `["~"]` | Restrict session working directories |
| `AEGIS_TMUX_SOCKET` | `aegis` | tmux socket name |
| `AEGIS_SESSION_TTL_MS` | `3600000` | Session auto-cleanup after inactivity |
| `AEGIS_MAX_SESSIONS` | `50` | Hard limit on concurrent sessions |
| `AEGIS_HOOK_SECRET_HEADER_ONLY` | `false` | Enforce header-only hook secrets |

---

## Health Checks and Readiness

Aegis exposes two health endpoints:

```bash
# Liveness probe — is the server process alive?
curl http://localhost:9100/v1/health

# Readiness probe — is the server ready to accept traffic?
curl http://localhost:9100/v1/health?ready=true
```

**Kubernetes readiness probe:**
```yaml
readinessProbe:
  httpGet:
    path: /v1/health
    port: 9100
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3
```

**Kubernetes liveness probe:**
```yaml
livenessProbe:
  httpGet:
    path: /v1/health
    port: 9100
  initialDelaySeconds: 15
  periodSeconds: 20
  failureThreshold: 3
```

---

## Log Management

Aegis writes structured JSON logs to stdout. Route them to your log aggregator:

```bash
# JSON log format example
{"level":"info","time":"2026-04-22T10:00:00.000Z","msg":"Server started","host":"0.0.0.0","port":9100}

# Ship to stdout (Docker/Kubernetes) — collect with fluentd/fluent-bit
# Ship to file
node dist/server.js 2>&1 | tee /var/log/aegis.log

# Rotate logs
sudo logrotate -f /etc/logrotate.d/aegis
```

`/etc/logrotate.d/aegis`:
```
/var/log/aegis.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        systemctl reload aegis > /dev/null 2>&1 || true
    endscript
}
```

---

## Backup and Recovery

### Session Data

Aegis stores all state in `AEGIS_STATE_DIR` (default `~/.aegis`):

```bash
# Backup
tar -czf aegis-backup-$(date +%Y%m%d).tar.gz \
    ~/.aegis/sessions/ \
    ~/.aegis/transcripts/ \
    ~/.aegis/config.json

# Restore
tar -xzf aegis-backup-YYYYMMDD.tar.gz -C ~/
```

### Session Transcript Format

Each session has a JSONL transcript at `~/.aegis/transcripts/{session-id}.jsonl`. Each line is a message object:

```jsonl
{"role":"user","contentType":"text","text":"Hello","timestamp":"2026-04-22T10:00:00.000Z"}
{"role":"assistant","contentType":"text","text":"Hi, how can I help?","timestamp":"2026-04-22T10:00:01.000Z"}
```

---

## Capacity Planning

| Concurrent Sessions | RAM (approx.) | CPU |
|--------------------|---------------|-----|
| 10 | 512 MB | 1 core |
| 50 | 2 GB | 2 cores |
| 100 | 4 GB | 4 cores |
| 500 | 16 GB | 8 cores |

Each Claude Code session uses ~50-200 MB RAM depending on context size. tmux adds ~2 MB per pane.

---

## Troubleshooting

**Server won't start:**
```bash
# Check tmux is installed
tmux -V

# Check port availability
ss -tlnp | grep 9100

# Run diagnostics
ag doctor
```

**Sessions not starting:**
```bash
# Check Claude Code is installed
claude --version

# Check tmux socket permissions
ls -la /var/run/tmux/
```

**Reverse proxy returning 502:**
```nginx
# Ensure WebSocket headers are forwarded
proxy_set_header Connection "upgrade";
```
