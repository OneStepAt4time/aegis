# Enterprise Onboarding Guide

This guide covers Aegis features and deployment patterns relevant to enterprise customers — teams, organizations, and production deployments.

For the standard quick-start guide, see [onboarding.md](./onboarding.md).

---

## Enterprise Features

### Role-Based Access Control (RBAC)

Aegis supports three permission roles for API keys:

| Role | Description |
|------|-------------|
| `viewer` | Read-only access — list sessions, view transcripts, read metrics |
| `operator` | Create and manage own sessions — create, send, kill |
| `admin` | Full access — all operator permissions + manage API keys, templates, pipelines |

When creating API keys, choose the minimum role required:

```bash
# Create an operator key (session owner)
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-agent", "role": "operator"}'

# Create a viewer key (dashboard only)
curl -X POST http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "observer", "role": "viewer"}'
```

Session ownership is enforced — operator keys can only send, kill, or interrupt their own sessions. Admin or master token required for cross-session operations.

### Audit Logs

All session events are recorded in an immutable audit log. Query the last 30 days:

```bash
curl http://localhost:9100/v1/audit \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "limit=100&page=1"
```

Export audit logs:

```bash
# JSON export
curl http://localhost:9100/v1/audit?format=json -H "Authorization: Bearer $ADMIN_TOKEN"

# CSV export
curl http://localhost:9100/v1/audit?format=csv -H "Authorization: Bearer $ADMIN_TOKEN"
```

Audit records include: session ID, action type, actor key, timestamp, IP address, and result.

### Memory Bridge

The optional key-value memory bridge stores persistent state across sessions:

```bash
# Set a value
curl -X POST http://localhost:9100/v1/memory/my-key \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "context-data"}'

# Get a value
curl http://localhost:9100/v1/memory/my-key \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
```

Memory is session-scoped by default — each API key's memories are isolated.

---

## Deployment

### Self-Hosted (Recommended)

Aegis runs as a single Node.js process. For production:

```bash
# Install
npm install -g @onestepat4time/aegis

# Run with environment variables
AEGIS_AUTH_TOKEN=your-secret-token \
AEGIS_HOST=0.0.0.0 \
AEGIS_PORT=9100 \
aegis
```

Recommended deployment options:
- **Systemd service** — run as a system service with auto-restart
- **PM2** — process manager with clustering
- **Docker** — containerized deployment (see `deploy/docker/` in the repo)

### Helm Chart (Kubernetes)

For Kubernetes deployments:

```bash
helm repo add aegis https://onestepat4time.github.io/aegis
helm install aegis aegis/aegis \
  --set aegis.authToken=your-secret \
  --set aegis.host=0.0.0.0
```

See `deploy/helm/` in the repo for the full chart.

### On-Premises

For air-gapped or on-premises environments:

1. Download the release tarball from GitHub Releases
2. Verify integrity with SHA-256 or Sigstore attestation (see [verify-release.md](./verify-release.md))
3. Install in your internal network
4. Configure `allowedWorkDirs` to restrict session working directories
5. Set up internal authentication via your own SSO/LDAP proxy in front of Aegis

No external network access required — Aegis is fully self-contained.

---

## Rate Limiting

API requests are rate-limited per API key:

| Window | Limit |
|--------|-------|
| 1 minute | 100 requests |

Rate limit headers are returned on every response:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1776812400
```

When rate-limited, the API returns `429 Too Many Requests` with a `retryAfter` field.

---

## Webhooks

Register webhook endpoints to receive real-time notifications:

```bash
curl -X POST http://localhost:9100/v1/hooks/Stop \
  -H "X-Hook-Secret: your-webhook-secret" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-server.com/webhook"}'
```

Aegis sends POST requests to your endpoint on session events (`Start`, `Stop`, ` permission_prompt`). The hook secret is verified using constant-time comparison.

---

## Error Codes for Enterprise Integrations

All API errors return a structured envelope:

```json
{
  "error": "Session not found",
  "code": "SESSION_NOT_FOUND",
  "statusCode": 404
}
```

Common error codes for integrations:

| Code | HTTP | When it happens |
|------|------|----------------|
| `SESSION_NOT_FOUND` | 404 | Session deleted or wrong ID |
| `AUTH_ERROR` | 401 | Missing or invalid token |
| `RATE_LIMITED` | 429 | Too many requests |
| `VALIDATION_ERROR` | 422 | Invalid request body |
| `SESSION_CREATE_FAILED` | 500 | Tmux or Claude Code failed to start |

---

## Next Steps

- [Enterprise Architecture](./enterprise/01-architecture.md) — system design for production
- [Enterprise Security](./enterprise/02-security.md) — hardening guide
- [Deployment Guide](./deployment.md) — production deployment patterns
- [API Reference](./api-reference.md) — all endpoints
