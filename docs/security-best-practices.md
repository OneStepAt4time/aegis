# Security Best Practices

Hardening guide for production Aegis deployments. Covers authentication, network security, secrets management, environment hardening, and operational security.

For the full security policy, see [SECURITY.md](../SECURITY.md).

---

## Authentication

### Use Strong API Tokens

Never use predictable or empty tokens in production:

```bash
# Generate a cryptographically random token
openssl rand -hex 32

# Store in environment
export AEGIS_AUTH_TOKEN="$(openssl rand -hex 32)"
```

Rotate tokens regularly using the rotation API:

```bash
curl -X POST http://localhost:9100/v1/auth/keys/key-abc123/rotate \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ttlDays": 90}'
```

### Role-Based Access Control

Create API keys with the minimum required role:

| Role | When to Use |
|------|-------------|
| `viewer` | Dashboards, read-only monitoring |
| `operator` | CI pipelines, automation scripts |
| `admin` | Key management, system configuration |

```bash
# Create a read-only key for monitoring
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "prometheus", "role": "viewer"}'
```

---

## Network Security

### Always Use HTTPS

Aegis does not handle TLS directly. Deploy behind a reverse proxy:

```nginx
# nginx.conf
server {
    listen 443 ssl;
    ssl_certificate     /etc/nginx/certs/aegis.crt;
    ssl_certificate_key /etc/nginx/certs/aegis.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

For Let's Encrypt:

```bash
certbot --nginx -d aegis.yourdomain.com
```

### Bind to localhost Behind Proxy

Never expose Aegis directly to the internet:

```bash
export AEGIS_HOST=127.0.0.1   # Only accept local connections
export AEGIS_PORT=9100
```

### IP Allowlisting

Restrict access to known IP ranges via firewall or nginx:

```nginx
# nginx.conf — restrict to specific IPs
allow 10.0.0.0/8;
allow 172.16.0.0/12;
allow 192.168.0.0/16;
deny all;
```

### SSE / WebSocket Support

Enable proxy buffering off for long-lived connections:

```nginx
location /v1/events {
    proxy_pass http://127.0.0.1:9100;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    chunked_transfer_encoding on;
}
```

---

## Environment Variables

### Protect AEGIS_AUTH_TOKEN

Never commit tokens to version control:

```bash
# .gitignore
.env
.env.*
*.log

# Use a secrets manager instead
export AEGIS_AUTH_TOKEN=$(vault read -field=value secret/aegis/prod/token)
```

### Environment Variable Denylist

Aegis automatically blocks dangerous env vars from being injected into sessions. This includes:

**Credential vars (always blocked):**
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CLAUDE_API_KEY`
- `GITHUB_TOKEN`, `NPM_TOKEN`, `AWS_ACCESS_KEY_ID`
- `DATABASE_URL`, `SECRET_KEY`, `JWT_SECRET`

**Injection vectors (always blocked):**
- `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_INSERT_LIBRARIES`
- `PYTHONPATH`, `NODE_PATH`, `PROMPT_COMMAND`
- `PATH`, `SHELL`, `IFS`

**Dangerous prefixes (any matching prefix blocked):**
- `npm_config_`, `ssh_`, `github_`, `gitlab_`, `aws_`
- `azure_`, `tf_`, `ci_`, `bash_func_`

Do not attempt to override these. They are enforced server-side and cannot be bypassed by session creators.

### Session Directory Restrictions

Limit where sessions can be created:

```bash
export AEGIS_ALLOWED_WORK_DIRS='["/home/user/projects", "/opt/agent"]'
```

Empty array (`[]`) allows all directories (backward compatible default).

---

## Rate Limiting

Enable and tune rate limiting for all production deployments:

```bash
export AEGIS_RATE_LIMIT_ENABLED=true
export AEGIS_RATE_LIMIT_SESSIONS_MAX=100    # session endpoints
export AEGIS_RATE_LIMIT_GENERAL_MAX=30      # all other endpoints
export AEGIS_RATE_LIMIT_TIME_WINDOW_SEC=60
```

Handle `429` responses gracefully:

```typescript
async function apiRequest(url: string, options: RequestInit) {
  const response = await fetch(url, options);

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') ?? '5';
    await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
    return apiRequest(url, options); // retry
  }

  return response;
}
```

---

## Webhook Security

### Hook Secret Transport

Always use header-based secrets in production:

```bash
export AEGIS_HOOK_SECRET_HEADER_ONLY=true
```

Then include the secret in requests:

```bash
curl -X POST "http://localhost:9100/v1/hooks/Stop" \
  -H "X-Hook-Secret: your-secret-here" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "abc123"}'
```

### Webhook Retry

Aegis retries failed webhook deliveries (429 / 5xx) with exponential backoff:

- Attempt 1: immediate
- Attempt 2: after 1 second
- Attempt 3: after 5 seconds
- Attempt 4: after 30 seconds

After 4 failed attempts, the delivery moves to the dead letter queue:

```bash
# View failed deliveries
curl http://localhost:9100/v1/webhooks/dead-letter \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

---

## Secrets in Sessions

### Claude Code API Keys

If Claude Code needs an API key, inject it only for the session:

```bash
# Session with scoped env — key only exists in that tmux pane
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workDir": "/home/user/project",
    "prompt": "Review this PR",
    "env": {
      "ANTHROPIC_API_KEY": "sk-ant-..."
    }
  }'
```

The key is injected only into that session's environment and is never stored in transcripts or logs.

### Avoid Storing Secrets in Working Directories

Do not place API keys in `.env` files inside session working directories. Use the `env` parameter instead, or a secrets manager.

---

## Session Isolation

### Permission Profiles

Use permission profiles to restrict what Claude Code can do:

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permission-profile \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"profile": "restricted"}'
```

Profiles: `default`, `restricted`, `minimal`.

### Permission Policies

For fine-grained control:

```bash
curl -X PUT http://localhost:9100/v1/sessions/abc123/permissions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"path": "/api/*", "allow": true},
    {"path": "/admin/*", "allow": false}
  ]'
```

---

## Monitoring and Audit

### Enable Audit Logging

All API operations are logged. Export audit logs regularly:

```bash
# Export as CSV
curl "http://localhost:9100/v1/audit?from=2026-04-01T00:00:00Z&format=csv" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  > audit-$(date +%Y%m%d).csv

# Stream to SIEM
curl "http://localhost:9100/v1/audit?format=ndjson" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  | jq '.action' | sort | uniq -c | sort -rn
```

### Monitor Session Health

Track stalled and dead sessions:

```bash
curl http://localhost:9100/v1/sessions/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Sessions marked `stalled: true` should be investigated. Set `AEGIS_SESSION_TTL_MS` to auto-cleanup:

```bash
export AEGIS_SESSION_TTL_MS=3600000   # 1 hour of inactivity
```

---

## Docker Security

### Run as Non-Root

The official Dockerfile runs as non-root:

```dockerfile
RUN groupadd -r aegis && useradd -r -g aegis aegis
USER aegis
```

Do not override this with `--user root` in production.

### Read-Only Filesystem

Mount volumes for session data only:

```yaml
services:
  aegis:
    read_only: true
    volumes:
      - aegis-state:/home/aegis/.aegis
      - /var/run/tmux:/var/run/tmux
```

### Resource Limits

Set memory and CPU limits:

```yaml
services:
  aegis:
    mem_limit: 2g
    cpus: 2
```

---

## Security Checklist

Before going to production:

- [ ] `AEGIS_AUTH_TOKEN` is randomly generated (32+ chars)
- [ ] Aegis bound to `127.0.0.1` behind reverse proxy
- [ ] HTTPS configured with TLS 1.2+
- [ ] API keys use minimum required role (`viewer` for dashboards)
- [ ] `AEGIS_HOOK_SECRET_HEADER_ONLY=true` set
- [ ] Rate limiting enabled and tuned
- [ ] `AEGIS_ALLOWED_WORK_DIRS` restricts session directories
- [ ] `AEGIS_SESSION_TTL_MS` set for auto-cleanup
- [ ] Audit logs exported and monitored
- [ ] No credentials in `.env` files in working directories
- [ ] Docker runs as non-root with resource limits
- [ ] SSO/SAML configured for team access (enterprise tier)

---

## Reporting Security Issues

If you discover a security vulnerability:

1. **Private report**: Open a [GitHub Security Advisory](https://github.com/OneStepAt4time/aegis/security/advisories/new)
2. **Response time**: Acknowledged within 48 hours
3. **Updates**: Security patches released through the alpha channel

Do **not** report security issues in public GitHub issues.

---

## See Also

- [SECURITY.md](../SECURITY.md) — full security policy
- [Deployment Guide](deployment.md) — production deployment
- [API Rate Limiting](api-rate-limiting.md) — rate limit configuration
- [Webhook Retry](webhook-retry.md) — webhook delivery with retry
