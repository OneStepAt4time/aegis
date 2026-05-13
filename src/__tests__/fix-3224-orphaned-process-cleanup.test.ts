/**
 * fix-3224-orphaned-process-cleanup.test.ts — Regression test for issue #3224.
 *
 * Ensures the single-session DELETE /v1/sessions/:id handler calls
 * acpBackend.shutdownSession() before sessions.killSession(), so the
 * underlying CC child process is terminated instead of becoming an orphan.
 *
 * Before the fix, only the bulk kill route called acpBackend.shutdownSession().
 * The single-session kill handler in session-actions.ts skipped it, leaving
 * orphaned claude-agent-acp processes consuming ~250MB RSS each.
 */

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { SYSTEM_TENANT } from '../config.js';
import { registerSessionActionRoutes } from '../routes/session-actions.js';
import type { RouteContext } from '../routes/context.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000322';
const NOW = 1_800_000_000_000;

function makeSession() {
  return {
    id: SESSION_ID,
    displayName: 'orphan-test',
    status: 'working',
    workDir: '/tmp/test',
    createdAt: NOW - 1_000,
    lastActivity: NOW,
    stallThresholdMs: 300_000,
    permissionMode: 'default',
  };
}

function buildApp(options: { acpEnabled?: boolean; shutdownRejects?: boolean } = {}) {
  const app = Fastify({ logger: false });
  const session = makeSession();

  const shutdownSession = options.shutdownRejects
    ? vi.fn(async () => { throw new Error('ACP not available'); })
    : vi.fn(async () => ({ session }));
  const killSession = vi.fn(async () => {});

  const acpBackend = options.acpEnabled !== false
    ? { shutdownSession }
    : undefined;

  app.addHook('onRequest', async (req) => {
    req.authKeyId = 'master';
    req.tenantId = SYSTEM_TENANT;
  });

  const ctx = {
    sessions: {
      getSession: vi.fn((id: string) => id === SESSION_ID ? session : undefined),
      killSession,
    },
    auth: { authEnabled: false },
    quotas: {},
    config: { acpEnabled: options.acpEnabled !== false, enforceSessionOwnership: true },
    metrics: { sessionFailed: vi.fn(), cleanupSession: vi.fn() },
    monitor: { removeSession: vi.fn() },
    eventBus: { emitEnded: vi.fn() },
    channels: { sessionEnded: vi.fn(async () => undefined) },
    toolRegistry: { cleanupSession: vi.fn() },
    getAuditLogger: () => undefined,
    acpBackend,
  } as unknown as RouteContext;

  registerSessionActionRoutes(app, ctx);
  return { app, shutdownSession, killSession };
}

describe('Issue #3224 — orphaned process cleanup on single-session kill', () => {
  it('calls acpBackend.shutdownSession() before sessions.killSession()', async () => {
    const { app, shutdownSession, killSession } = buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${SESSION_ID}`,
      });

      expect(response.json()).toEqual({ ok: true });

      // The critical assertion: shutdownSession must be called
      expect(shutdownSession).toHaveBeenCalledTimes(1);
      expect(shutdownSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID }),
      );

      // And killSession should also be called
      expect(killSession).toHaveBeenCalledTimes(1);
      expect(killSession).toHaveBeenCalledWith(SESSION_ID);

      // Order matters: shutdown before kill
      const shutdownOrder = shutdownSession.mock.invocationCallOrder[0];
      const killOrder = killSession.mock.invocationCallOrder[0];
      expect(shutdownOrder).toBeLessThan(killOrder);
    } finally {
      await app.close();
    }
  });

  it('still calls killSession even if acpBackend.shutdownSession() rejects', async () => {
    const { app, killSession } = buildApp({ shutdownRejects: true });
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${SESSION_ID}`,
      });

      // Should succeed despite shutdownSession rejecting (best-effort .catch())
      expect(killSession).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('skips acpBackend.shutdown when ACP is disabled', async () => {
    const { app, shutdownSession, killSession } = buildApp({ acpEnabled: false });
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${SESSION_ID}`,
      });

      // acpBackend is undefined when ACP disabled, so shutdownSession is never called
      expect(shutdownSession).not.toHaveBeenCalled();
      expect(killSession).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
