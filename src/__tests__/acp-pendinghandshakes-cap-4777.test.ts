/**
 * Regression test for #4777: pendingHandshakes Map has no upper bound.
 *
 * Bug: PR #4761 closed the #4760 race regression but did NOT add capacity
 * bounds. The Map could grow without bound until OOM or memory pressure
 * if a pathological caller pattern (N concurrent unique createSessionAsync,
 * each with a hung handshake) was hit.
 *
 * Fix: cap the Map at a configurable `maxPendingHandshakes` (default 1000).
 * When the cap is reached, reject the new createSessionAsync with a typed
 * `AcpBackendPendingHandshakesCapExceededError`. The first N calls (under
 * cap) succeed normally; the (N+1)th rejects synchronously after the
 * sessionService.createSession awaits but BEFORE the startNewRuntimeBackground
 * call (no handshake launched for the rejected call → no resource leak).
 *
 * Eviction was considered (DoR: "evict the oldest entry (LRU by insertion
 * order) OR reject the new request with a typed error") but rejected because:
 *   1. Eviction requires a runtime-shutdown path for the evicted handshake,
 *      which is a much larger surgery on `runtimeLifecycle.startNewRuntimeBackground`
 *      than the cap-and-reject path.
 *   2. The DoR explicitly lists "rejection" as an alternative — both options
 *      satisfy the acceptance criteria.
 *   3. Rejection is observable at the call site (typed error), whereas eviction
 *      would silently drop the oldest caller's references — surprising.
 *
 * Out of scope (separate issues):
 * - Handshake TTL with `acp_handshake_stuck` event (#4778)
 * - ReadonlyMap type-level tightening on `pendingHandshakes` (#4779 — landed)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpBackendOptions } from '../services/acp/backend.js';

const startNewRuntimeBackgroundMock = vi.fn();
vi.mock('../services/acp/backend/runtime.js', () => ({
  startNewRuntimeBackground: startNewRuntimeBackgroundMock,
}));

/**
 * Returns a sessionService mock whose `createSession` produces a unique
 * sessionId per call (so dedup doesn't short-circuit during N+1 concurrent
 * unique createSessionAsync calls).
 */
function makeMockSessionService() {
  let counter = 0;
  return {
    getSession: vi.fn().mockResolvedValue({ id: 's', acpAgentSessionId: null }),
    createSession: vi.fn().mockImplementation(() => {
      counter += 1;
      return Promise.resolve({ id: `sess-${counter}` });
    }),
    attachAgentSession: vi.fn(),
    transition: vi.fn(),
    recordBackendRestart: vi.fn(),
  };
}

function makeInput() {
  return { tenantId: '_system', ownerKeyId: 'master', cwd: '/tmp' };
}

describe('#4777 — pendingHandshakes cap enforcement', () => {
  beforeEach(() => {
    startNewRuntimeBackgroundMock.mockReset();
  });

  it('rejects the (cap+1)th unique createSessionAsync with AcpBackendPendingHandshakesCapExceededError', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');
    const { AcpBackendPendingHandshakesCapExceededError } = await import(
      '../services/acp/backend/errors.js'
    );

    // Hung handshake — never resolves during the test, so the Map doesn't drain.
    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => {
      resolveHandshake = resolve;
    });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const sessionService = makeMockSessionService();
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      maxPendingHandshakes: 3, // tiny cap so test is fast
    } as AcpBackendOptions);

    // Fire 4 concurrent unique createSessionAsync. The 4th should be rejected.
    const calls = Array.from({ length: 4 }, () => backend.createSessionAsync(makeInput()));
    // Attach explicit no-op catch handlers to suppress vitest unhandled-rejection warnings.
    // The actual rejection reasons are captured by Promise.allSettled below.
    calls.forEach((p) => { p.catch(() => {}); });

    // Yield so all 4 calls reach the cap check (each awaits sessionService.createSession).
    await new Promise((r) => setTimeout(r, 20));

    // Map size should be exactly 3 (the cap).
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.size).toBe(3);

    // Resolve the hung handshake so the 3 successful calls' ready promises settle.
    resolveHandshake();
    await new Promise((r) => setTimeout(r, 10));

    // 3 should be fulfilled, the 4th should reject with the typed error.
    const settled = await Promise.allSettled(calls);
    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1].status).toBe('fulfilled');
    expect(settled[2].status).toBe('fulfilled');
    expect(settled[3].status).toBe('rejected');
    expect((settled[3] as PromiseRejectedResult).reason).toBeInstanceOf(
      AcpBackendPendingHandshakesCapExceededError
    );
  });

  it('does NOT call startNewRuntimeBackground for the rejected (cap+1)th call (no resource leak)', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => {
      resolveHandshake = resolve;
    });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const sessionService = makeMockSessionService();
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      maxPendingHandshakes: 2,
    } as AcpBackendOptions);

    // Fire 3 concurrent unique createSessionAsync.
    const calls = Array.from({ length: 3 }, () => backend.createSessionAsync(makeInput()));
    // Attach explicit no-op catch handlers to suppress vitest unhandled-rejection warnings.
    // The actual rejection reasons are captured by Promise.allSettled below.
    calls.forEach((p) => { p.catch(() => {}); });

    await new Promise((r) => setTimeout(r, 20));

    // Only 2 handshakes should have been launched (cap reached at 2).
    // The 3rd call hits the cap check and throws BEFORE startNewRuntimeBackground.
    expect(startNewRuntimeBackgroundMock).toHaveBeenCalledTimes(2);

    // Cleanup: resolve so the test doesn't hang.
    resolveHandshake();
    await Promise.allSettled(calls);
  });

  it('default cap (no maxPendingHandshakes option) allows 50 concurrent unique calls without rejection', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => {
      resolveHandshake = resolve;
    });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const sessionService = makeMockSessionService();
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      // maxPendingHandshakes: undefined → default (1000 per DoR)
    } as AcpBackendOptions);

    const calls = Array.from({ length: 50 }, () => backend.createSessionAsync(makeInput()));
    // Attach explicit no-op catch handlers to suppress vitest unhandled-rejection warnings.
    // The actual rejection reasons are captured by Promise.allSettled below.
    calls.forEach((p) => { p.catch(() => {}); });

    await new Promise((r) => setTimeout(r, 50));

    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.size).toBe(50);

    resolveHandshake();
    const settled = await Promise.allSettled(calls);
    expect(settled.every((s) => s.status === 'fulfilled')).toBe(true);
  });

  it('dedup bypasses the cap: a second call for an EXISTING sessionId returns the existing entry without consuming cap space', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => {
      resolveHandshake = resolve;
    });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    // sessionService.createSession returns the SAME sessionId every time,
    // so all createSessionAsync calls hit the dedup path (no new Map entry).
    const sessionService = {
      getSession: vi.fn().mockResolvedValue({ id: 's1', acpAgentSessionId: null }),
      createSession: vi.fn().mockResolvedValue({ id: 's1' }),
      attachAgentSession: vi.fn(),
      transition: vi.fn(),
      recordBackendRestart: vi.fn(),
    };

    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      maxPendingHandshakes: 2,
    } as AcpBackendOptions);

    // Fire 5 concurrent createSessionAsync — all for the SAME sessionId.
    // The first launches a handshake; the other 4 hit dedup and return the same.
    const calls = Array.from({ length: 5 }, () => backend.createSessionAsync(makeInput()));
    // Attach explicit no-op catch handlers to suppress vitest unhandled-rejection warnings.
    // The actual rejection reasons are captured by Promise.allSettled below.
    calls.forEach((p) => { p.catch(() => {}); });

    await new Promise((r) => setTimeout(r, 20));

    // Map should have only 1 entry (s1), not 5.
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.size).toBe(1);

    // startNewRuntimeBackground called only once.
    expect(startNewRuntimeBackgroundMock).toHaveBeenCalledTimes(1);

    // All 5 returned promises should be the SAME ready promise (dedup identity).
    resolveHandshake();
    const results = await Promise.all(calls);
    const firstReady = results[0].ready;
    expect(results.every((r) => r.ready === firstReady)).toBe(true);
  });

  it('after Map entry settles and .finally() fires, cap is restored and new unique calls succeed', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');
    const { AcpBackendPendingHandshakesCapExceededError } = await import(
      '../services/acp/backend/errors.js'
    );

    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => {
      resolveHandshake = resolve;
    });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const sessionService = makeMockSessionService();
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      maxPendingHandshakes: 2,
    } as AcpBackendOptions);

    // Phase 1: fill to cap, then reject one
    const initialCalls = Array.from({ length: 3 }, () =>
      backend.createSessionAsync(makeInput())
    );
    // Attach explicit no-op catch handlers to suppress vitest unhandled-rejection warnings.
    // The actual rejection reasons are captured by Promise.allSettled below.
    initialCalls.forEach((p) => { p.catch(() => {}); });
    await new Promise((r) => setTimeout(r, 20));

    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.size).toBe(2);

    // Phase 2: resolve the 2 hung handshakes → .finally() fires → Map empties
    resolveHandshake();
    await new Promise((r) => setTimeout(r, 20));

    expect(backendInternal.pendingHandshakes.size).toBe(0);

    // Phase 3: a new unique call should now succeed (Map is empty, no cap)
    let resolveHandshake2!: () => void;
    const handshakePromise2 = new Promise<void>((resolve) => {
      resolveHandshake2 = resolve;
    });
    startNewRuntimeBackgroundMock.mockReturnValueOnce(handshakePromise2);

    const newCall = backend.createSessionAsync(makeInput());
    await new Promise((r) => setTimeout(r, 20));

    expect(backendInternal.pendingHandshakes.size).toBe(1);

    // Verify the final state: 2 fulfilled, 1 rejected (phase 1), 1 fulfilled (phase 3).
    resolveHandshake2();
    const settled = await Promise.allSettled([...initialCalls, newCall]);
    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1].status).toBe('fulfilled');
    expect(settled[2].status).toBe('rejected');
    expect(settled[3].status).toBe('fulfilled');
    expect((settled[2] as PromiseRejectedResult).reason).toBeInstanceOf(
      AcpBackendPendingHandshakesCapExceededError
    );
  });
});
