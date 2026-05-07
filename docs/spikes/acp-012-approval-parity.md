# ACP-012 Approval Request/Response Parity Spike

Issue: [#2580](https://github.com/OneStepAt4time/aegis/issues/2580)

## Verdict

**Green for ACP-012.** The ACP lifecycle probe can now receive
`session/request_permission` JSON-RPC requests from an ACP child process, surface
them as structured approval data, and send explicit allow, deny, or cancelled
JSON-RPC responses without terminal keypress emulation.

This is a spike harness and approval contract artifact. It does not implement
the production `AcpBackend`, REST approval endpoints, or the M2 action queue
worker.

## Durable spike artifacts

- `src/acp-lifecycle-probe.ts` — reusable NDJSON JSON-RPC probe with
  `session/request_permission` handling, structured approval capture, explicit
  approval decisions, and pending-request cleanup.
- `src/__tests__/fixtures/fake-acp-agent.mjs` — deterministic fake ACP child
  process that can request approval, observe allow/deny/cancel responses, emit
  malformed approval requests, and exit while approval is pending.
- `src/__tests__/fixtures/acp-approval-request.json` — deterministic approval
  fixture suitable for future golden tests.
- `src/__tests__/acp-lifecycle-probe.test.ts` — parity coverage for approval
  surfacing, allow/deny responses, cancellation, child exit, timeout, malformed
  approval protocol errors, and redaction/bounding.

## Observed approval contract

The ACP child sends a client request:

```json
{
  "jsonrpc": "2.0",
  "id": "permission-1",
  "method": "session/request_permission",
  "params": {
    "sessionId": "fixture-session",
    "toolCall": {
      "toolCallId": "tool-call-approval-1",
      "title": "Run shell command",
      "kind": "execute",
      "status": "pending",
      "rawInput": {}
    },
    "options": [
      { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
      { "optionId": "reject-once", "name": "Deny", "kind": "reject_once" }
    ]
  }
}
```

Aegis must answer the same JSON-RPC id. Selecting an option returns:

```json
{
  "jsonrpc": "2.0",
  "id": "permission-1",
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

Cancelling approval returns:

```json
{
  "jsonrpc": "2.0",
  "id": "permission-1",
  "result": {
    "outcome": {
      "outcome": "cancelled"
    }
  }
}
```

The probe validates permission option shape and rejects unsupported option
kinds as ACP protocol errors. Unknown client requests still receive explicit
JSON-RPC errors rather than hanging silently.

## Security considerations

Approval requests can contain sensitive command, environment, header, or file
path details in `toolCall.rawInput`, `rawOutput`, `locations`, or content.
The spike therefore treats surfaced approval data as operator-facing diagnostic
data and applies conservative controls:

- secret-like field names such as `authorization`, `cookie`, `apiKey`, `token`,
  `secret`, `password`, and `credential` are replaced with `[REDACTED]`;
- local `settings.local.json` paths are replaced with `[REDACTED_PATH]`;
- surfaced strings are bounded to 2 KiB, arrays to 25 items, and objects to 50
  keys before they are stored in the probe result;
- stderr remains separately bounded by the ACP-010 64 KiB limit;
- raw environment variables are not printed by the probe or fixture.

The production backend should preserve these redaction and bounding rules before
persisting approval events, returning pending approval API responses, emitting
SSE/WebSocket updates, or writing logs.

## Pending request safety

The probe now tracks inbound approval requests separately from outbound
client-to-agent requests. Pending approval requests are not left dangling:

- prompt cancellation can respond with an ACP `cancelled` approval outcome and
  send `session/cancel`;
- child exit marks pending approvals as rejected with `child_exit` and includes
  those rejected approvals in the surfaced protocol error;
- request timeout marks pending approvals as rejected with `request_timeout` and
  sends a best-effort JSON-RPC error to the child;
- transport disposal marks pending approvals as rejected with
  `transport_disposed`.

These states are intentionally explicit because the M2 worker must be able to
resolve a pending approval exactly once and make terminal states visible to API
clients.

## Limitations

- The spike uses a deterministic fake ACP child. It does not prove every
  production `@agentclientprotocol/claude-agent-acp` approval option shape.
- The probe supports one immediate approval decision policy per run. It is not a
  multi-user approval queue.
- Redaction is intentionally conservative and may hide benign fields with
  sensitive names. That is acceptable for the spike and safer than leaking
  credentials.
- The spike does not persist approval state, expose HTTP endpoints, emit public
  events, or map ACP approvals to the existing tmux-backed permission API.

## Handoff requirements for M2

M2 action queue worker and approval endpoints should:

1. register a first-class client request dispatcher for
   `session/request_permission`;
2. normalize approval requests into a stored `pending` record with
   `sessionId`, JSON-RPC request id, sanitized `toolCall`, available options,
   and creation time;
3. expose pending approvals through the existing Aegis approval surfaces without
   terminal keypress emulation;
4. accept explicit allow, deny, and cancel decisions, map them to ACP
   `selected` or `cancelled` outcomes, and write exactly one JSON-RPC response;
5. mark pending approvals rejected on child exit, prompt timeout, session
   cancellation, and backend disposal;
6. apply redaction and bounding before logging, persistence, REST responses, and
   realtime event emission;
7. keep malformed ACP approval requests as protocol errors with structured
   method/id/details so operators can diagnose incompatible agents.

## Validation evidence

Commands run in this worktree:

```text
npm test -- src/__tests__/acp-lifecycle-probe.test.ts
npx tsc --noEmit
npm run gate
```

Results:

- targeted ACP lifecycle probe fixture suite passed;
- TypeScript type-check passed;
- full repository gate passed.
