# Standalone Examples

Minimal, self-contained examples that use the Aegis REST API directly (no SDK required). Each file is a ready-to-run script.

## Quick Start

```bash
# Set your Aegis server URL (optional — defaults to localhost:9100)
export AEGIS_BASE_URL=http://127.0.0.1:9100

# Set auth token if your Aegis instance requires one
export AEGIS_AUTH_TOKEN=your-token-here
```

## Examples

### `simple-agent.ts`

The minimal Aegis client — create a session, send a prompt, wait for completion, print the result. Under 50 lines.

```bash
npx tsx examples/standalone/simple-agent.ts /path/to/project "Say hello from Aegis"
```

### `ci-runner.ts`

CI-oriented session runner that executes a task and returns an exit code (0 = success, 1 = failure detected, 2 = create failed, 3 = timeout). Auto-approves permission prompts.

```bash
npx tsx examples/standalone/ci-runner.ts /path/to/project "Run tests and report pass/fail summary."
```

### `multi-session-pipeline.ts`

Creates multiple sessions in parallel, polls them all to completion, and displays collected results. Demonstrates batch workflow orchestration.

```bash
npx tsx examples/standalone/multi-session-pipeline.ts /path/to/project
```

Tasks are configurable — edit the `tasks` array in the file to change what each parallel session does.

### `python-client.py`

A Python equivalent of `simple-agent.ts` using the `requests` library. Shows session creation, polling, permission prompt handling, and transcript extraction.

```bash
pip install requests
python examples/standalone/python-client.py /path/to/project
python examples/standalone/python-client.py /path/to/project "What framework does this project use?" --verbose
```

### `webhook-listener.ts`

A minimal HTTP server that receives Aegis webhook events and logs session state transitions with human-readable output. Includes optional HMAC signature verification.

```bash
npx tsx examples/standalone/webhook-listener.ts
# Or on a custom port:
WEBHOOK_PORT=8080 npx tsx examples/standalone/webhook-listener.ts

# With HMAC verification:
WEBHOOK_SECRET=my-secret npx tsx examples/standalone/webhook-listener.ts
```

Test it with curl:

```bash
curl -X POST http://localhost:4567/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"session.idle","sessionId":"test-123","timestamp":"2026-04-27T12:00:00Z","data":{"duration":"45s"}}'
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AEGIS_BASE_URL` | `http://127.0.0.1:9100` | Aegis server URL |
| `AEGIS_AUTH_TOKEN` | *(none)* | Bearer token for authentication |
| `WEBHOOK_PORT` | `4567` | Port for the webhook listener |
| `WEBHOOK_SECRET` | *(none)* | HMAC secret for webhook verification |

## Notes

- All examples use the REST API directly — no Aegis SDK needed.
- TypeScript examples use `npx tsx` to run without a build step.
- The Python example requires `requests` (`pip install requests`).
- All examples handle errors gracefully and exit with appropriate codes.
