/**
 * fix-4691-orphaned-acp-processes.test.ts — Regression test for issue #4691.
 *
 * Ensures:
 * 1. The orphan reaper excludes terminal sessions (killed, completed, crashed)
 *    from getActiveSessionIds, so orphaned ACP runtimes for killed sessions
 *    are detected and reaped.
 * 2. shutdownRuntime catches session/close request failures and still proceeds
 *    to client.shutdown(), preventing orphaned child processes when the ACP
 *    bridge is unresponsive.
 */

import { describe, expect, it, vi } from 'vitest';
import { reapOrphanAcpRuntimes } from '../services/acp/orphan-reaper.js';
import { shutdownRuntime } from '../services/acp/backend/runtime.js';
import type { AcpBackendRuntime, RuntimeLifecycleDeps } from '../services/acp/backend/runtime.js';
import type { AcpSessionRecord } from '../services/acp/backend.js';

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('Issue #4691 — orphaned claude-agent-acp processes after session kill', () => {
  describe('orphan reaper excludes terminal sessions', () => {
    it('reaps ACP runtime for a killed session', async () => {
      const shutdownAcpRuntime = vi.fn(async () => {});
      const result = await reapOrphanAcpRuntimes({
        getActiveSessionIds: () => ['sess-active'],
        getActiveAcpRuntimeIds: () => ['sess-active', 'sess-killed'],
        shutdownAcpRuntime,
        log,
      });

      expect(result.scanned).toBe(2);
      expect(result.reaped).toBe(1);
      expect(result.orphanIds).toEqual(['sess-killed']);
      expect(shutdownAcpRuntime).toHaveBeenCalledWith('sess-killed');
    });

    it('does NOT reap runtime for an active session', async () => {
      const shutdownAcpRuntime = vi.fn(async () => {});
      const result = await reapOrphanAcpRuntimes({
        getActiveSessionIds: () => ['sess-active'],
        getActiveAcpRuntimeIds: () => ['sess-active'],
        shutdownAcpRuntime,
        log,
      });

      expect(result.scanned).toBe(1);
      expect(result.reaped).toBe(0);
      expect(result.orphanIds).toEqual([]);
      expect(shutdownAcpRuntime).not.toHaveBeenCalled();
    });
  });

  describe('shutdownRuntime catches session/close failure', () => {
    it('still calls client.shutdown() when session/close request throws', async () => {
      const session = {
        id: 'sess-1',
        status: 'closing',
        tenantId: 'SYSTEM',
        ownerKeyId: 'master',
        acpAgentSessionId: 'acp-sess-1',
      } as AcpSessionRecord;

      const shutdown = vi.fn(async () => ({ code: 0, signal: null }));
      const request = vi.fn(async () => {
        throw new Error('session/close timeout');
      });
      const client = { request, shutdown };

      const runtime = {
        sessionId: 'sess-1',
        scope: { tenantId: 'SYSTEM', ownerKeyId: 'master' },
        backendRunId: 'run-1',
        client,
        disposers: [],
      } as AcpBackendRuntime;

      const deps = {
        sessionService: {
          transition: vi.fn(async (_id, _scope, transition) => ({ ...session, status: transition.type === 'close_completed' ? 'closed' : 'closing' })),
          getSession: vi.fn(async () => session),
        },
        options: {},
        runtimes: new Map(),
        inFlightPrompts: new Map(),
        pendingApprovals: new Map(),
      } as unknown as RuntimeLifecycleDeps;

      const result = await shutdownRuntime(deps, session, runtime);

      expect(request).toHaveBeenCalledWith('session/close', { sessionId: 'acp-sess-1' });
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(deps.runtimes.has('sess-1')).toBe(false);
      expect(result.session).toBeDefined();
    });

    it('returns successfully even if both session/close and shutdown throw', async () => {
      const session = {
        id: 'sess-2',
        status: 'closing',
        tenantId: 'SYSTEM',
        ownerKeyId: 'master',
        acpAgentSessionId: 'acp-sess-2',
      } as AcpSessionRecord;

      const client = {
        request: vi.fn(async () => { throw new Error('close failed'); }),
        shutdown: vi.fn(async () => { throw new Error('shutdown failed'); }),
      };

      const runtime = {
        sessionId: 'sess-2',
        scope: { tenantId: 'SYSTEM', ownerKeyId: 'master' },
        backendRunId: 'run-2',
        client,
        disposers: [],
      } as AcpBackendRuntime;

      const deps = {
        sessionService: {
          transition: vi.fn(async () => session),
          getSession: vi.fn(async () => session),
        },
        options: {},
        runtimes: new Map([['sess-2', runtime]]),
        inFlightPrompts: new Map(),
        pendingApprovals: new Map(),
      } as unknown as RuntimeLifecycleDeps;

      const result = await shutdownRuntime(deps, session, runtime);
      expect(result.session).toBeDefined();
      expect(deps.runtimes.has('sess-2')).toBe(false);
    });
  });
});
