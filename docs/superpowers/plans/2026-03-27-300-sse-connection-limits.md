# SSE Connection Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-IP and global connection limits to SSE endpoints to prevent unbounded resource consumption.

**Architecture:** Create a standalone `SSEConnectionLimiter` class that tracks active SSE connections in a `Map<connectionId, {ip}>`. The limiter enforces two limits: max total connections (default 100) and max per-IP connections (default 10). SSE route handlers call `acquire()` before opening a stream and `release()` on disconnect. When limits are exceeded, the route returns 429 with a descriptive error. Config is wired through `Config` and env vars.

**Tech Stack:** TypeScript, Vitest, Fastify

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/sse-limiter.ts` | SSEConnectionLimiter class — tracking, limits, cleanup |
| Create | `src/__tests__/sse-limiter.test.ts` | Unit tests for the limiter |
| Modify | `src/config.ts` | Add `sseMaxConnections`, `sseMaxPerIp` to Config |
| Modify | `src/server.ts` | Wire limiter into both SSE routes |

---

### Task 1: Write failing tests for SSEConnectionLimiter

**Files:**
- Create: `src/__tests__/sse-limiter.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSEConnectionLimiter } from '../sse-limiter.js';

describe('SSEConnectionLimiter (Issue #300)', () => {
  let limiter: SSEConnectionLimiter;

  beforeEach(() => {
    limiter = new SSEConnectionLimiter({ maxConnections: 5, maxPerIp: 2 });
  });

  // ── acquire / release basics ──────────────────────────────

  it('should allow connections under both limits', () => {
    const result = limiter.acquire('192.168.1.1');
    expect(result.allowed).toBe(true);
    expect(result.connectionId).toBe('sse-1');
  });

  it('should track active connection count', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.2');
    expect(limiter.activeCount).toBe(2);
  });

  it('should decrement count on release', () => {
    const r = limiter.acquire('10.0.0.1');
    expect(limiter.activeCount).toBe(1);
    limiter.release(r.connectionId);
    expect(limiter.activeCount).toBe(0);
  });

  // ── per-IP limit ─────────────────────────────────────────

  it('should reject connections exceeding per-IP limit', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    const result = limiter.acquire('10.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('per_ip_limit');
  });

  it('should allow connections from a different IP when per-IP limit hit', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    const result = limiter.acquire('10.0.0.2');
    expect(result.allowed).toBe(true);
  });

  it('should free per-IP slot on release', () => {
    const r1 = limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    // at per-IP limit
    expect(limiter.acquire('10.0.0.1').allowed).toBe(false);
    // release one
    limiter.release(r1.connectionId);
    // should now be allowed
    expect(limiter.acquire('10.0.0.1').allowed).toBe(true);
  });

  // ── global limit ─────────────────────────────────────────

  it('should reject connections exceeding global limit', () => {
    // Fill up with different IPs
    for (let i = 0; i < 5; i++) {
      limiter.acquire(`10.0.${i}.1`);
    }
    // 6th connection from any IP should fail
    const result = limiter.acquire('10.0.5.1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('global_limit');
  });

  it('should free global slot on release', () => {
    const connections = [];
    for (let i = 0; i < 5; i++) {
      connections.push(limiter.acquire(`10.0.${i}.1`).connectionId);
    }
    expect(limiter.acquire('10.0.5.1').allowed).toBe(false);
    limiter.release(connections[0]);
    expect(limiter.acquire('10.0.5.1').allowed).toBe(true);
  });

  // ── per-IP takes priority over global ────────────────────

  it('should report per_ip_limit before global_limit', () => {
    // 2 connections from same IP hits per-IP limit
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    // 3rd from same IP: per-IP reason (not global, even though we still have global headroom)
    const result = limiter.acquire('10.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('per_ip_limit');
  });

  // ── release safety ───────────────────────────────────────

  it('should handle release of unknown connectionId gracefully', () => {
    // Should not throw
    limiter.release('nonexistent-id');
    expect(limiter.activeCount).toBe(0);
  });

  it('should handle double-release gracefully', () => {
    const r = limiter.acquire('10.0.0.1');
    limiter.release(r.connectionId);
    // Second release should not throw or go negative
    limiter.release(r.connectionId);
    expect(limiter.activeCount).toBe(0);
  });

  // ── per-IP count query ───────────────────────────────────

  it('should report per-IP active count', () => {
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.1');
    limiter.acquire('10.0.0.2');
    expect(limiter.activeCountForIp('10.0.0.1')).toBe(2);
    expect(limiter.activeCountForIp('10.0.0.2')).toBe(1);
    expect(limiter.activeCountForIp('10.0.0.3')).toBe(0);
  });

  // ── defaults ─────────────────────────────────────────────

  it('should use defaults when no config provided', () => {
    const defaultLimiter = new SSEConnectionLimiter();
    expect(defaultLimiter.activeCount).toBe(0);
    // Should allow at least 10 from one IP
    for (let i = 0; i < 10; i++) {
      expect(defaultLimiter.acquire('10.0.0.1').allowed).toBe(true);
    }
    // 11th should fail (per-IP limit of 10)
    expect(defaultLimiter.acquire('10.0.0.1').allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/sse-limiter.test.ts`
Expected: FAIL — module `'../sse-limiter.js'` not found.

---

### Task 2: Implement SSEConnectionLimiter

**Files:**
- Create: `src/sse-limiter.ts`

- [ ] **Step 1: Write the implementation**

```typescript
/**
 * sse-limiter.ts — Connection limiter for SSE endpoints (Issue #300).
 *
 * Tracks active SSE connections per-IP and globally.
 * Enforces configurable limits to prevent unbounded resource consumption.
 */

export interface SSELimiterConfig {
  /** Maximum total concurrent SSE connections across all IPs. Default: 100 */
  maxConnections?: number;
  /** Maximum concurrent SSE connections per client IP. Default: 10 */
  maxPerIp?: number;
}

export interface AcquireResult {
  allowed: true;
  connectionId: string;
}

export interface AcquireDeniedResult {
  allowed: false;
  reason: 'per_ip_limit' | 'global_limit';
  /** Current count for the limiting dimension */
  current: number;
  /** Configured limit */
  limit: number;
}

export type AcquireResponse = AcquireResult | AcquireDeniedResult;

interface ConnectionEntry {
  ip: string;
}

export class SSEConnectionLimiter {
  private readonly maxConnections: number;
  private readonly maxPerIp: number;
  private readonly connections = new Map<string, ConnectionEntry>();
  private readonly ipCounts = new Map<string, number>();
  private nextId = 1;

  constructor(config?: SSELimiterConfig) {
    this.maxConnections = config?.maxConnections ?? 100;
    this.maxPerIp = config?.maxPerIp ?? 10;
  }

  /** Current total active connections. */
  get activeCount(): number {
    return this.connections.size;
  }

  /** Active connections for a specific IP. */
  activeCountForIp(ip: string): number {
    return this.ipCounts.get(ip) ?? 0;
  }

  /**
   * Attempt to acquire a connection slot.
   * Check per-IP limit first (more specific), then global limit.
   */
  acquire(ip: string): AcquireResponse {
    const currentPerIp = this.activeCountForIp(ip);
    if (currentPerIp >= this.maxPerIp) {
      return { allowed: false, reason: 'per_ip_limit', current: currentPerIp, limit: this.maxPerIp };
    }

    if (this.connections.size >= this.maxConnections) {
      return { allowed: false, reason: 'global_limit', current: this.connections.size, limit: this.maxConnections };
    }

    const connectionId = `sse-${this.nextId++}`;
    this.connections.set(connectionId, { ip });
    this.ipCounts.set(ip, currentPerIp + 1);
    return { allowed: true, connectionId };
  }

  /**
   * Release a connection slot.
   * Safe to call with unknown or already-released IDs (no-op).
   */
  release(connectionId: string): void {
    const entry = this.connections.get(connectionId);
    if (!entry) return;

    this.connections.delete(connectionId);
    const count = this.ipCounts.get(entry.ip);
    if (count !== undefined) {
      if (count <= 1) {
        this.ipCounts.delete(entry.ip);
      } else {
        this.ipCounts.set(entry.ip, count - 1);
      }
    }
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/sse-limiter.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/sse-limiter.ts src/__tests__/sse-limiter.test.ts
git commit -m "feat: add SSEConnectionLimiter with per-IP and global limits (Issue #300)"
```

---

### Task 3: Add SSE limits to Config

**Files:**
- Modify: `src/config.ts:19-52` (Config interface)
- Modify: `src/config.ts:54-70` (defaults)
- Modify: `src/config.ts:132-174` (env overrides)

- [ ] **Step 1: Add config fields**

In `src/config.ts`, add to the `Config` interface after `stallThresholdMs`:

```typescript
  /** Maximum total concurrent SSE connections (default: 100). Env: AEGIS_SSE_MAX_CONNECTIONS */
  sseMaxConnections: number;
  /** Maximum concurrent SSE connections per client IP (default: 10). Env: AEGIS_SSE_MAX_PER_IP */
  sseMaxPerIp: number;
```

Add to `defaults` object:

```typescript
  sseMaxConnections: 100,
  sseMaxPerIp: 10,
```

Add to `envMappings` array (before the closing `]`):

```typescript
    { aegis: 'AEGIS_SSE_MAX_CONNECTIONS', manus: 'MANUS_SSE_MAX_CONNECTIONS', key: 'sseMaxConnections' },
    { aegis: 'AEGIS_SSE_MAX_PER_IP', manus: 'MANUS_SSE_MAX_PER_IP', key: 'sseMaxPerIp' },
```

Add to the `switch` statement's numeric cases:

```typescript
      case 'sseMaxConnections':
      case 'sseMaxPerIp':
```

(Add these two cases alongside the existing `case 'port':`, `case 'maxSessionAgeMs':`, `case 'reaperIntervalMs':` block.)

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add SSE connection limit config fields (Issue #300)"
```

---

### Task 4: Wire limiter into SSE routes

**Files:**
- Modify: `src/server.ts:37-38` (imports)
- Modify: `src/server.ts:307-345` (global SSE route)
- Modify: `src/server.ts:917-962` (per-session SSE route)

- [ ] **Step 1: Add import and instantiate limiter**

Add to imports in `src/server.ts` after the `SSEWriter` import:

```typescript
import { SSEConnectionLimiter } from './sse-limiter.js';
```

Create the limiter instance after the other manager instantiations (find where `eventBus` is created and add nearby):

```typescript
const sseLimiter = new SSEConnectionLimiter({
  maxConnections: config.sseMaxConnections,
  maxPerIp: config.sseMaxPerIp,
});
```

- [ ] **Step 2: Add limit check + tracking to global SSE route**

Replace the global SSE route (`app.get('/v1/events', ...)`) at line ~308 with:

```typescript
// Global SSE event stream — aggregates events from ALL active sessions
app.get('/v1/events', async (req, reply) => {
  const clientIp = req.ip;
  const acquireResult = sseLimiter.acquire(clientIp);
  if (!acquireResult.allowed) {
    const status = acquireResult.reason === 'per_ip_limit' ? 429 : 503;
    return reply.status(status).send({
      error: acquireResult.reason === 'per_ip_limit'
        ? `Per-IP connection limit reached (${acquireResult.current}/${acquireResult.limit})`
        : `Global connection limit reached (${acquireResult.current}/${acquireResult.limit})`,
      reason: acquireResult.reason,
    });
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let unsubscribe: (() => void) | undefined;
  const connectionId = acquireResult.connectionId;

  const writer = new SSEWriter(reply.raw, req.raw, () => {
    unsubscribe?.();
    sseLimiter.release(connectionId);
  });
  writer.write(`data: ${JSON.stringify({
    event: 'connected',
    timestamp: new Date().toISOString(),
    data: { activeSessions: sessions.listSessions().length },
  })}\n\n`);

  // Issue #301: Replay missed global events if client sends Last-Event-ID
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = eventBus.getGlobalEventsSince(parseInt(lastEventId as string, 10) || 0);
    for (const { id, event: globalEvent } of missed) {
      writer.write(`id: ${id}\ndata: ${JSON.stringify(globalEvent)}\n\n`);
    }
  }

  const handler = (event: GlobalSSEEvent): void => {
    const id = event.id != null ? `id: ${event.id}\n` : '';
    writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
  };

  unsubscribe = eventBus.subscribeGlobal(handler);
  writer.startHeartbeat(30_000, 90_000, () =>
    `data: ${JSON.stringify({ event: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`
  );

  await reply;
});
```

Key changes: acquire before writing headers, pass `connectionId` to the cleanup callback, release on disconnect.

- [ ] **Step 3: Add limit check + tracking to per-session SSE route**

Replace the per-session SSE route (`app.get('/v1/sessions/:id/events', ...)`) at line ~918 with:

```typescript
// SSE event stream (Issue #32)
app.get<{ Params: { id: string } }>('/v1/sessions/:id/events', async (req, reply) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });

  const clientIp = req.ip;
  const acquireResult = sseLimiter.acquire(clientIp);
  if (!acquireResult.allowed) {
    const status = acquireResult.reason === 'per_ip_limit' ? 429 : 503;
    return reply.status(status).send({
      error: acquireResult.reason === 'per_ip_limit'
        ? `Per-IP connection limit reached (${acquireResult.current}/${acquireResult.limit})`
        : `Global connection limit reached (${acquireResult.current}/${acquireResult.limit})`,
      reason: acquireResult.reason,
    });
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let unsubscribe: (() => void) | undefined;
  const connectionId = acquireResult.connectionId;

  const writer = new SSEWriter(reply.raw, req.raw, () => {
    unsubscribe?.();
    sseLimiter.release(connectionId);
  });

  const writeSSE = (event: SessionSSEEvent): boolean => {
    const id = event.id != null ? `id: ${event.id}\n` : '';
    return writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
  };

  // Send initial connected event
  writer.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

  // Issue #308: Replay missed events if client sends Last-Event-ID
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = eventBus.getEventsSince(req.params.id, parseInt(lastEventId as string, 10) || 0);
    for (const event of missed) {
      writeSSE(event);
    }
  }

  // Subscribe to session events
  const handler = (event: SessionSSEEvent): void => {
    writeSSE(event);
  };

  unsubscribe = eventBus.subscribe(req.params.id, handler);
  writer.startHeartbeat(30_000, 90_000, () =>
    `data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`
  );

  // Don't let Fastify auto-send (we manage the response manually)
  await reply;
});
```

- [ ] **Step 4: Run type check and build**

Run: `npx tsc --noEmit && npm run build`
Expected: Both pass.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: wire SSE connection limiter into both SSE routes (Issue #300)"
```

---

### Task 5: Write integration-style tests for SSE route rejection

**Files:**
- Modify: `src/__tests__/sse-limiter.test.ts`

- [ ] **Step 1: Add tests that verify the limiter works with Fastify-like acquire/release flow**

Add at the bottom of `src/__tests__/sse-limiter.test.ts`, inside a new describe block:

```typescript
describe('SSE limiter integration flow', () => {
  it('should simulate an SSE route acquire/release lifecycle', () => {
    const limiter = new SSEConnectionLimiter({ maxConnections: 3, maxPerIp: 2 });

    // Simulate 3 clients connecting
    const c1 = limiter.acquire('10.0.0.1');
    const c2 = limiter.acquire('10.0.0.1');
    const c3 = limiter.acquire('10.0.0.2');

    expect(c1.allowed).toBe(true);
    expect(c2.allowed).toBe(true);
    expect(c3.allowed).toBe(true);

    // 4th from any IP rejected (global limit)
    const c4 = limiter.acquire('10.0.0.3');
    expect(c4.allowed).toBe(false);
    expect(c4.reason).toBe('global_limit');

    // Disconnect c1 — should free both a global and per-IP slot
    if (c1.allowed) limiter.release(c1.connectionId);

    // Now a new IP should be allowed (global freed)
    const c5 = limiter.acquire('10.0.0.3');
    expect(c5.allowed).toBe(true);

    // But 10.0.0.1 still has one slot, and can reconnect
    const c6 = limiter.acquire('10.0.0.1');
    expect(c6.allowed).toBe(true);

    // 3rd from 10.0.0.1 rejected again (per-IP)
    const c7 = limiter.acquire('10.0.0.1');
    expect(c7.allowed).toBe(false);
    expect(c7.reason).toBe('per_ip_limit');

    // Cleanup
    if (c2.allowed) limiter.release(c2.connectionId);
    if (c3.allowed) limiter.release(c3.connectionId);
    if (c5.allowed) limiter.release(c5.connectionId);
    if (c6.allowed) limiter.release(c6.connectionId);
    expect(limiter.activeCount).toBe(0);
  });

  it('should handle rapid connect/disconnect cycles without leaking', () => {
    const limiter = new SSEConnectionLimiter({ maxConnections: 10, maxPerIp: 5 });

    // Rapid connect/disconnect
    for (let i = 0; i < 100; i++) {
      const r = limiter.acquire('10.0.0.1');
      if (r.allowed) limiter.release(r.connectionId);
    }

    expect(limiter.activeCount).toBe(0);
    expect(limiter.activeCountForIp('10.0.0.1')).toBe(0);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run src/__tests__/sse-limiter.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/sse-limiter.test.ts
git commit -m "test: add SSE limiter integration flow tests (Issue #300)"
```

---

## Self-Review

**Spec coverage:**
- Per-IP connection limit (10 per IP) → Tasks 1, 2, 4
- Global max connections limit (100) → Tasks 1, 2, 4
- Track active SSE connections in a Map → Task 2
- Reject new connections when limit reached (429/503) → Task 4
- Clean up tracking on disconnect → Tasks 2, 4 (via SSEWriter onCleanup callback)
- Config via env vars → Task 3
- Tests → Tasks 1, 5

**Placeholder scan:** No TBD/TODO/fill-in patterns found. All code blocks contain complete implementation.

**Type consistency:** `AcquireResponse` union type used consistently. `connectionId` property name matches between `acquire()` return and `release()` parameter. Config field names `sseMaxConnections`/`sseMaxPerIp` match across interface, defaults, env mappings, and server.ts usage.
