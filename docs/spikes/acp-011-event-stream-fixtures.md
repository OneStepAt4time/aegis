# ACP-011 Event Stream Fixture Spike

Issue: [#2579](https://github.com/OneStepAt4time/aegis/issues/2579)

## Verdict

**Green for deterministic ACP-011 fixture coverage.** The ACP lifecycle probe now captures bidirectional JSON-RPC frames and derives a small normalized event sequence for the event shapes Aegis needs before the production `AcpBackend` exists.

This remains a spike harness. It does not implement the production runtime, durable event storage, approval decisions, dashboard rendering, or token/cost telemetry.

## Fixture format

Committed fixtures live under `src/__tests__/fixtures/acp-event-stream/`:

- `event-stream.raw.ndjson` — one ACP JSON-RPC frame per line, limited to deterministic agent-to-client event frames from the fake ACP agent.
- `event-stream.normalized.json` — the Aegis spike projection derived from the captured frames.

The raw fixture covers:

1. `session/update` with `agent_message_chunk` text content.
2. `session/update` with `agent_thought_chunk` thinking content.
3. `session/update` with `tool_call` metadata.
4. `session/request_permission` as an approval request capture.
5. `session/update` with `tool_call_update` result content.
6. An unknown `sessionUpdate` value, preserved as `type: "unknown"`.
7. The `session/prompt` response with `stopReason: "end_turn"`, normalized as `turn_complete`.

The normalized fixture intentionally keeps only stable, redacted fields needed by later golden tests: sequence, session ID, event type, text, message ID, tool call ID, title, kind, status, approval options, unknown ACP update type, and stop reason.

## Harness changes

- `src/acp-lifecycle-probe.ts` records every client-to-agent and agent-to-client JSON-RPC frame in `frames`.
- `src/acp-event-stream.ts` normalizes captured frames into spike events without using broad casts or `any`.
- `src/__tests__/fixtures/fake-acp-agent.mjs` can emit deterministic event streams and deliberate mid-stream stdout pollution.
- `src/__tests__/acp-lifecycle-probe.test.ts` verifies raw fixture stability, normalized fixture stability, and ACP-010's stdout purity constraint after streaming starts.

## Findings

- ACP SDK `0.21.0` models streamed assistant text as `agent_message_chunk` and thinking as `agent_thought_chunk`.
- Tool invocation starts with `tool_call`; progress and results arrive through `tool_call_update`.
- Approval is a client-handled JSON-RPC request, `session/request_permission`, tied to a `toolCall` and options. ACP-011 captures the request shape only. ACP-012 should decide response semantics, cancellation handling, and audit fields.
- End-of-turn is represented by the `session/prompt` response `stopReason`, not a `session/update` notification.
- Unknown update kinds should not desynchronize the transport. The spike preserves them as normalized `unknown` events while raw frames remain available for schema drift analysis.
- Non-JSON stdout remains fatal even after valid stream frames have started. Logs must stay on stderr.

## Limitations

- Fixtures are synthetic and deterministic. They are shaped from the ACP SDK schema and the existing fake child process, not from a live Claude prompt.
- The normalized event names are a spike contract for tests, not final public API names.
- Approval response handling belongs to ACP-012.
- Raw terminal parity belongs to ACP-013.
- Token and cost telemetry belong to ACP-015.

## Handoff to M2 golden event tests

M2 golden event tests should reuse these fixtures as seed cases, then add live-package captures for real Claude output once `AcpBackend` exists. The production tests should assert both layers:

1. Raw ACP frames remain parseable and isolated from stdout pollution.
2. Normalized Aegis events remain stable for REST, MCP, SSE, WebSocket, dashboard, audit, and replay consumers.

Golden tests should also add schema-drift fixtures when `@agentclientprotocol/sdk` or `@agentclientprotocol/claude-agent-acp` versions change.

## Validation evidence

Commands run in this worktree:

```text
npm test -- src/__tests__/acp-lifecycle-probe.test.ts
npx tsc --noEmit
npm run gate
```

Results:

- Targeted ACP lifecycle and event stream tests passed: 13 tests.
- TypeScript type-check passed.
- Full quality gate passed.
