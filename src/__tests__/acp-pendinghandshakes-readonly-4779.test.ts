/**
 * Regression test for #4779: ReadonlyMap type-level tightening on
 * `pendingHandshakes`.
 *
 * Issue: The `pendingHandshakes` Map was typed `Map<...>` and exposed via
 * `PromptDeps`. Any future code path could mutate it from outside the module,
 * which would silently bypass the producer's invariants (the `.finally(() =>
 * delete)` cleanup is a producer-only contract — outside callers adding
 * entries would never get cleaned up).
 *
 * Fix: Tighten the type to `ReadonlyMap<...>`. Mutations (`.set` / `.delete`)
 * live only on a private internal field inside `AcpBackend`. External consumers
 * (PromptDeps and any test code) see the readonly view.
 *
 * The type-level invariant is enforced by tsc via `expectTypeOf`:
 *   - Pre-#4779:  `PromptDeps['pendingHandshakes']` is `Map<...>` which HAS
 *                  `.set`/`.delete`/`.clear` — so `not.toHaveProperty(...)`
 *                  type-level assertions fail (MismatchArgs require the
 *                  `Mismatch` literal, surfacing the failure at compile time).
 *   - Post-#4779: `PromptDeps['pendingHandshakes']` is `ReadonlyMap<...>` which
 *                  has NO `.set`/`.delete`/`.clear` — so the assertions pass.
 *
 * Vitest-runtime sanity (test 2) verifies the producer/consumer behavior is
 * unchanged by the type refactor.
 */
import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import type { PromptDeps } from '../services/acp/backend/prompts.js';
import type { AcpBackendOptions } from '../services/acp/backend.js';
import type { PendingHandshake } from '../services/acp/backend/types.js';

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

describe('#4779 — pendingHandshakes is type-level ReadonlyMap', () => {
  beforeEach(() => {
    startNewRuntimeBackgroundMock.mockReset();
  });

  it('PromptDeps.pendingHandshakes is ReadonlyMap (no public .set/.delete/.clear)', () => {
    type PendingMap = PromptDeps['pendingHandshakes'];

    // Primary invariant: it must NOT have public mutator methods.
    expectTypeOf<PendingMap>().not.toHaveProperty('set');
    expectTypeOf<PendingMap>().not.toHaveProperty('delete');
    expectTypeOf<PendingMap>().not.toHaveProperty('clear');

    // Read-only methods must still exist:
    expectTypeOf<PendingMap>().toHaveProperty('get');
    expectTypeOf<PendingMap>().toHaveProperty('has');
    expectTypeOf<PendingMap>().toHaveProperty('size');

    // Structural sanity: assignable to ReadonlyMap<string, PendingHandshake>.
    const _assignable: ReadonlyMap<string, PendingHandshake> = null as unknown as PendingMap;
    expect(_assignable).toBeNull();
  });

  it('AcpBackend exposes pendingHandshakes via PromptDeps; producer/consumer behavior unchanged', async () => {
    let resolveHandshake!: () => void;
    const handshakePromise = new Promise<void>((r) => { resolveHandshake = r; });
    startNewRuntimeBackgroundMock.mockReturnValue(handshakePromise);

    const { AcpBackend } = await import('../services/acp/backend.js');
    const sessionService = makeMockSessionService('s1');
    const backend = new AcpBackend({ sessionService, clientFactory: vi.fn() } as AcpBackendOptions);

    const backendInternal = backend as unknown as {
      getPromptDeps(): PromptDeps;
    };
    const deps = backendInternal.getPromptDeps();

    expect(deps.pendingHandshakes.size).toBe(0);
    expect(deps.pendingHandshakes.has('s1')).toBe(false);

    void backend.createSessionAsync(makeInput());
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(deps.pendingHandshakes.size).toBe(1);
    expect(deps.pendingHandshakes.has('s1')).toBe(true);

    const entry = deps.pendingHandshakes.get('s1');
    expect(entry).toBeDefined();
    expect(entry?.session.id).toBe('s1');
    expect(typeof entry?.backendRunId).toBe('string');

    resolveHandshake();
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(deps.pendingHandshakes.has('s1')).toBe(false);
    expect(deps.pendingHandshakes.size).toBe(0);
  });
});
