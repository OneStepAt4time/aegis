# #308: SSE Robustness Fixes

**Date:** 2026-03-27
**Status:** Approved
**Scope:** 6 sub-problems (all server + client)

## Context

Issue #308 identifies 6 robustness and reliability issues in the SSE/event bus system under production load. All are medium severity. Files affected: `src/events.ts`, `src/server.ts`, `dashboard/src/api/client.ts`.

## Fix 1: emitEnded Emitter Cleanup Race

**Problem:** `emitEnded` marks the emitter as `ending`, then deletes it after a 1-second `setTimeout`. During that window, a new subscriber via `subscribe()` creates a fresh emitter (because `getEmitter` sees `ending: true` and replaces it). The stale `setTimeout` then deletes this fresh emitter, killing the new subscriber silently.

**Solution:** Before deleting in the `setTimeout`, verify the emitter is still the same instance that was marked `ending` and has zero listeners.

**Changes:**
- `src/events.ts:emitEnded` — Capture the emitter reference in the closure. In the timeout callback, check `this.emitters.get(sessionId) === emitter` before deleting.

## Fix 2: No Idle SSE Timeout

**Problem:** No server-side mechanism to detect zombie SSE connections (client stopped reading but TCP connection is still open). Connections persist until TCP timeout (minutes).

**Solution:** Track last successful write timestamp per SSE connection. On each heartbeat tick (30s), if the last write was >90s ago, destroy the connection. This piggybacks on the existing heartbeat interval.

**Changes:**
- `src/server.ts` — In both `/v1/events` and `/v1/sessions/:id/events` handlers, add a `lastWrite` timestamp. In the heartbeat interval, check if `Date.now() - lastWrite > 90_000` and if so, call `reply.raw.destroy()`.

## Fix 3: Duplicate Legacy SSE Route

**Problem:** `/sessions/:id/events` (no `/v1/` prefix) duplicates the canonical `/v1/sessions/:id/events` route. Unnecessary attack surface.

**Solution:** Delete the duplicate route. The `/v1/` prefix has been canonical for all routes.

**Changes:**
- `src/server.ts` — Remove the `app.get('/sessions/:id/events', ...)` handler.

## Fix 4: Last-Event-ID Support

**Problem:** When an SSE connection drops and the browser reconnects, events emitted during the gap are silently lost. The standard SSE `Last-Event-ID` feature is not implemented.

**Solution:**
- **Server:** Maintain a ring buffer of recent events per session (last 50 events). Assign an incrementing ID to each event. Write `id:` field in SSE wire format. On new connection with `Last-Event-ID` header, replay missed events from the buffer.
- **Client:** The browser's `EventSource` handles `Last-Event-ID` automatically. No client change needed beyond ensuring the server sends `id:` fields.

**Changes:**
- `src/events.ts` — Add a per-session ring buffer (`Map<string, { id: number; event: SessionSSEEvent }[]>`). On `emit()`, push to buffer and trim to 50. Add `getEventsSince(sessionId, lastId)` method.
- `src/server.ts` — In SSE handlers, read `Last-Event-ID` header. On subscribe, call `eventBus.getEventsSince()` and replay. Write `id: <eventId}\n` before `data:` lines.
- `src/events.ts:SessionSSEEvent` — Add `id?: number` field.

## Fix 5: Reconnection Circuit-Breaker

**Problem:** `EventSource` retries indefinitely when the server is permanently down. No backoff, no give-up, no user feedback.

**Solution:** Replace raw `EventSource` with a manual reconnect loop that implements:
- Consecutive failure counter
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
- Total give-up timeout: 5 minutes of continuous failure
- Reset on successful connection
- `onReconnecting(attempt, delay)` and `onGiveUp()` callbacks

**Changes:**
- `dashboard/src/api/client.ts` — Create a `ResilientEventSource` class (internal, not exported). Refactor `subscribeSSE` and `subscribeGlobalSSE` to use it. Add optional `callbacks` parameter to `subscribeSSE` (matching `subscribeGlobalSSE`'s existing pattern).

## Fix 6: Synchronous EventEmitter.emit()

**Problem:** `SessionEventBus.emit()` calls `emitter.emit('event', event)` synchronously. If an SSE write handler blocks (slow client, backpressure), the monitor loop stalls.

**Solution:** Wrap the `emitter.emit()` call in `setImmediate()` to decouple from the caller. The sub-millisecond scheduling cost is negligible compared to the 2-second monitor poll interval.

**Changes:**
- `src/events.ts:emit()` — Wrap both `emitter.emit('event', event)` and `this.globalEmitter?.emit('event', ...)` in `setImmediate()`.

## Testing

- Unit tests for ring buffer (getEventsSince, trim to 50)
- Unit test for emitEnded race condition (new subscriber during cleanup window)
- Unit test for setImmediate decoupling
- Unit tests for ResilientEventSource (backoff, give-up, reset on success)
- Existing SSE tests should continue passing
