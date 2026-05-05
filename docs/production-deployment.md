# Production Deployment Guide

This guide covers production-grade deployment of Aegis: Docker, Docker Compose, reverse proxy, TLS, and Kubernetes.

## Multi-Stage Dockerfile

Create `Dockerfile` in the repository root:

```dockerfile
# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build 2>/dev/null || true

# Stage 2: Production
FROM node:22-alpine AS production
RUN apk add --no-cache dumb-init
WORKDIR /app
# Create non-root user for security
RUN addgroup -g 1001 -S aegis && adduser -S aegis -u 1001
COPY --from=builder --chown=aegis:aegis /app/dist ./dist
COPY --from=builder --chown=aegis:aegis /app/node_modules ./node_modules
COPY --chown=aegis:aegis package*.json ./
USER aegis
ENV NODE_ENV=production
EXPOSE 9100
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:9100/v1/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

Build and tag:

```bash
docker build -t onestepat4time/aegis:latest .
docker tag onestepat4time/aegis:latest onestepat4time/aegis:$(git describe --tags)
```

## Docker Compose (Recommended)

Create `docker-compose.yml`:

```yaml
version: '3.9'

services:
  aegis:
    image: onestepat4time/aegis:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:9100:9100"   # Local-only — reverse proxy handles external
    environment:
      AEGIS_AUTH_TOKEN: "${AEGIS_AUTH_TOKEN}"   # Required — generate with: openssl rand -hex 32
      AEGIS_PORT: 9100
      AEGIS_HOST: "0.0.0.0"
      AEGIS_STATE_DIR: /data/aegis
      AEGIS_DASHBOARD_ENABLED: "true"
      AEGIS_TMUX_SESSION: aegis
      AEGIS_MAX_SESSION_AGE_MS: 7200000       # 2 hours
      AEGIS_SHUTDOWN_GRACE_MS: 15000
      AEGIS_METRICS_TOKEN: "${AEGIS_METRICS_TOKEN:-}"
    volumes:
      - aegis-data:/data/aegis
      - /home/bubuntu/.claude:/home/aegis/.claude:ro   # Claude Code binaries (read-only)
      - /run/user/1001:/run/user/1001                     # For tmux socket
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:9100/v1/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M
      restart_policy:
        condition: on-failure
        max_attempts: 3

  # Optional: nginx reverse proxy for TLS termination
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - aegis-data:/data/aegis
      - ./tls:/etc/letsencrypt:ro
    depends_on:
      aegis:
        condition: service_healthy

volumes:
  aegis-data:
    driver: local
```

## nginx Reverse Proxy

```nginx
# /etc/nginx/conf.d/aegis.conf

upstream aegis {
    server 127.0.0.1:9100;
    keepalive 32;
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=aegis_api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=aegis_auth:1m rate=5r/m;

server {
    listen 80;
    server_name aegis.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name aegis.example.com;

    # TLS configuration
    ssl_certificate /etc/letsencrypt/live/aegis.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aegis.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # Claude Code dashboard
    location /dashboard/ {
        proxy_pass http://aegis/dashboard/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Aegis API
    location / {
        limit_req zone=aegis_api burst=50 nodelay;
        proxy_pass http://aegis;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;

        # For SSE endpoints
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Accept text/event-stream;
    }
}
```

## TLS with Let's Encrypt

```bash
# Install certbot
apt install -y certbot python3-certbot-nginx

# Obtain certificate (stop nginx first)
docker compose stop nginx
certbot certonly --nginx -d aegis.example.com --agree-tos -m admin@example.com --non-interactive
mkdir -p tls
ln -sf /etc/letsencrypt/live/aegis.example.com tls/
docker compose up -d nginx
```

Auto-renewal — add to crontab:

```cron
0 3 * * * certbot renew --quiet --deploy-hook "docker compose exec nginx nginx -s reload"
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AEGIS_AUTH_TOKEN` | **Yes** | — | Bearer token. Generate: `openssl rand -hex 32` |
| `AEGIS_PORT` | No | `9100` | HTTP server port |
| `AEGIS_HOST` | No | `0.0.0.0` | Bind address |
| `AEGIS_STATE_DIR` | No | `~/.aegis` | Session state, audit logs, metrics |
| `AEGIS_BASE_URL` | No | `http://localhost:9100` | Public base URL for callbacks/webhooks |
| `AEGIS_DASHBOARD_ENABLED` | No | `true` | Enable/disable dashboard UI |
| `AEGIS_TMUX_SESSION` | No | `aegis` | tmux session name |
| `AEGIS_MAX_SESSION_AGE_MS` | No | `7200000` | Max session lifetime (2h) |
| `AEGIS_SHUTDOWN_GRACE_MS` | No | `15000` | Grace period for shutdown |
| `AEGIS_METRICS_TOKEN` | No | — | Token for `/metrics` endpoint auth |
| `AEGIS_REAPER_INTERVAL_MS` | No | `300000` | Session cleanup check interval (5min) |
| `ANTHROPIC_AUTH_TOKEN` | No | — | Anthropic API key for Claude Code sessions |
| `ANTHROPIC_BASE_URL` | No | — | Custom Anthropic API endpoint |

## Volume Mounts

| Host path | Container path | Purpose |
|-----------|----------------|---------|
| `aegis-data` (vol) | `/data/aegis` | Session state, audit logs, API key store |
| `~/.claude` (ro) | `/home/aegis/.claude` | Claude Code projects and sessions |
| `/run/user/1001` | `/run/user/1001` | tmux socket (uid 1001 = aegis user) |

## Backup and Restore

```bash
# Backup (run while container is running)
docker run --rm \
  -v aegis-data:/data/aegis \
  -v $(pwd)/backups:/backups \
  alpine tar czf /backups/aegis-$(date +%Y%m%d-%H%M%S).tar.gz -C /data/aegis .

# Restore
docker compose down
docker run --rm \
  -v aegis-data:/data/aegis \
  -v $(pwd)/backups:/backups \
  alpine sh -c "rm -rf /data/aegis/* && tar xzf /backups/aegis-YYYYMMDD-HHMMSS.tar.gz -C /data/aegis"
docker compose up -d
```

## Kubernetes (Helm)

For Helm deployment, see the Helm chart at `helm/` in the repository. Production values:

```yaml
# values-production.yaml
replicaCount: 2

image:
  repository: onestepat4time/aegis
  tag: latest

env:
  AEGIS_AUTH_TOKEN:
    valueFrom:
      secretKeyRef:
        name: aegis-secret
        key: auth-token
  AEGIS_PORT: 9100
  AEGIS_HOST: "0.0.0.0"
  AEGIS_STATE_DIR: /data/aegis
  AEGIS_DASHBOARD_ENABLED: "true"

persistence:
  enabled: true
  size: 10Gi
  storageClass: standard

service:
  type: ClusterIP
  port: 9100

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "86400"
  hosts:
    - host: aegis.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: aegis-tls
      hosts:
        - aegis.example.com

resources:
  limits:
    memory: 2Gi
  requests:
    memory: 512Mi

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

podDisruptionBudget:
  enabled: true
  minAvailable: 1
```

## Health Check

Aegis exposes health at `GET /v1/health` (no auth required):

```bash
curl -s http://localhost:9100/v1/health | python3 -m json.tool
# Expected:
{
  "status": "ok",
  "timestamp": "...",
  "sessions": { "active": 0, "total": 0 }
}
```

## Updating

```bash
# Pull latest image
docker pull onestepat4time/aegis:latest

# Rolling update (Docker Compose)
docker compose up -d --no-deps --build aegis

# Or with Watchtower (auto-update)
docker run -d \
  --name watchtower \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/.docker/config.json:/config.json:ro \
  containrrr/watchtower \
  --interval 300 \
  aegis
```
