/**
 * Tests for shutdownAcpRuntime helper (Issue #4294).
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { shutdownAcpRuntime } from '../session-cleanup.js';
import type { AppContext } from '../app-context.js';

function createMockCtx(overrides: Partial<{ hasAcpBackend: boolean; hasSession: boolean }> = {}): AppContext {
  const shutdownSession = vi.fn().mockResolvedValue({});
  return {
    acpBackend: overrides.hasAcpBackend === false ? null : {
      shutdownSession,
      getActiveRuntimeIds: () => ['s1'],
    } as unknown as AppContext['acpBackend'],
    sessions: {
      getSession: overrides.hasSession === false ? () => null : () => ({ id: 's1', tenantId: 't1', ownerKeyId: 'k1' }),
    } as unknown as AppContext['sessions'],
  } as unknown as AppContext;
}

describe('shutdownAcpRuntime', () => {
  it('does nothing when no acpBackend', async () => {
    const ctx = createMockCtx({ hasAcpBackend: false });
    // Should not throw
    await shutdownAcpRuntime('s1', ctx);
  });

  it('calls acpBackend.shutdownSession with session metadata', async () => {
    const ctx = createMockCtx({ hasAcpBackend: true, hasSession: true });
    await shutdownAcpRuntime('s1', ctx);
    expect((ctx.acpBackend as any).shutdownSession).toHaveBeenCalledWith({
      sessionId: 's1',
      tenantId: 't1',
      ownerKeyId: 'k1',
    });
  });

  it('falls back to SYSTEM_TENANT when session not found', async () => {
    const ctx = createMockCtx({ hasAcpBackend: true, hasSession: false });
    await shutdownAcpRuntime('s1', ctx);
    expect((ctx.acpBackend as any).shutdownSession).toHaveBeenCalledWith({
      sessionId: 's1',
      tenantId: '_system',
      ownerKeyId: 'master',
    });
  });

  it('does not throw on shutdown failure', async () => {
    const ctx = createMockCtx({ hasAcpBackend: true, hasSession: true });
    (ctx.acpBackend as any).shutdownSession.mockRejectedValue(new Error('boom'));
    // Should not throw — best-effort
    await expect(shutdownAcpRuntime('s1', ctx)).resolves.toBeUndefined();
  });
});
