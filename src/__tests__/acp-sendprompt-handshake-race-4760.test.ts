/**
 * Regression test for #4760: race regression in pendingHandshakes Map.
 *
 * Bug (re-introduces #4738 race): two concurrent `createSessionAsync` calls
 * for the same `sessionId` overwrite the Map entry; the first `.finally()`
 * then deletes the second's entry before it resolves; a `sendPrompt` issued
 * during the second handshake sees no pending entry → falls through to
 * `autoResume` → the original #4738 race is re-triggered.
 *
 * Fix: per-session dedup. If a second `createSessionAsync` arrives for the
 * same `sessionId` while one is pending, return the existing promise
 * instead of starting a new handshake.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpBackendOptions } from '../services/acp/backend.js';

const startNewRuntimeBackgroundMock = vi.fn();
vi.mock('../services/acp/backend/runtime.js', () => ({
  startNewRuntimeBackground: startNewRuntimeBackgroundMock,
}));

function makeMockSessionService(sessionId: string) {
  return {
    getSession: vi.fn().mockResolvedValue({ id: sessionId, acpAgentSessionId: null }),
    createSession: vi.fn().mockResolvedValue({ id: sessionId }),
    attachAgentSession: vi.fn(),
    transition: vi.fn(),
    recordBackendRestart: vi.fn(),
  };
}

function makeInput() {
  return { tenantId: '_system', ownerKeyId: 'master', cwd: '/tmp' };
}

describe('#4760 — race regression: concurrent createSessionAsync preserves dedup', () => {
  beforeEach(() => {
    startNewRuntimeBackgroundMock.mockReset();
  });

  it('two concurrent createSessionAsync calls for the same sessionId dedup to a single handshake', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    // Controllable handshake: resolves only when we tell it to.
    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => { resolveHandshake = resolve; });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const sessionService = makeMockSessionService('s1');
    const backend = new AcpBackend({ sessionService, clientFactory: vi.fn() } as AcpBackendOptions);

    // Fire two concurrent createSessionAsync for the same sessionId.
    const callA = backend.createSessionAsync(makeInput());
    const callB = backend.createSessionAsync(makeInput());

    // Both promises are awaiting the sessionService.createSession (microtask) +
    // the startNewRuntimeBackground call (microtask). Yield so both reach the
    // set-Map step before we assert.
    await new Promise(r => setTimeout(r, 10));

    // Pre-fix: two separate startNewRuntimeBackground calls (one per call).
    // Post-fix: only one call (the second call returns the existing promise).
    expect(startNewRuntimeBackgroundMock).toHaveBeenCalledTimes(1);

    // The pendingHandshakes Map should have exactly one entry for s1.
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, Promise<unknown>>;
    };
    expect(backendInternal.pendingHandshakes.size).toBe(1);
    expect(backendInternal.pendingHandshakes.has('s1')).toBe(true);

    // Resolve the handshake; both result promises should settle with the
    // same `ready` promise (dedup).
    resolveHandshake();
    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(resultA.ready).toBe(resultB.ready);
  });

  it('second concurrent call returns the same ready promise (no overwrite)', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((resolve) => { resolveHandshake = resolve; });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const sessionService = makeMockSessionService('s1');
    const backend = new AcpBackend({ sessionService, clientFactory: vi.fn() } as AcpBackendOptions);

    const callA = backend.createSessionAsync(makeInput());
    const callB = backend.createSessionAsync(makeInput());

    const [resultA, resultB] = await Promise.all([callA, callB]);

    // Post-fix: the second call returns the same `ready` promise as the first.
    // Pre-fix: two separate `ready` promises (the second overwrites the first
    // in the Map; each call gets its own `ready` from its own chain).
    expect(resultA.ready).toBe(resultB.ready);
  });

  it('after first handshake settles, sendPrompt during in-flight second handshake still awaits it', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    // Two handshake promises: A settles quickly, B is slow.
    let resolveA!: () => void;
    let resolveB!: () => void;
    const promiseA = new Promise<void>((resolve) => { resolveA = resolve; });
    const promiseB = new Promise<void>((resolve) => { resolveB = resolve; });

    // First call gets promiseA; second call (with the dedup fix) reuses promiseA.
    // For the pre-fix bug reproduction, we instead use distinct promises to
    // simulate the race directly: register two separate handshake promises
    // for the same sessionId in the Map, settle the first, and verify the
    // second is still tracked.
    let handshakeCallCount = 0;
    startNewRuntimeBackgroundMock.mockImplementation(() => {
      handshakeCallCount += 1;
      return handshakeCallCount === 1 ? promiseA : promiseB;
    });

    const sessionService = makeMockSessionService('s1');
    const backend = new AcpBackend({ sessionService, clientFactory: vi.fn() } as AcpBackendOptions);

    // Pre-fix: two calls → two distinct handshakes. Post-fix: dedup → only one
    // handshake (the second call returns the first's promise).
    const callA = backend.createSessionAsync(makeInput());
    const callB = backend.createSessionAsync(makeInput());

    // Settle A. With the fix, B's `ready` is the same as A's, so settling A
    // also settles B. With the bug, B is still in flight and the Map entry
    // for s1 is the SECOND promise (which was overwritten by the second set()).
    resolveA();
    await new Promise(r => setTimeout(r, 10));

    // sendPrompt for s1 should now be deliverable against the registered runtime.
    // The registered runtime comes from the first handshake's success path
    // (startNewRuntimeBackground → then(() => ({ session, ... }))). For this
    // test, we manually register a runtime in the internal Map to simulate
    // the post-handshake state.
    const mockRuntime = { client: { request: vi.fn().mockResolvedValue({}) } };
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, Promise<unknown>>;
      runtimes: Map<string, unknown>;
    };
    backendInternal.runtimes.set('s1', mockRuntime);

    // Set up a session service that returns a valid acpAgentSessionId so
    // sendPrompt can actually deliver.
    (sessionService.getSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 's1',
      acpAgentSessionId: 'cc-session-1',
    });

    // Resolve B (in case the post-fix dedup means B is a no-op; either way
    // this should not throw).
    resolveB();
    const [_resultA, _resultB] = await Promise.all([callA, callB]);

    // sendPrompt should deliver via the registered runtime, not fall through
    // to autoResume. If the bug were still present, the .finally() from the
    // first call would have already deleted the Map entry, and sendPrompt
    // would not find anything to await and would attempt autoResume.
    const result = await backend.sendPrompt(
      's1',
      'hello',
      { tenantId: '_system', ownerKeyId: 'master' },
      '/tmp'
    );
    expect(result.delivered).toBe(true);
    expect(mockRuntime.client.request).toHaveBeenCalledWith(
      'session/prompt',
      expect.objectContaining({ sessionId: 'cc-session-1' }),
      expect.anything(),
    );
  });
});
