# Notification Channels

Aegis can alert you on session events via Telegram, Slack, Email, and generic webhooks. Configure one or more channels — events fan out to all active channels simultaneously.

## Quick Reference

| Channel | Trigger | Setup effort |
|---------|---------|-------------|
| [Telegram](#telegram) | Any session event | 5 min |
| [Webhooks](#webhooks) | Any session event | 2 min |
| [Slack](#slack) | Any session event | 5 min |
| [Email](#email) | stall / dead / error | 5 min |

---

## Telegram

Telegram provides bidirectional communication — you can approve/reject permission prompts directly from Telegram.

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) → copy the bot token
2. Create a group → add your bot as admin → get the group chat ID
3. Set env vars and restart Aegis:

```bash
AEGIS_TG_BOT_TOKEN=123456:ABC-DEF
AEGIS_TG_GROUP_ID=-1001234567890
AEGIS_TG_ALLOWED_USERS=user1,user2  # optional
```

### Events

- `session.created` — new session started
- `session.ended` — session completed or killed
- `status.*` — all status transitions (working, idle, permission, etc.)
- `message.*` — messages (batched, not every keystroke)

---

## Webhooks

Generic HTTP POST to any URL. Good for connecting to Zapier, Make, or your own infrastructure.

### Setup

```bash
AEGIS_WEBHOOKS='[{"url": "https://your-webhook-endpoint.com/hook"}]'
```

### Advanced Webhook Options

```bash
AEGIS_WEBHOOKS='[
  {
    "url": "https://your-webhook-endpoint.com/hook",
    "events": ["session.ended", "status.stall", "status.dead"],
    "headers": { "Authorization": "Bearer your-token" },
    "timeoutMs": 5000,
    "secret": "your-hmac-secret",
    "redactContent": true
  }
]'
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `events` | `string[]` | all | Filter events |
| `headers` | `object` | `{}` | Custom request headers |
| `timeoutMs` | `number` | `5000` | Request timeout |
| `secret` | `string` | — | HMAC-SHA256 signing secret |
| `redactContent` | `boolean` | `false` | Replace message content with `[REDACTED]` |

### Signature Verification

If `secret` is set, Aegis signs the request body:

```
X-Aegis-Signature: sha256=<hex-encoded-hmac>
```

Verify in your endpoint:

```typescript
import crypto from 'node:crypto';

function verify(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', '')),
    Buffer.from(expected)
  );
}
```

### Webhook Payload

```json
{
  "event": "session.ended",
  "timestamp": "2026-04-09T07:30:00.000Z",
  "session": {
    "id": "a1b2c3d4-...",
    "name": "my-project-session",
    "workDir": "/home/user/project"
  },
  "detail": "Session ended normally",
  "meta": {}
}
```

---

## Slack

Sends formatted Slack messages with Block Kit UI to any channel via Incoming Webhooks.

### Setup

1. Create a Slack App at [api.slack.com](https://api.slack.com/apps)
2. Enable **Incoming Webhooks** → add a webhook to your workspace
3. Copy the webhook URL

```bash
AEGIS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
```

### Optional Configuration

```bash
# Only these events (default: all)
AEGIS_SLACK_EVENTS='["status.stall", "status.dead", "session.ended"]'

# Channel override (for Bot token webhooks)
AEGIS_SLACK_CHANNEL=#ops-alerts

# Request timeout in ms (default: 5000)
AEGIS_SLACK_TIMEOUT_MS=5000
```

### Message Format

Slack messages use Block Kit with color-coded severity:

| Event | Emoji | Color |
|-------|-------|-------|
| `session.created` | :large_green_circle: | Green |
| `session.ended` | :grey_circle: | Grey |
| `status.working` | :hourglass_flowing_sand: | Blue |
| `status.stall` | :warning: | Yellow |
| `status.dead` | :skull: | Red |
| `status.error` | :x: | Red |

---

## Email (SMTP)

Delivers alerts for critical events (stall, dead, error, permission timeout) to an ops email address.

### Setup

```bash
AEGIS_EMAIL_HOST=smtp.example.com
AEGIS_EMAIL_PORT=587
AEGIS_EMAIL_USER=alerts@example.com
AEGIS_EMAIL_PASS=your-password-or-app-key
AEGIS_EMAIL_TO=ops-team@example.com
AEGIS_EMAIL_FROM=aegis@example.com
```

### Optional Configuration

```bash
# Secure mode (default: false, auto-true for port 465)
AEGIS_EMAIL_SECURE=true

# Timeout in ms (default: 10000)
AEGIS_EMAIL_TIMEOUT_MS=10000

# Custom events (default: stall, dead, error, permission_timeout)
AEGIS_EMAIL_EVENTS='["status.stall", "status.dead"]'
```

### Email Alerts

Subject lines indicate severity:

- `[ACTION] Session Stalled` — session idle > threshold
- `[CRITICAL] Session Dead` — session unresponsive
- `[ERROR] Session Error` — error state detected
- `[WARNING] Permission Timeout` — user didn't respond in time

---

## Event Reference

All channels receive events from this set:

| Event | Trigger |
|-------|---------|
| `session.created` | New session created |
| `session.ended` | Session ended (normal, killed, or failed) |
| `message.user` | User message sent to session |
| `message.assistant` | Claude Code response |
| `message.thinking` | Claude Code thinking |
| `message.tool_use` | Tool call initiated |
| `message.tool_result` | Tool result received |
| `status.idle` | Session is idle |
| `status.working` | Claude Code is processing |
| `status.permission` | Waiting for approval |
| `status.question` | Claude Code asked a question |
| `status.plan` | Plan mode active |
| `status.stall` | No activity for stall threshold |
| `status.dead` | Session unresponsive |
| `status.stopped` | Session manually stopped |
| `status.error` | Error state |
| `status.rate_limited` | Rate limit hit |
| `status.permission_timeout` | User didn't respond to prompt |
| `status.recovered` | Session recovered from stall/dead |
| `swarm.teammate_spawned` | Sub-agent spawned |
| `swarm.teammate_finished` | Sub-agent completed |

---

## Health & Monitoring

Check channel health at:

```
GET /v1/channels/health
```

Response:

```json
[
  {
    "channel": "telegram",
    "healthy": true,
    "lastSuccess": 1712650200000,
    "lastError": null,
    "pendingCount": 0
  },
  {
    "channel": "slack",
    "healthy": true,
    "lastSuccess": 1712650180000,
    "lastError": "ECONNREFUSED",
    "pendingCount": 0
  }
]
```

---

## Dead Letter Queue

Failed deliveries are queued (max 100 for webhooks/Slack, 50 for email). Retrieve via:

```
GET /v1/channels/health
```

Or via CLI:

```bash
ag channels dlq list
ag channels dlq retry <channel>
ag channels dlq clear <channel>
```
