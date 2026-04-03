# Standalone Examples

These scripts demonstrate direct Aegis API usage from Node.js with no framework dependency.

## Prerequisites
- Aegis server running locally at `http://127.0.0.1:9100`
- Node.js 18+

## simple-agent.ts
Creates a session, waits for completion, and prints the last assistant message.

```bash
npx tsx examples/standalone/simple-agent.ts /path/to/repo "Implement a tiny change and summarize it"
```

## ci-runner.ts
Creates a session for CI-style execution, auto-approves prompts, and exits with code:
- `0` success
- `1` task completed but transcript suggests failure
- `2` session creation failure
- `3` timeout

```bash
npx tsx examples/standalone/ci-runner.ts /path/to/repo "Run tests and report result"
```
