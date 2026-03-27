# #308: SSE Robustness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 SSE/event bus robustness issues — cleanup races, zombie connections, duplicate routes, event replay, circuit breaker, and sync emit blocking.

**Architecture:** Server-side fixes in `events.ts` (ring buffer, setImmediate emit, cleanup guard) and `server.ts` (idle timeout, route removal, Last-Event-ID replay). Client-side fixes in `dashboard/src/api/client.ts` (ResilientEventSource with backoff).

**Tech Stack:** Node.js EventEmitter, Fastify SSE handlers, browser EventSource API, Vitest

---

### Task 1: Fix emitEnded Emitter Cleanup Race

**Files:**
- Modify: `src/events.ts:141-157`
- Test: `src/__tests__/sse-events.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `describe('SessionEventBus')` block in `src/__tests__/sse-events.test.ts`:

```typescript
it('should not delete a fresh emitter created during cleanup window', async () => {
  const events1: SessionSSEEvent[] = [];
  const unsub1 = bus.subscribe('sess-1', (e) => events1.push(e));

  // Emit ended — marks emitter as ending, schedules delete in 1s
  bus.emitEnded('sess-1', 'completed');
  unsub1();

  // During the 1s window, a new subscriber should get a fresh emitter
  const events2: SessionSSEEvent[] = [];
  const unsub2 = bus.subscribe('sess-1', (e) => events2.push(e));

  bus.emitStatus('sess-1', 'working', 'new work');

  expect(events2).toHaveLength(1);
  expect(events2[0].data.status).toBe('working');

  unsub2();

  // Wait for the original setTimeout to fire
  await new Promise(r => setTimeout(r, 1200));

  // New emitter should NOT have been deleted — another emit should work
  const events3: SessionSSEEvent[] = [];
  const unsub3 = bus.subscribe('sess-1', (e) => events3.push(e));
  bus.emitStatus('sess-1', 'idle', 'done');
  expect(events3).toHaveLength(1);
  unsub3();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "should not delete a fresh emitter"`
Expected: FAIL — the setTimeout deletes the fresh emitter after 1s

- [ ] **Step 3: Fix emitEnded to capture emitter reference and guard deletion**

In `src/events.ts`, replace the `emitEnded` method body (lines 141-157):

```typescript
  /** Emit a session ended event. */
  emitEnded(sessionId: string, reason: string): void {
    this.emit(sessionId, {
      event: 'ended',
      sessionId,
      timestamp: new Date().toISOString(),
      data: { reason },
    });
    // #224: Mark emitter as ending so new subscribers don't get silently deleted
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      (emitter as any).ending = true;
    }
    // Clean up after a short delay (let clients receive the event)
    // Capture reference — only delete if it's still the same emitter (no new one was created)
    setTimeout(() => {
      if (this.emitters.get(sessionId) === emitter) {
        this.emitters.delete(sessionId);
      }
    }, 1000);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -t "should not delete a fresh emitter"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/events.ts src/__tests__/sse-events.test.ts
git commit -m "fix: guard emitEnded cleanup against fresh emitter race (#308)"
```

---

### Task 2: Async Emit with setImmediate

**Files:**
- Modify: `src/events.ts:87-98`
- Test: `src/__tests__/sse-events.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `describe('SessionEventBus')` block:

```typescript
it('should emit events asynchronously via setImmediate', (done) => {
  const events: SessionSSEEvent[] = [];
  bus.subscribe('sess-1', (e) => events.push(e));

  bus.emitStatus('sess-1', 'working', 'test');

  // Events should NOT be delivered synchronously
  expect(events).toHaveLength(0);

  // But should be delivered after setImmediate microtask
  setImmediate(() => {
    expect(events).toHaveLength(1);
    expect(events[0].data.status).toBe('working');
    done();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -t "should emit events asynchronously"`
Expected: FAIL — events are delivered synchronously today

- [ ] **Step 3: Wrap emitter.emit calls in setImmediate**

In `src/events.ts`, replace the `emit` method (lines 87-98):

```typescript
  /** Emit an event to all subscribers for a session (and global subscribers). */
  emit(sessionId: string, event: SessionSSEEvent): void {
    // Issue #87: Stamp emittedAt for latency measurement
    event.emittedAt = Date.now();
    const emitter = this.emitters.get(sessionId);
    if (emitter) {
      setImmediate(() => emitter.emit('event', event));
    }
    // Forward to global subscribers
    if (this.globalEmitter) {
      setImmediate(() => this.globalEmitter!.emit('event', toGlobalEvent(event)));
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run -t "should emit events asynchronously"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

Note: Existing tests that call `emitStatus`/`emitMessage` etc. and immediately assert will need a `setImmediate` wrapper. Check for failures and wrap assertions in `await new Promise(r => setImmediate(r))` where needed.

- [ ] **Step 6: Fix any broken existing tests**

For any existing tests that now fail because emit is async, wrap the assertion in a helper. Add at the top of the test file:

```typescript
/** Flush all pending setImmediate callbacks. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
```

Then in any test that emits and immediately asserts, add `await flushAsync()` between emit and assert. Search for patterns like `bus.emit*(...)` followed by `expect(...)` in the same synchronous block.

- [ ] **Step 7: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/events.ts src/__tests__/sse-events.test.ts
git commit -m "fix: decouple SSE emit from caller via setImmediate (#308)"
```

---

### Task 3: Event Ring Buffer for Last-Event-ID

**Files:**
- Modify: `src/events.ts`
- Test: `src/__tests__/sse-events.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('Event Ring Buffer')` block:

```typescript
describe('Event Ring Buffer', () => {
  it('should store events in a ring buffer and return events after a given ID', async () => {
    // Emit 10 events
    for (let i = 0; i < 10; i++) {
      bus.emitStatus('sess-1', 'working', `event ${i}`);
    }
    await flushAsync();

    // Request events after ID 5
    const missed = bus.getEventsSince('sess-1', 5);
    // Should get events with IDs 6, 7, 8, 9, 10
    expect(missed).toHaveLength(5);
    expect(missed[0].id).toBe(6);
    expect(missed[4].id).toBe(10);
  });

  it('should trim ring buffer to 50 events', async () => {
    for (let i = 0; i < 60; i++) {
      bus.emitStatus('sess-1', 'working', `event ${i}`);
    }
    await flushAsync();

    // Should only have last 50 events (IDs 11-60)
    const missed = bus.getEventsSince('sess-1', 0);
    expect(missed).toHaveLength(50);
    expect(missed[0].id).toBe(11);
    expect(missed[49].id).toBe(60);
  });

  it('should return empty array for unknown session', () => {
    expect(bus.getEventsSince('unknown', 0)).toEqual([]);
  });

  it('should assign incrementing IDs across all sessions', async () => {
    bus.emitStatus('sess-1', 'working', 'a');
    bus.emitStatus('sess-2', 'working', 'b');
    bus.emitStatus('sess-1', 'idle', 'c');
    await flushAsync();

    const s1 = bus.getEventsSince('sess-1', 0);
    expect(s1).toHaveLength(2);
    expect(s1[0].id).toBe(1);
    expect(s1[1].id).toBe(3);

    const s2 = bus.getEventsSince('sess-2', 0);
    expect(s2).toHaveLength(1);
    expect(s2[0].id).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run -t "Event Ring Buffer"`
Expected: FAIL — `getEventsSince` method doesn't exist

- [ ] **Step 3: Implement ring buffer**

In `src/events.ts`, add a global counter and per-session ring buffer to the class, and the `getEventsSince` method. Modify the `emit` method to push to the buffer.

Add class fields after `private emitters = new Map<string, EventEmitter>();`:

```typescript
  /** Global incrementing event ID counter. */
  private nextEventId = 1;

  /** Maximum events to buffer per session for Last-Event-ID replay. */
  private static readonly BUFFER_SIZE = 50;

  /** Per-session ring buffer for event replay. */
  private eventBuffers = new Map<string, Array<{ id: number; event: SessionSSEEvent }>>();
```

Add method after `emit()`:

```typescript
  /** Get events emitted after the given event ID for a session. */
  getEventsSince(sessionId: string, lastEventId: number): SessionSSEEvent[] {
    const buffer = this.eventBuffers.get(sessionId);
    if (!buffer) return [];
    return buffer.filter(e => e.id > lastEventId).map(e => e.event);
  }
```

In the `emit()` method, after `event.emittedAt = Date.now();`, add buffer push:

```typescript
    event.id = this.nextEventId++;
    // Push to ring buffer
    let buffer = this.eventBuffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.eventBuffers.set(sessionId, buffer);
    }
    buffer.push({ id: event.id, event });
    if (buffer.length > SessionEventBus.BUFFER_SIZE) {
      buffer.splice(0, buffer.length - SessionEventBus.BUFFER_SIZE);
    }
```

Add `id?: number` to the `SessionSSEEvent` interface (line 17):

```typescript
  /** Issue #308: Incrementing event ID for Last-Event-ID replay. */
  id?: number;
```

Clean up buffer in `destroy()`:

```typescript
  destroy(): void {
    for (const emitter of this.emitters.values()) {
      emitter.removeAllListeners();
    }
    this.emitters.clear();
    this.eventBuffers.clear();
    this.globalEmitter?.removeAllListeners();
    this.globalEmitter = null;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run -t "Event Ring Buffer"`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/events.ts src/__tests__/sse-events.test.ts
git commit -m "feat: add event ring buffer for Last-Event-ID replay (#308)"
```

---

### Task 4: Server-Side Last-Event-ID Replay + Idle SSE Timeout + Remove Duplicate Route

**Files:**
- Modify: `src/server.ts:307-340, 894-970`
- Test: `src/__tests__/sse-events.test.ts` (ring buffer already tested in Task 3)

- [ ] **Step 1: Remove duplicate legacy SSE route**

In `src/server.ts`, delete the entire `/sessions/:id/events` handler (lines 939-970):

```typescript
// DELETE THIS BLOCK:
app.get<{ Params: { id: string } }>('/sessions/:id/events', async (req, reply) => {
  // ... entire handler ...
});
```

- [ ] **Step 2: Update the per-session SSE handler to support Last-Event-ID and idle timeout**

Replace the `/v1/sessions/:id/events` handler (lines 894-938) with:

```typescript
// SSE event stream (Issue #32)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/events', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const writeSSE = (event: SessionSSEEvent): boolean => {
    try {
      const id = event.id != null ? `id: ${event.id}\n` : '';
      reply.raw.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      lastWrite = Date.now();
      return true;
    } catch {
      return false;
    }
  };

  let lastWrite = Date.now();

  // Send initial connected event
  reply.raw.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

  // Issue #308: Replay missed events if client sends Last-Event-ID
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = eventBus.getEventsSince(req.params.id, parseInt(lastEventId as string, 10) || 0);
    for (const event of missed) {
      writeSSE(event);
    }
  }

  // Subscribe to session events
  const handler = (event: SessionSSEEvent) => {
    writeSSE(event);
  };

  const unsubscribe = eventBus.subscribe(req.params.id, handler);

  // Heartbeat every 30s + idle timeout check
  const heartbeat = setInterval(() => {
    // Issue #308: Close zombie connections (no successful write in 90s)
    if (Date.now() - lastWrite > 90_000) {
      try { reply.raw.destroy(); } catch { /* already closed */ }
      clearInterval(heartbeat);
      unsubscribe();
      return;
    }
    try {
      reply.raw.write(`data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);
      lastWrite = Date.now();
    } catch {
      clearInterval(heartbeat);
      unsubscribe();
    }
  }, 30_000);

  // Clean up on disconnect
  req.raw.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  // Don't let Fastify auto-send (we manage the response manually)
  await reply;
});
```

- [ ] **Step 3: Update the global SSE handler with idle timeout**

Replace the `/v1/events` handler (lines 307-340) with:

```typescript
// Global SSE event stream — aggregates events from ALL active sessions
app.get('/v1/events', async (_req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let lastWrite = Date.now();

  const activeSessions = sessions.listSessions();
  reply.raw.write(`data: ${JSON.stringify({
    event: 'connected',
    timestamp: new Date().toISOString(),
    data: { activeSessions: activeSessions.length },
  })}\n\n`);

  const handler = (event: GlobalSSEEvent) => {
    try {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      lastWrite = Date.now();
    } catch { /* connection closed */ }
  };

  const unsubscribe = eventBus.subscribeGlobal(handler);

  const heartbeat = setInterval(() => {
    // Issue #308: Close zombie connections (no successful write in 90s)
    if (Date.now() - lastWrite > 90_000) {
      try { reply.raw.destroy(); } catch { /* already closed */ }
      clearInterval(heartbeat);
      unsubscribe();
      return;
    }
    try { reply.raw.write(`data: ${JSON.stringify({ event: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`); lastWrite = Date.now(); } catch { clearInterval(heartbeat); unsubscribe(); }
  }, 30_000);

  _req.raw.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });

  await reply;
});
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "fix: add Last-Event-ID replay, idle SSE timeout, remove duplicate route (#308)"
```

---

### Task 5: ResilientEventSource Circuit Breaker (Client)

**Files:**
- Modify: `dashboard/src/api/client.ts:241-298`
- Test: `dashboard/src/__tests__/resilient-eventsource.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/__tests__/resilient-eventsource.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('ResilientEventSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should create EventSource and forward messages', () => {
    let createdUrl = '';
    const fakeES = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onopen: null as (() => void) | null,
      onerror: null as (() => void) | null,
      close: vi.fn(),
    };

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor(url: string) {
        createdUrl = url;
        return fakeES as any;
      }
    });

    // Import after stub
    const { subscribeSSE } = await import('../api/client');

    const handler = vi.fn();
    subscribeSSE('sess-1', handler, 'token123');

    expect(createdUrl).toContain('sess-1');
    expect(createdUrl).toContain('token=token123');

    // Simulate message
    const msg = new MessageEvent('message', { data: '{"event":"status"}' });
    fakeES.onmessage!(msg);
    expect(handler).toHaveBeenCalled();
  });

  it('should reconnect with exponential backoff on error', async () => {
    let createCount = 0;
    const connections: Array<{ onmessage: any; onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        // First connection fails immediately
        if (createCount === 1) {
          setTimeout(() => conn.onerror?.(), 0);
        }
        return conn as any;
      }
    });

    const { subscribeSSE } = await import('../api/client');
    const handler = vi.fn();
    const onReconnecting = vi.fn();
    subscribeSSE('sess-1', handler, null, { onReconnecting });

    await vi.advanceTimersByTimeAsync(100);
    expect(createCount).toBe(1);

    // Advance past 1st backoff (1s)
    await vi.advanceTimersByTimeAsync(1500);
    expect(createCount).toBe(2);
    expect(onReconnecting).toHaveBeenCalledWith(1, expect.any(Number));

    // Simulate 2nd connection also failing
    connections[1].onerror?.();
    await vi.advanceTimersByTimeAsync(100);

    // Advance past 2nd backoff (2s)
    await vi.advanceTimersByTimeAsync(2500);
    expect(createCount).toBe(3);
    expect(onReconnecting).toHaveBeenCalledWith(2, expect.any(Number));
  });

  it('should give up after 5 minutes of continuous failure', async () => {
    let createCount = 0;
    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onerror: null as any, close: vi.fn() };
        // All connections fail
        setTimeout(() => conn.onerror?.(), 0);
        return conn as any;
      }
    });

    const { subscribeSSE } = await import('../api/client');
    const onGiveUp = vi.fn();
    subscribeSSE('sess-1', vi.fn(), null, { onGiveUp });

    // Advance 5 minutes
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 60_000);

    expect(onGiveUp).toHaveBeenCalled();
  });

  it('should reset failure counter on successful connection', async () => {
    let createCount = 0;
    const connections: Array<{ onopen: any; onerror: any; close: () => void }> = [];

    vi.stubGlobal('EventSource', class MockEventSource {
      constructor() {
        createCount++;
        const conn = { onmessage: null as any, onopen: null as any, onerror: null as any, close: vi.fn() };
        connections.push(conn);
        return conn as any;
      }
    });

    const { subscribeSSE } = await import('../api/client');
    const onReconnecting = vi.fn();
    subscribeSSE('sess-1', vi.fn(), null, { onReconnecting });

    // First connection succeeds
    await vi.advanceTimersByTimeAsync(100);
    connections[0].onopen?.();

    // Then fails
    connections[0].onerror?.();
    await vi.advanceTimersByTimeAsync(100);

    // Should be attempt 1 (reset, not 2)
    await vi.advanceTimersByTimeAsync(1500);
    expect(onReconnecting).toHaveBeenCalledWith(1, expect.any(Number));
  });
});
```

Note: The `subscribeSSE` function signature will change to accept an optional callbacks parameter. Adjust test imports as needed — you may need to use dynamic `import()` or restructure.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run -t "ResilientEventSource"`
Expected: FAIL — no backoff/circuit breaker logic exists

- [ ] **Step 3: Implement ResilientEventSource**

In `dashboard/src/api/client.ts`, add a `ResilientEventSource` class before the `subscribeSSE` function:

```typescript
// ── ResilientEventSource (Issue #308) ─────────────────────────────

const MAX_BACKOFF_MS = 30_000;
const GIVE_UP_MS = 5 * 60 * 1000; // 5 minutes

interface ResilientCallbacks {
  onReconnecting?: (attempt: number, delay: number) => void;
  onGiveUp?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
}

class ResilientEventSource {
  private eventSource: EventSource | null = null;
  private consecutiveFailures = 0;
  private failStartTime: number | null = null;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private callbacks: ResilientCallbacks;
  private onMessage: (e: MessageEvent) => void;

  constructor(url: string, onMessage: (e: MessageEvent) => void, callbacks: ResilientCallbacks = {}) {
    this.url = url;
    this.onMessage = onMessage;
    this.callbacks = callbacks;
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    this.eventSource = new EventSource(this.url);
    this.eventSource.onmessage = this.onMessage;
    this.eventSource.onopen = () => {
      if (this.destroyed) return;
      this.consecutiveFailures = 0;
      this.failStartTime = null;
      this.callbacks.onOpen?.();
    };
    this.eventSource.onerror = () => {
      if (this.destroyed) return;
      this.eventSource?.close();
      this.eventSource = null;

      if (this.failStartTime === null) {
        this.failStartTime = Date.now();
      }

      // Check give-up condition
      if (Date.now() - this.failStartTime >= GIVE_UP_MS) {
        this.callbacks.onGiveUp?.();
        this.callbacks.onClose?.();
        return;
      }

      this.consecutiveFailures++;
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, this.consecutiveFailures - 1));
      this.callbacks.onReconnecting?.(this.consecutiveFailures, delay);
      this.callbacks.onClose?.();

      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
  }

  close(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.eventSource?.close();
    this.eventSource = null;
  }
}
```

- [ ] **Step 4: Refactor subscribeSSE to use ResilientEventSource and accept callbacks**

Replace the `subscribeSSE` function:

```typescript
export function subscribeSSE(
  sessionId: string,
  handler: (event: MessageEvent) => void,
  token?: string | null,
  callbacks?: { onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void; onOpen?: () => void; onClose?: () => void },
): () => void {
  const basePath = `/v1/sessions/${encodeURIComponent(sessionId)}/events`;
  const url = token ? `${basePath}?token=${encodeURIComponent(token)}` : basePath;

  const resilient = new ResilientEventSource(url, handler, callbacks);

  return () => {
    resilient.close();
  };
}
```

- [ ] **Step 5: Refactor subscribeGlobalSSE to use ResilientEventSource**

Replace the `subscribeGlobalSSE` function:

```typescript
export function subscribeGlobalSSE(
  handler: (event: GlobalSSEEvent) => void,
  token?: string | null,
  callbacks?: { onOpen?: () => void; onClose?: () => void; onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void },
): () => void {
  const basePath = '/v1/events';
  const url = token ? `${basePath}?token=${encodeURIComponent(token)}` : basePath;

  const wrappedHandler = (e: MessageEvent) => {
    try {
      const parsed = JSON.parse(e.data as string) as GlobalSSEEvent;
      handler(parsed);
    } catch {
      // ignore malformed events
    }
  };

  const resilient = new ResilientEventSource(url, wrappedHandler, callbacks);

  return () => {
    callbacks?.onClose?.();
    resilient.close();
  };
}
```

- [ ] **Step 6: Fix test imports — use dynamic import or restructure**

The test uses `await import(...)` which requires top-level await. Convert tests to use a synchronous approach or wrap in an async function. Update test file to properly handle the module-level nature. Simplest fix: extract `ResilientEventSource` into its own file `dashboard/src/api/resilient-eventsource.ts` and import it directly in tests.

Create `dashboard/src/api/resilient-eventsource.ts` with the `ResilientEventSource` class, `MAX_BACKOFF_MS`, `GIVE_UP_MS`, and `ResilientCallbacks` type (exported). Then import it in `client.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run -t "ResilientEventSource"`
Expected: PASS

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/api/resilient-eventsource.ts dashboard/src/api/client.ts dashboard/src/__tests__/resilient-eventsource.test.ts
git commit -m "feat: add ResilientEventSource with backoff and circuit breaker (#308)"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup for #308 SSE robustness"
```
