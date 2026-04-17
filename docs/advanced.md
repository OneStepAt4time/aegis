# Advanced Features

Aegis provides orchestration primitives beyond basic session management. This guide covers the Memory Bridge, Model Router, Session Templates, Verification Protocol, and Diagnostics.

For OpenAI-compatible model routing via Claude Code (`ANTHROPIC_BASE_URL` + custom models), see [BYO LLM](./byo-llm.md).

> **Note:** These features are available in v0.3.0-alpha. APIs may change between releases.

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
