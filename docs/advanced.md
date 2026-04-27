# Advanced Features

Aegis provides orchestration primitives beyond basic session management. This guide covers the Memory Bridge, Model Router, Session Templates, Verification Protocol, and Diagnostics.

For OpenAI-compatible model routing via Claude Code (`ANTHROPIC_BASE_URL` + custom models), see [BYO LLM](./byo-llm.md).

> **Note:** These features are available in v0.3.0-preview. APIs may change between releases.

---

## Memory Bridge

The Memory Bridge is a cross-session key/value store. It lets you share context between parallel agents without re-prompting or writing shared files.

### Enable

Add to `aegis.config.json`:

```json
{
  "memoryBridge": {
    "enabled": true,
    "persistPath": "./memory.json",
    "reaperIntervalMs": 3600000
  }
}
```

- `persistPath` — file path for persistence (default: `<stateDir>/memory.json`)
- `reaperIntervalMs` — how often expired entries are cleaned up (default: 1 hour)

### API

#### Write a memory entry

```bash
curl -X POST http://localhost:9100/v1/memory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "key": "project/analysis-result",
    "value": "The auth module uses JWT with RS256 signing. Key rotation is handled in src/auth.ts.",
    "ttlSeconds": 86400
  }'
```

- `key` — string, max 256 characters. Use a `namespace/name` format for organization.
- `value` — string, max 100 KB.
- `ttlSeconds` — optional. Entry expires after this many seconds (max 30 days). Without TTL, entries persist until deleted.

#### Read a memory entry

```bash
curl http://localhost:9100/v1/memory/project/analysis-result \
  -H "Authorization: Bearer <token>"
```

#### List entries

```bash
# All entries
curl http://localhost:9100/v1/memory \
  -H "Authorization: Bearer <token>"

# Filtered by prefix
curl "http://localhost:9100/v1/memory?prefix=project/" \
  -H "Authorization: Bearer <token>"
```

#### Delete a memory entry

```bash
curl -X DELETE http://localhost:9100/v1/memory/project/analysis-result \
  -H "Authorization: Bearer <token>"
```

#### Scoped memory

List entries by scope:

```bash
curl "http://localhost:9100/v1/memories?scope=project" \
  -H "Authorization: Bearer <token>"
```

Valid scopes: `project`, `user`, `team`. This is a prefix filter — entries must be stored with the scope as a prefix (e.g., `project/my-key`).

#### Session-linked memory

Attach memory to a specific session:

```bash
curl -X POST http://localhost:9100/v1/sessions/<session-id>/memories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"key": "decision", "value": "Use PostgreSQL, not MongoDB"}'
```

### Inject memory into a session prompt

Use the `memoryKeys` field when creating a session. Aegis resolves the keys and prepends their values to the prompt:

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "workDir": "/home/user/project",
    "prompt": "Now implement the auth module based on the analysis.",
    "memoryKeys": ["project/analysis-result", "project/stack-decision"]
  }'
```

Aegis injects the resolved values before sending the prompt:

```
[Memory context]
project/analysis-result: The auth module uses JWT with RS256 signing...
project/stack-decision: Use PostgreSQL, not MongoDB

Now implement the auth module based on the analysis.
```

### Example: two parallel agents sharing results

```bash
# Agent 1: analyze the codebase and store findings
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "workDir": "/home/user/project",
    "prompt": "Analyze the authentication module. Identify security risks and list them."
  }'

# Store the results (after Agent 1 finishes)
curl -X POST http://localhost:9100/v1/memory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "key": "auth/audit-results",
    "value": "3 risks found: missing rate limiting, no key rotation, token not validated on refresh"
  }'

# Agent 2: fix the issues, using context from Agent 1
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "workDir": "/home/user/project",
    "prompt": "Fix the security risks identified in the audit.",
    "memoryKeys": ["auth/audit-results"]
  }'
```

---

## Session Templates

Session Templates let you save and reuse session configurations. Instead of repeating the same parameters for recurring tasks, create a template and reference it.

### API

#### Create a template

```bash
curl -X POST http://localhost:9100/v1/templates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Code Review",
    "description": "Standard code review session with bypass permissions",
    "workDir": "/home/user/project",
    "prompt": "Review the latest changes in this repository. Focus on correctness, security, and performance.",
    "claudeCommand": "claude --print",
    "permissionMode": "bypassPermissions",
    "stallThresholdMs": 300000,
    "memoryKeys": ["review/checklist"]
  }'
```

Or create from an existing session:

```bash
curl -X POST http://localhost:9100/v1/templates \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "My Session Template",
    "sessionId": "<existing-session-id>"
  }'
```

When `sessionId` is provided, `workDir`, `stallThresholdMs`, and `permissionMode` are copied from the session.

#### List all templates

```bash
curl http://localhost:9100/v1/templates \
  -H "Authorization: Bearer <token>"
```

#### Get a specific template

```bash
curl http://localhost:9100/v1/templates/<template-id> \
  -H "Authorization: Bearer <token>"
```

#### Update a template

```bash
curl -X PUT http://localhost:9100/v1/templates/<template-id> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "prompt": "Updated prompt for the review session"
  }'
```

#### Delete a template

```bash
curl -X DELETE http://localhost:9100/v1/templates/<template-id> \
  -H "Authorization: Bearer <token>"
```

### Template fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Template name |
| `description` | string | no | Human-readable description |
| `workDir` | string | yes* | Working directory for the session |
| `prompt` | string | no | Initial prompt to send |
| `claudeCommand` | string | no | Claude CLI command (default: `claude`) |
| `env` | object | no | Environment variables for the session |
| `stallThresholdMs` | number | no | Stall detection threshold in ms |
| `permissionMode` | string | no | `default`, `bypassPermissions`, `plan` |
| `autoApprove` | boolean | no | Auto-approve permission requests |
| `memoryKeys` | string[] | no | Memory keys to inject into prompt |
| `sessionId` | string | no | Copy config from existing session (*provides `workDir`) |

---

## Verification Protocol

The Verification Protocol runs `tsc`, `build`, and `test` after a session completes. It acts as an automated quality gate for agent output.

### Enable

Add to `aegis.config.json`:

```json
{
  "verificationProtocol": {
    "autoVerifyOnStop": true,
    "criticalOnly": false
  }
}
```

- `autoVerifyOnStop` — run verification automatically when a session stops (default: `false`)
- `criticalOnly` — run only `tsc` and `build`, skip tests (default: `false`)

### What it runs

When triggered, the protocol executes three steps in the session's `workDir`:

1. **`npx tsc --noEmit`** — type check
2. **`npm run build`** — build
3. **`npm test`** — test suite (skipped if `criticalOnly: true`)

Each step has a 120-second timeout (tests: 180 seconds).

### SSE event

Results are emitted as an SSE event:

```
event: verification
data: {"ok": true, "steps": [...], "totalDurationMs": 15234, "summary": "Verification passed: tsc ✅, build ✅, test ✅ (15234ms)"}
```

### Requirements

- The session's `workDir` must contain a `package.json`
- `tsc`, `npm run build`, and `npm test` must be available in the environment
- If no `package.json` exists, verification returns `ok: false` with a summary message

---


## Pipeline Orchestration

Run multi-step workflows where each step's output feeds into the next step's prompt.

### Create a Pipeline

\`\`\`bash
curl -X POST http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "code-review-pipeline",
    "workDir": "/home/user/project",
    "steps": [
      { "name": "lint", "prompt": "Run eslint and report issues" },
      { "name": "review", "prompt": "Review the code changes from the lint step" },
      { "name": "fix", "prompt": "Apply fixes for all lint issues" }
    ]
  }'
\`\`\`

Returns a pipeline object with \`id\` and initial \`status: running\`.

### Monitor a Pipeline

\`\`\`bash
curl http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
\`\`\`

### Pipeline Stages

| Stage | Description |
|-------|-------------|
| \`plan\` | Claude Code plans the approach |
| \`execute\` | Claude Code runs the step |
| \`verify\` | Aegis verifies output quality |
| \`fix\` | Claude Code applies corrections |
| \`submit\` | Changes are committed |
| \`done\` | Pipeline complete |

### Use Cases

- Multi-step code reviews (lint → review → fix)
- PR workflows (understand → implement → test → document)

---

## API Key Rotation with Grace Period

Aegis supports **zero-downtime key rotation**: when a key is rotated, the old key remains valid for a configurable grace period, allowing in-flight requests to complete while new requests use the rotated key.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `AEGIS_KEY_ROTATION_GRACE_SECONDS` | `60` | How long the old key stays valid after rotation |

### How It Works

1. Call `POST /v1/auth/keys/rotate` with the new key details and grace period
2. The old key enters a **grace window** — both old and new keys are accepted
3. During the grace window, clients should switch to the new key
4. After the grace window expires, only the new key is accepted

### Using the SDK

```ts
import { rotateKey } from '@onestepat4time/aegis';

const result = await rotateKey({
  keyId: 'key-abc123',
  graceSeconds: 120,
  ttlDays: 365,
});

console.log(result.newKey); // the newly rotated key
console.log(result.expiresAt); // expiration timestamp
```

### REST API

```bash
# Rotate with grace period (zero-downtime)
curl -X POST http://localhost:9100/v1/auth/keys/rotate \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keyId": "key-abc123", "graceSeconds": 120, "ttlDays": 365}'
```

**Response:**
```json
{
  "keyId": "key-abc123",
  "key": "ak-new-...",
  "expiresAt": "2027-04-23T12:00:00.000Z",
  "graceEndsAt": "2026-04-23T12:02:00.000Z"
}
```

The old key is accepted until `graceEndsAt`. After that, only the new key works.

---

## Per-Tenant Quotas

Aegis supports per-API-key quotas for **sessions**, **tokens**, and **USD spend**. Quotas are enforced server-side and return clear 429 responses when exceeded.

### Setting Quotas

```bash
curl -X PUT http://localhost:9100/v1/auth/keys/key-abc123/quotas \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxSessions": 10,
    "maxTokens": 1000000,
    "maxSpendUsd": 50.00
  }'
```

**Response:**
```json
{
  "keyId": "key-abc123",
  "quotas": {
    "maxSessions": 10,
    "maxTokens": 1000000,
    "maxSpendUsd": 50.00
  },
  "usage": {
    "sessions": 3,
    "tokens": 245000,
    "spendUsd": 12.50
  }
}
```

### Reading Quotas and Usage

```bash
curl http://localhost:9100/v1/auth/keys/key-abc123/quotas \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns the configured quotas and current usage for the key. Use this to build usage dashboards or alert when keys approach their limits.

### Quota Enforcement

| Condition | Response |
|---|---|
| Session limit exceeded | `429 Too Many Requests` with `X-Quota-Exceeded: sessions` |
| Token limit exceeded | `429 Too Many Requests` with `X-Quota-Exceeded: tokens` |
| Spend limit exceeded | `429 Too Many Requests` with `X-Quota-Exceeded: spend` |

---

## Metering & Billing Hooks

Aegis tracks per-session and per-key usage and exposes it via metering endpoints. Integrate with your billing system using these hooks.

### Usage Summary (all keys)

```bash
curl http://localhost:9100/v1/metering/usage \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

**Response:**
```json
{
  "period": {
    "start": "2026-04-01T00:00:00.000Z",
    "end": "2026-04-30T23:59:59.999Z"
  },
  "summary": {
    "totalSessions": 482,
    "totalTokens": 12400000,
    "totalSpendUsd": 248.50
  },
  "rateTiers": [
    {"tier": "free", "tokensIncluded": 100000, "pricePerMillionTokens": 0}
  ]
}
```

### Per-Key Usage

```bash
curl "http://localhost:9100/v1/metering/keys/key-abc123/usage" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns token count and USD spend for a specific API key.

### Per-Session Usage

```bash
curl "http://localhost:9100/v1/metering/sessions/sess-xyz/usage" \
  -H "Authorization: Bearer $AEGIS_AUTH_TOKEN"
```

Returns token usage and cost for a single session.

---

## Webhook Signature Verification

Aegis provides a TypeScript SDK to verify incoming webhook signatures. This ensures webhook payloads are authentic and haven't been tampered with.

### Installation

The SDK is included in the `@onestepat4time/aegis` package:

```bash
npm install @onestepat4time/aegis
```

### Usage

```ts
import { verifySignature } from '@onestepat4time/aegis/webhook';

const result = verifySignature(rawBody, sigHeader, 'your-webhook-secret');

if (!result.valid) {
  console.error('Signature invalid:', result.reason);
  return; // reject the request
}

// Signature is valid — process the webhook
```

### Manual Verification (without SDK)

If you're not using TypeScript, verify the signature manually:

1. Extract the `X-Aegis-Signature` header
2. Compute `HMAC-SHA256(payload, secret)`
3. Compare the computed signature with the header value using a constant-time comparison

```bash
# Example: verify in a Node.js script
node -e "
const crypto = require('crypto');
const body = require('fs').readFileSync('payload.json');
const secret = 'your-webhook-secret';
const expected = process.env['X_AEGIS_SIGNATURE'];
const computed = crypto
  .createHmac('sha256', secret)
  .update(body)
  .digest('hex');
console.log(computed === expected ? 'VALID' : 'INVALID');
"
```

### Signature Header Format

```
X-Aegis-Signature: sha256=<hex-encoded-hmac>
```

---


## Diagnostics

Aegis exposes a bounded diagnostics endpoint for debugging the server itself. This endpoint returns internal events (no user prompts or session content — PII-free).

### API

```bash
curl "http://localhost:9100/v1/diagnostics?limit=20" \
  -H "Authorization: Bearer <token>"
```

Response:

```json
{
  "count": 20,
  "events": [
    {
      "type": "session.created",
      "timestamp": "2026-04-05T15:30:00.000Z",
      "detail": "Session created: session-abc"
    }
  ]
}
```

- `limit` — optional query parameter, max events to return (default: 50)

### Use cases

- Debugging why a session isn't appearing in the dashboard
- Verifying that webhook deliveries succeeded
- Monitoring internal server events during development

> **Note:** Diagnostics events are kept in a bounded in-memory buffer. Old events are automatically evicted. This endpoint is for live debugging, not historical analysis.
