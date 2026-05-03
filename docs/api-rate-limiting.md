# API Rate Limiting

Aegis applies rate limits to protect the server from abuse and ensure fair resource allocation across clients. Rate limiting is enabled by default and covers all API endpoints.

---

## Overview

Rate limiting is **per API key** (or per IP for unauthenticated requests). Two limits apply:

| Endpoint Group | Default Limit | Time Window |
|---------------|--------------|-------------|
| `/v1/sessions/*` | 100 requests | 60 seconds |
| All other endpoints | 30 requests | 60 seconds |

When a limit is exceeded, the server returns `429 Too Many Requests`.

---

## Response Headers

Every API response includes rate limit headers:

```
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 27
X-RateLimit-Reset: 1713782460
```

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |

---

## 429 Response

When the limit is exceeded:

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"workDir": "/tmp/test"}'
```

**Response `429`:**
```json
{"error": "Rate limit exceeded. Retry after 12 seconds."}
```

A `Retry-After` header is also included:

```
Retry-After: 12
```

---

## Configuration

Rate limiting is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting |
| `AEGIS_RATE_LIMIT_SESSIONS_MAX` | `100` | Max requests per window for session endpoints |
| `AEGIS_RATE_LIMIT_GENERAL_MAX` | `30` | Max requests per window for all other endpoints |
| `AEGIS_RATE_LIMIT_TIME_WINDOW_SEC` | `60` | Time window in seconds |

### Examples

**Disable rate limiting (not recommended in production):**
```bash
export AEGIS_RATE_LIMIT_ENABLED=false
```

**Increase session endpoint limit:**
```bash
export AEGIS_RATE_LIMIT_SESSIONS_MAX=200
```

**Decrease general endpoint limit for stricter throttling:**
```bash
export AEGIS_RATE_LIMIT_GENERAL_MAX=10
```

**Change the time window to 30 seconds:**
```bash
export AEGIS_RATE_LIMIT_TIME_WINDOW_SEC=30
```

---

## Per-Key vs Per-IP

Aegis uses **two separate rate-limiting layers**:

1. **Fastify plugin** — per-endpoint-group, per-key limits (configurable via env vars above)
2. **Custom IP rate limiter** — separate buckets by request type to prevent cross-bucket exhaustion

### Bucket Separation (IP Layer)

The custom rate limiter maintains independent buckets so that one type of traffic cannot exhaust another's quota:

| Bucket | Key | Limit | Window | Description |
|---|---|---|---|---|
| Authenticated | `<ip>:<keyId>` | 120 req/min | 60s | Per API key. Different keys on the same IP have independent buckets. |
| Authenticated (master) | `<ip>:<keyId>` | 300 req/min | 60s | Master token gets a higher limit. |
| Unauthenticated | `unauth:<ip>` | 30 req/min | 60s | Health pings, bad tokens, no-auth traffic. |
| Auth failure | `<ip>:<authFail>` | 5 failures/min | 60s | Locks out after 5 failed auth attempts per IP. |
| SSE | per-connection | 10 msg/s | — | Per SSE client connection. |

This means unauthenticated traffic (health checks, missing tokens) cannot exhaust the rate-limit bucket used by valid API keys on the same IP.

Stale buckets are automatically pruned every 60 seconds to prevent memory growth.

```bash
curl http://localhost:9100/v1/auth/keys \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

```json
[
  {
    "id": "key-abc123",
    "name": "ci-bot",
    "role": "operator",
    "rateLimit": 100,
    "lastUsedAt": 1713782000
  }
]
```

---

## Monitoring Rate Limits

### Check current usage

```bash
# Health endpoint shows rate limit config
curl http://localhost:9100/v1/health \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

### Audit log

Rate limit hits are logged in the audit log:

```bash
curl "http://localhost:9100/v1/audit?from=2026-04-23T00:00:00Z&format=ndjson" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  | grep -i "rate_limit\|rate_limit_exceeded"
```

---

## Best Practices

### Handle 429 gracefully

```typescript
async function createSession(workDir: string) {
  const response = await fetch('http://localhost:9100/v1/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.AEGIS_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ workDir }),
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') ?? '5';
    console.log(`Rate limited. Waiting ${retryAfter}s...`);
    await new Promise(resolve => setTimeout(resolve, parseInt(retryAfter) * 1000));
    return createSession(workDir); // retry
  }

  return response.json();
}
```

### Read headers before hitting limits

```typescript
async function safeRequest(url: string, options: RequestInit) {
  const response = await fetch(url, options);
  const remaining = response.headers.get('X-RateLimit-Remaining');

  if (remaining !== null && parseInt(remaining) < 5) {
    const reset = response.headers.get('X-RateLimit-Reset');
    const waitMs = (parseInt(reset!) - Date.now() / 1000) * 1000;
    console.warn(`Only ${remaining} requests left. Waiting for reset in ${Math.ceil(waitMs / 1000)}s`);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, waitMs)));
  }

  return response;
}
```

### Batch where possible

Use batch endpoints instead of many individual requests:

```bash
# Instead of 10 POST /v1/sessions calls, use one batch call:
curl -X POST http://localhost:9100/v1/sessions/batch \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessions": [{"workDir": "/a"}, {"workDir": "/b"}, {"workDir": "/c"}]}'
```

---

## Troubleshooting

**"Rate limit exceeded" on every request:**
- Check `X-RateLimit-Reset` header — you may be in a quiet window
- Verify no other process is using the same API key
- Increase limits via environment variables if your use case requires it

**Rate limit not working:**
- Verify `AEGIS_RATE_LIMIT_ENABLED=true` (default is `true`)
- Check server logs for rate limit events

**Different limits for different keys:**
- API keys can have individual `rateLimit` values set at creation time
- Contact your Aegis administrator to adjust key limits

---

## Webhook Rate Limits

Outbound webhooks have **separate** rate limiting from API request limits. When Aegis delivers a webhook:

1. If the target server returns `429`, Aegis retries with **exponential backoff**: 1s → 5s → 30s
2. After 3 failed attempts, the delivery is moved to the **dead letter queue**
3. View failed deliveries: `GET /v1/webhooks/dead-letter`

See [Webhook Retry Logic](webhook-retry.md) for full details.
