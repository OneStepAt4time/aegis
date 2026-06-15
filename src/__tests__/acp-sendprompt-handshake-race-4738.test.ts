/**
 * Regression test for #4738: sendPrompt must await in-flight background handshake
 * from createSessionAsync before attempting autoResumeRuntime.
 *
 * Bug: createSessionAsync fires a background handshake (fire-and-forget). When
 * sendPrompt is called before the handshake completes, it doesn't find the runtime
 * and calls autoResumeRuntime, which issues session/resume on a CC process that
 * already has an active session → conflict → session enters failed state.
 *
 * Fix: sendPrompt checks pendingHandshakes map and awaits the in-flight handshake
 * before falling through to autoResumeRuntime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpBackendOptions } from '../services/acp/backend.js';

function makeMockSessionService(getSessionImpl?: (id: string) => Promise<unknown>) {
  return {
    getSession: getSessionImpl ?? vi.fn().mockResolvedValue({ id: 's1', acpAgentSessionId: null }),
    createSession: vi.fn(),
    attachAgentSession: vi.fn(),
    transition: vi.fn(),
    recordBackendRestart: vi.fn(),
  };
}

function makeBackendOptions(sessionService: ReturnType<typeof makeMockSessionService>): AcpBackendOptions {
  return { sessionService, clientFactory: vi.fn() } as AcpBackendOptions;
}

describe('#4738 — sendPrompt awaits in-flight background handshake', () => {
  it('returns no_acp_runtime when no handshake was started and no runtime exists', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');
    const sessionService = makeMockSessionService();
    const backend = new AcpBackend(makeBackendOptions(sessionService));

    const result = await backend.sendPrompt('s1', 'hello', { tenantId: '_system', ownerKeyId: 'master' }, '/tmp');
    expect(result.delivered).toBe(false);
    expect(result.error).toBe('no_acp_runtime');
  });

  it('avaits pending handshake before attempting autoResume', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    let handshakeResolve!: () => void;
    const handshakePromise = new Promise<void>((resolve) => { handshakeResolve = resolve; });
    const mockRuntime = { client: { request: vi.fn().mockResolvedValue({}) } };

    const sessionService = makeMockSessionService(
      vi.fn().mockResolvedValue({ id: 's1', acpAgentSessionId: 'cc-session-1' })
    );
    const backend = new AcpBackend(makeBackendOptions(sessionService));

    // Simulate: createSessionAsync registered a pending handshake
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, Promise<unknown>>;
      runtimes: Map<string, unknown>;
    };
    backendInternal.pendingHandshakes.set('s1', handshakePromise);

    // Start sendPrompt (it should block on the handshake)
    const sendPromise = backend.sendPrompt('s1', 'hello', { tenantId: '_system', ownerKeyId: 'master' }, '/tmp');

    // Give it a tick to ensure it's awaiting
    await new Promise(r => setTimeout(r, 10));

    // Now resolve the handshake and register the runtime
    backendInternal.runtimes.set('s1', mockRuntime);
    handshakeResolve();
    await handshakePromise;

    // sendPrompt should now use the registered runtime
    const result = await sendPromise;
    expect(result.delivered).toBe(true);
    expect(mockRuntime.client.request).toHaveBeenCalledWith(
      'session/prompt',
      expect.objectContaining({ sessionId: 'cc-session-1' }),
      expect.anything(),
    );
  });

  it('falls through to error when background handshake fails', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    const sessionService = makeMockSessionService();
    const backend = new AcpBackend(makeBackendOptions(sessionService));

    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, Promise<unknown>>;
      runtimes: Map<string, unknown>;
    };
    backendInternal.pendingHandshakes.set('s1', Promise.reject(new Error('handshake failed')));

    const result = await backend.sendPrompt('s1', 'hello', { tenantId: '_system', ownerKeyId: 'master' }, '/tmp');
    expect(result.delivered).toBe(false);
    expect(result.error).toBe('no_acp_runtime');
  });

  it('does not call autoResume when a handshake was recently in-flight', async () => {
    const { AcpBackend } = await import('../services/acp/backend.js');

    const mockRuntime = { client: { request: vi.fn().mockResolvedValue({}) } };
    const getSession = vi.fn().mockResolvedValue({ id: 's1', acpAgentSessionId: 'cc-1' });
    const sessionService = makeMockSessionService(getSession);
    const backend = new AcpBackend(makeBackendOptions(sessionService));

    // Simulate a completed handshake that registered the runtime
    const resolvedPromise = Promise.resolve();
    const backendInternal = backend as unknown as {
      pendingHandshakes: Map<string, Promise<unknown>>;
      runtimes: Map<string, unknown>;
    };
    backendInternal.pendingHandshakes.set('s1', resolvedPromise);
    backendInternal.runtimes.set('s1', mockRuntime);
    await resolvedPromise;

    // Remove from pendingHandshakes (as .finally() would do)
    backendInternal.pendingHandshakes.delete('s1');

    const result = await backend.sendPrompt('s1', 'hello', { tenantId: '_system', ownerKeyId: 'master' }, '/tmp');
    expect(result.delivered).toBe(true);
    // getSession should be called exactly once (by prompt delivery), NOT by autoResume.
    expect(getSession).toHaveBeenCalledTimes(1);
  });
});
