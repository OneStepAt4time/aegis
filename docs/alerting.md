# Alerting Guide

Aegis includes an **AlertManager** that monitors system health and fires webhook notifications when failure thresholds are exceeded. Designed to prevent alert fatigue with configurable cooldown windows.

---

## How It Works

AlertManager tracks failure events in sliding windows. When a failure type exceeds `failureThreshold` within the `cooldownMs` window, a webhook is fired.

**Alert types monitored:**
- `session_failure` — Claude Code session crashes or exits unexpectedly
- `tmux_crash` — tmux process terminates
- `api_error_rate` — high rate of API errors

**Failure tracking:**
- Per-type sliding window resets after `cooldownMs` with no failures
- When threshold is hit and cooldown has elapsed → alert fires
- Fire-and-forget delivery (doesn't block the calling code)

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_ALERT_WEBHOOKS` | — | Comma-separated list of webhook URLs |
| `AEGIS_ALERT_FAILURE_THRESHOLD` | `5` | Failures before alert fires |
| `AEGIS_ALERT_COOLDOWN_MS` | `600000` (10 min) | Minimum ms between alerts of the same type |

**Example:**
```bash
AEGIS_ALERT_WEBHOOKS="https://example.com/alerts,https://backup.com/alerts" \
AEGIS_ALERT_FAILURE_THRESHOLD=3 \
AEGIS_ALERT_COOLDOWN_MS=300000 \
AEGIS_AUTH_TOKEN=my-secret \
ag
```

### Programmatic Configuration

```typescript
import { AlertManager } from './alerting.js';

const alertManager = new AlertManager({
  webhooks: ['https://example.com/alerts'],
  failureThreshold: 5,
  cooldownMs: 10 * 60 * 1000, // 10 minutes
});
```

---

## API Endpoints

### Test Alert Webhook

Fires a test alert to all configured webhooks. Use to verify webhook connectivity.

```bash
curl -X POST http://localhost:9100/v1/alerts/test \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"https://example.com/alerts","secret":"test-secret"}'
```

**Response — webhook configured:**
```json
{
  "sent": true,
  "webhookCount": 2
}
```

**Response — no webhooks configured:**
```json
{
  "sent": false,
  "message": "No alert webhooks configured (set AEGIS_ALERT_WEBHOOKS)"
}
```

**Response — delivery failed:**
```json
{
  "error": "Alert delivery failed: Alert webhook returned HTTP 502"
}
```

**Required role:** `admin` or `operator`

---

### Webhook Delivery Retry

Failed webhook deliveries are automatically retried with fixed delays. The retry policy:
- **Retryable codes:** HTTP 5xx errors and HTTP 429 (rate limited)
- **Delays:** 1 second → 5 seconds → 30 seconds (3 attempts total)
- **Non-retryable:** HTTP 4xx errors (except 429) are not retried

After all retries are exhausted, the delivery is recorded as `failed` and may be eligible for dead-letter queue processing.

### Webhook Delivery History

Query the delivery history for any webhook:

```bash
curl http://localhost:9100/v1/hooks/:id/deliveries \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response:**
```json
{
  "deliveries": [
    {
      "attempt": 3,
      "status": "success",
      "responseCode": 200,
      "timestamp": "2026-04-23T10:30:00.000Z"
    },
    {
      "attempt": 2,
      "status": "failed",
      "responseCode": 429,
      "timestamp": "2026-04-23T10:29:55.000Z"
    },
    {
      "attempt": 1,
      "status": "failed",
      "responseCode": 503,
      "timestamp": "2026-04-23T10:29:50.000Z"
    }
  ]
}
```

Each entry includes the attempt number, HTTP status code, and timestamp. Use delivery history to inspect retry behavior and diagnose webhook issues.

---

### Get Alert Statistics

Returns current failure counts and delivery stats.

```bash
curl http://localhost:9100/v1/alerts/stats \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response:**
```json
{
  "delivered": 3,
  "failed": 1,
  "trackers": {
    "session_failure": { "count": 2, "lastAlertAt": 1744137600000 },
    "tmux_crash": { "count": 0, "lastAlertAt": 0 }
  }
}
```

**Fields:**
- `delivered` — total successful webhook deliveries
- `failed` — total failed webhook deliveries
- `trackers` — per-type failure counts and last alert timestamp

**Required role:** `admin`, `operator`, or `viewer`

---

## Webhook Payload

When an alert fires, each configured URL receives:

```json
{
  "event": "alert",
  "type": "session_failure",
  "timestamp": "2026-04-13T20:00:00.000Z",
  "detail": "Session 3f47a2b1 crashed with exit code 1",
  "failureCount": 5,
  "threshold": 5,
  "source": "aegis"
}
```

**Headers sent:**
- `Content-Type: application/json`
- `X-Aegis-Alert-Type: <alert-type>`

---

## SSRF Protection

AlertManager validates webhook URLs before delivery:

1. **Localhost blocking** — webhooks to `127.0.0.1`, `::1`, or `localhost` are allowed (for internal tooling)
2. **DNS rebinding protection** — non-localhost URLs are resolved and checked before delivery
3. **Timeout** — 5 second timeout on all webhook deliveries

---

## Integration Examples

### PagerDuty

```typescript
const alertManager = new AlertManager({
  webhooks: [
    `https://events.pagerduty.com/v2/enqueue?routing_key=${PAGERDUTY_KEY}`,
  ],
  failureThreshold: 3,
  cooldownMs: 5 * 60 * 1000,
});
```

PagerDuty accepts the standard webhook payload without transformation.

### Grafana Alertmanager

```bash
AEGIS_ALERT_WEBHOOKS="https://alertmanager.example.com/api/v1/alerts"
```

### Custom Slack Webhook

```bash
AEGIS_ALERT_WEBHOOKS="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

---

## Troubleshooting

**Alert not firing despite failures:**
- Check `AEGIS_ALERT_WEBHOOKS` is set and URLs are reachable
- Verify `failureThreshold` hasn't been reached
- Check `cooldownMs` — alerts won't fire within the cooldown window

**Webhook returning 502:**
- The endpoint exists but returned an error
- Check your webhook receiver logs
- Use `POST /v1/alerts/test` to debug

**All webhooks fail silently:**
- Failed deliveries increment the `failed` counter
- Check `GET /v1/alerts/stats` for delivery statistics
- AlertManager logs `ALERT_DELIVERY_FAILED` to stderr

---

## Architecture

```
AlertManager (src/alerting.ts)
├── recordFailure(type, detail)  → checks threshold, fires if exceeded
├── fireTestAlert()               → POST /v1/alerts/test endpoint
├── getStats()                    → GET /v1/alerts/stats endpoint
└── reset()                       → clears all trackers

FailureTracker (per type)
├── count           — failures in current window
├── windowStart    — when the window started
└── lastAlertAt    — when the last alert fired
```

AlertManager is wired into the `Monitor` for session/tmux failures and is initialized in `server.ts` during startup.
