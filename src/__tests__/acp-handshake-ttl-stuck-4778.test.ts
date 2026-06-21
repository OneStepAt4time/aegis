/**
 * Issue #4778: handshake TTL with acp_handshake_stuck event.
 *
 * If a background handshake hangs, pendingHandshakes retains the entry
 * indefinitely. This adds a configurable TTL that fires an event and
 * removes the Map entry so downstream sendPrompt falls through to the
 * canonical error path instead of awaiting a dead promise forever.
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

describe('#4778 — handshake TTL emits acp_handshake_stuck and removes Map entry', () => {
  beforeEach(() => {
    startNewRuntimeBackgroundMock.mockReset();
  });

  it('handshake that never settled fires acp_handshake_stuck after TTL and removes Map entry', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    // Never-settling handshake.
    startNewRuntimeBackgroundMock.mockReturnValue(new Promise(() => {}));

    const onHandshakeStuck = vi.fn();
    const sessionService = makeMockSessionService('s1');
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      handshakeTimeoutMs: 50,
      onHandshakeStuck,
    } as AcpBackendOptions);

    backend.createSessionAsync(makeInput());

    // Wait for the TTL to fire.
    await new Promise((r) => setTimeout(r, 120));

    // Event should have been emitted with correct shape.
    expect(onHandshakeStuck).toHaveBeenCalledTimes(1);
    expect(onHandshakeStuck).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        backendRunId: expect.any(String),
        ageMs: expect.any(Number),
        lastKnownState: 'pending',
      })
    );

    // Map entry should be removed.
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.has('s1')).toBe(false);
  });

  it('handshake that settles BEFORE TTL does NOT emit acp_handshake_stuck', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    let resolveHandshake!: () => void;
    startNewRuntimeBackgroundMock.mockReturnValue(
      new Promise<void>((resolve) => { resolveHandshake = resolve; })
    );

    const onHandshakeStuck = vi.fn();
    const sessionService = makeMockSessionService('s2');
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      handshakeTimeoutMs: 200,
      onHandshakeStuck,
    } as AcpBackendOptions);

    const result = backend.createSessionAsync(makeInput());

    // Settle quickly (before 200ms TTL).
    resolveHandshake();
    await result;

    // Wait past the TTL to ensure no late event fires.
    await new Promise((r) => setTimeout(r, 300));

    expect(onHandshakeStuck).not.toHaveBeenCalled();

    // Map entry should also be gone (cleaned up by .finally()).
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.has('s2')).toBe(false);
  });

  it('default TTL is 60s when not overridden', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    startNewRuntimeBackgroundMock.mockReturnValue(new Promise(() => {}));

    const onHandshakeStuck = vi.fn();
    const sessionService = makeMockSessionService('s3');
    const backend = new AcpBackend({
      sessionService,
      clientFactory: vi.fn(),
      onHandshakeStuck,
    } as AcpBackendOptions);

    backend.createSessionAsync(makeInput());

    // Should NOT fire after 100ms (default is 60s).
    await new Promise((r) => setTimeout(r, 100));
    expect(onHandshakeStuck).not.toHaveBeenCalled();
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, unknown>;
    };
    expect(backendInternal.pendingHandshakes.has('s3')).toBe(true);
  });
});
