# ADR-0021: SSE Idle Timeout and HTTP Drain on Shutdown

## Status
Proposed

## Context

Aegis currently has two resource-leak / abrupt-shutdown footguns in the HTTP layer:

1. **SSE has no idle timeout.** `/v1/events/subscribe` keeps a long-lived response open. If a client connects but stops reading, the socket sits in the kernel send buffer until TCP keep-alive reaps it (often >2h). Under load this leaks file descriptors and memory from the per-session event buffer.
2. **No graceful HTTP drain on SIGTERM/SIGINT.** [src/signal-cleanup-helper.ts](../../src/signal-cleanup-helper.ts) kills tmux sessions, but Fastify sockets are closed hard. In-flight `POST /v1/sessions/:id/approve` requests can be aborted mid-response, leaving the caller unable to tell whether the approval was delivered. Hook-delivery channels are also not drained.

Referenced as **P0-7** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).

## Decision

Introduce three coordinated timeouts and a drain sequence.

### 1. SSE idle timeout

- Track per-connection last-write time in [src/sse-writer.ts](../../src/sse-writer.ts).
- If no event is sent for `AEGIS_SSE_IDLE_MS` (default 120 000), emit a heartbeat comment `:ping\n\n`.
- If the client does not consume the heartbeat within `AEGIS_SSE_CLIENT_TIMEOUT_MS` (default 300 000 — detected via `socket.writableEnded` / backpressure), close the response and decrement the per-key SSE counter.

### 2. Hook-delivery timeout

- All outgoing hook/webhook HTTP calls run with an `AbortSignal.timeout(AEGIS_HOOK_TIMEOUT_MS)` wrapper (default 10 000).
- On timeout, push to the existing DLQ rather than blocking the monitor loop.

### 3. HTTP drain on shutdown

Shutdown sequence on SIGTERM/SIGINT becomes:

1. Flip health endpoint to `draining`.
2. Call `app.close()` — stops accepting new connections, waits up to `AEGIS_SHUTDOWN_GRACE_MS` (default 15 000) for in-flight requests.
3. Abort remaining SSE streams with a final `event: shutdown` frame.
4. `killAllSessions()` (existing behaviour).
5. Wait for audit/log flush with a hard cap (`AEGIS_SHUTDOWN_HARD_MS`, default 20 000) then `process.exit(0)`.

### Config

All three timeouts live in [src/config.ts](../../src/config.ts) under the `AEGIS_*` namespace, documented in [docs/deployment.md](../deployment.md).

## Consequences

- **Pros:** bounded resource usage; predictable shutdown for rolling deployments (required for Kubernetes P1-9); eliminates the class of "approval sent but never confirmed" bugs during restarts.
- **Cons:** clients that rely on the current "infinite" SSE behaviour must accept periodic heartbeats and handle `event: shutdown`; documented in the SSE section of the API reference.
- **Testing:** extends existing `sse-limiter` / `resilient-eventsource` suites with idle-timeout, drain-during-request, and hook-timeout cases.

## Related

- Gap analysis: P0-7 in [00-gap-analysis.md](../enterprise/00-gap-analysis.md)
- Issues #308, #640 (resilient reconnection), #297 (SSE token lifecycle)
- Companion ADRs: [ADR-0019](0019-session-ownership-authz.md), [ADR-0022](0022-sigstore-attestations.md)
