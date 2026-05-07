# ACP-010 Child Process Lifecycle Spike

Issue: [#2578](https://github.com/OneStepAt4time/aegis/issues/2578)

## Verdict

**Green for ACP-010.** Aegis can run `@agentclientprotocol/claude-agent-acp` as an Aegis-controlled child process on Windows, exchange ACP JSON-RPC over stdio, create/resume/close sessions, initiate a real Claude API-backed prompt turn, cancel an in-flight prompt, and shut the child process down cleanly.

This is a lifecycle spike only. It does not implement `AcpBackend`, event normalization, approvals, raw terminal parity, token/cost accounting, or BYO LLM matrices.

## Package and CLI shape

Observed package metadata from npm:

- Package: `@agentclientprotocol/claude-agent-acp`
- Version tested: `0.32.0`
- Binary: `claude-agent-acp` -> `dist/index.js`
- Main export: `dist/lib.js`
- Runtime dependencies: `@agentclientprotocol/sdk`, `@anthropic-ai/claude-agent-sdk`, `zod`

The binary is an ACP stdio server by default. It does not behave like a traditional `--help` CLI; starting it without ACP input leaves it waiting for newline-delimited JSON-RPC on stdin. When invoked with `--cli`, it passes through to the underlying Claude CLI instead of starting ACP.

The package redirects `console.*` output to stderr before starting ACP so stdout remains reserved for protocol frames.

## Durable spike artifacts

- `src/acp-lifecycle-probe.ts` — reusable NDJSON JSON-RPC lifecycle harness.
- `scripts/acp-lifecycle-probe.mjs` — built-artifact runner for real package probes.
- `src/__tests__/acp-lifecycle-probe.test.ts` — deterministic lifecycle tests.
- `src/__tests__/fixtures/fake-acp-agent.mjs` — deterministic ACP child-process fixture.

The harness intentionally validates that stdout contains only ACP JSON-RPC messages. Any non-JSON stdout line is a protocol error.

## Operational contract for M2

### Binary resolution

Resolution order for Aegis should be:

1. Explicit command supplied by the caller or future config.
2. `AEGIS_ACP_BIN` override.
3. Local package binary from `node_modules/.bin/claude-agent-acp`.
4. Development fallback: `npm exec --yes --package=@agentclientprotocol/claude-agent-acp -- claude-agent-acp`.

For shipped Aegis, the package should become a dependency in the later dependency issue, so production should normally use the local package binary. The npm-exec fallback is useful for spikes and local diagnostics, not for production startup latency.

### Windows process behavior

On this Windows host, spawning `npm.cmd` directly with `child_process.spawn()` failed with `spawn EINVAL`. The probe wraps `.cmd` and `.bat` commands as:

```text
cmd.exe /d /s /c "<script>.cmd" <args>
```

This is required for `npm.cmd`, `node_modules\.bin\claude-agent-acp.cmd`, and `.cmd` values supplied through `AEGIS_ACP_BIN`. Native `.exe` commands do not need wrapping.

Windows paths with backslashes and spaces are preserved by quoting the command portion. Later implementation should keep shell execution disabled and use explicit argv construction as the probe does.

### Spawn environment

The child needs an environment close to the Aegis process environment:

- `PATH` so `node`, `npm`, Claude Code, and MCP server commands resolve.
- user home variables (`USERPROFILE` / `HOME`) for Claude credentials and settings.
- BYO LLM and Anthropic-compatible provider variables when operators configure them.
- `NO_COLOR=1` is safe and keeps diagnostics deterministic.

Do not log raw environment variables. Redact auth headers, API keys, tokens, and local settings values in probe output and Aegis diagnostics.

The package also loads Claude Code settings from the session cwd through its settings manager. This spike used the ACP worktree as `session/new.cwd`; it did not copy or print `D:\aegis\.claude\settings.local.json`.

### Transport framing

ACP stdio uses newline-delimited JSON-RPC, not LSP `Content-Length` framing.

Contract:

- client writes one JSON-RPC request or notification per line to stdin;
- agent writes one JSON-RPC response, request, or notification per line to stdout;
- neither side may write non-protocol text to stdout;
- agent logs may appear on stderr and must be captured separately with byte limits.

The probe treats malformed stdout as fatal because otherwise Aegis could desynchronize its protocol parser.

### Initialize and session handshake

Minimum startup sequence:

1. Spawn child process.
2. Send `initialize` with protocol version `1`, client capabilities, and client info.
3. Read `agentCapabilities`, `agentInfo`, and `authMethods`.
4. Send `session/new` with absolute `cwd` and `mcpServers`.
5. Store the returned `sessionId`.
6. Optionally call `session/resume` for an active session ID.
7. Send `session/prompt` turns.
8. On shutdown, call `session/close` when supported, close stdin, and wait for process exit.

Observed capabilities from version `0.32.0` include `loadSession`, prompt image/embedded-context support, HTTP/SSE MCP support, and session `fork`, `list`, `resume`, and `close` capabilities.

When `session/resume` is called, the response can contain session configuration state such as modes and model selectors. Treat those values as operational state and avoid logging them verbatim unless redacted.

### Client-side method handling

If Aegis advertises client capabilities such as terminal or filesystem access, it must implement the corresponding ACP client methods. For this spike, the real probes used minimal client capabilities, so the agent did not rely on terminal or filesystem callbacks.

Later M2 implementation needs a real client-side request dispatcher for at least:

- `session/request_permission`;
- `terminal/*` if terminal capability is advertised;
- `fs/*` if filesystem capability is advertised;
- extension notifications and requests that Aegis elects to support.

Unknown client requests should receive explicit JSON-RPC errors, not hang silently.

### Prompt, cancellation, and close

A real prompt turn completed successfully with `stopReason: "end_turn"`, proving a Claude API-backed call can be initiated from the child process.

A real cancellation probe sent `session/cancel` after the first agent message update and received `stopReason: "cancelled"`. This confirms the package maps cancellation to the underlying Claude Agent SDK interrupt path for an active prompt.

`session/close` completed successfully after create/resume/prompt flows. Closing stdin after `session/close` caused the package to exit with code `0`.

### Exit and error handling

Operational rules for M2:

- Treat child `error` events as startup failures and surface the OS error code.
- Treat JSON-RPC error responses as method failures with method name, id, and redacted error data.
- Treat unmatched response ids as protocol errors.
- On shutdown, call `session/close` when possible, close stdin, and wait for exit.
- If the child does not exit after stdin closes, send `SIGTERM`; if still alive after a short grace period, send `SIGKILL`.
- Capture stderr separately and bound memory usage.

The current package exits cleanly when the ACP connection closes and also disposes sessions on `SIGTERM` / `SIGINT`.

### Timeout and backoff needs

Recommended initial values for M2:

- spawn/initialize timeout: 15-30 seconds;
- `session/new` and `session/resume`: 30 seconds;
- `session/prompt`: caller-configurable, defaulting to a larger turn timeout;
- shutdown grace after stdin close: about 2 seconds before termination;
- restart backoff: exponential with jitter, capped, and reset after a stable run.

Do not silently retry protocol errors. Restart only after classifying the child as crashed, hung, or intentionally stopped.

## Validation evidence

Commands run in this worktree:

```text
npm test -- src/__tests__/process-utils.test.ts
npm test -- src/__tests__/acp-lifecycle-probe.test.ts
npx tsc --noEmit
npm run build
node scripts/acp-lifecycle-probe.mjs --no-prompt --session-cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --timeout-ms 30000
node scripts/acp-lifecycle-probe.mjs --prompt "Reply with exactly: AEGIS_ACP_PROBE_OK" --session-cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --timeout-ms 120000
node scripts/acp-lifecycle-probe.mjs --prompt "Count from 1 to 100, one number per line." --cancel-after-first-update --session-cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --timeout-ms 120000
node scripts/acp-lifecycle-probe.mjs --no-prompt --resume --session-cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --cwd D:\aegis\.claude\worktrees\2578-acp-child-process-lifecycle --timeout-ms 30000
```

Results:

- deterministic fixture tests passed;
- TypeScript type-check passed;
- build passed;
- real package initialize/new/close passed with exit code `0`;
- real prompt passed with `stopReason: "end_turn"`;
- real cancellation passed with `stopReason: "cancelled"`;
- real resume passed and returned session configuration state;
- stderr byte count was `0` in the real successful probes.

## Follow-up work unblocked

- ACP-011 can use the harness to capture event stream fixtures.
- ACP-012 can add explicit `session/request_permission` request/response handling.
- ACP-013 can advertise and implement terminal client methods for raw terminal parity.
- ACP-014 can run the same lifecycle probe with BYO LLM environment matrices.
- ACP-040 should add the package as an Aegis dependency and remove production reliance on npm-exec fallback.
