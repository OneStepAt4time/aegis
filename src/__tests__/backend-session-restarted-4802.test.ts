/**
 * backend-session-restarted-4802.test.ts — Issue #4802 (Themis F-3 finding).
 *
 * The /goal driver (and any other push-based subscriber) cannot detect that a
 * restart has completed, because:
 *
 *   1. recordBackendRestart only updates currentBackendRunId + updatedAt
 *   2. transitionIfInitializing is short-circuited (status !== 'initializing')
 *   3. retryWithJitter is fire-and-forget; it only logs success
 *
 * Themis recommended: emit a `session_restarted` (or `backend.restarted`) event
 * after startResumeRuntime completes successfully. Payload: typed metadata
 * only, no transcript, scoped to session.tenantId + session.ownerKeyId.
 *
 * Required behavior after this PR:
 * 1. AcpBackendOptions gains onSessionRestarted callback (typed payload)
 * 2. restartSession invokes the callback on success with:
 *    { sessionId, scope: { tenantId, ownerKeyId }, backendRunId, recoveryReason }
 * 3. The callback is NOT invoked on failure (throw from recordBackendRestart
 *    or startResumeRuntime propagates unchanged)
 * 4. Existing onRestartBackoff is unchanged
 */

import { describe, it, expect, vi } from 'vitest';
import { AcpBackend } from '../services/acp/backend.js';
import type {
  AcpBackendOptions,
  AcpBackendSessionService,
  AcpBackendClient,
  AcpBackendClientFactoryContext,
} from '../services/acp/backend.js';
import type { AcpSessionRecord } from '../services/acp/types.js';

/** Minimal fake AcpBackendClient for AcpBackend construction. */
function makeClient(): AcpBackendClient {
  const exitListeners = new Set<(exit: { code: number | null; signal: NodeJS.Signals | null; expected: boolean; escalated: boolean }) => void>();
  return {
    start: vi.fn(async () => undefined),
    request: vi.fn(async <T>(method: string) => {
      // Stub default responses needed by startResumeRuntime: initialize + session/resume
      if (method === 'initialize') return { jsonrpc: '2.0', id: 'init', result: {} };
      if (method === 'session/resume') return { jsonrpc: '2.0', id: 'resume', result: { sessionId: 'acp-1' } };
      return { jsonrpc: '2.0', id: method, result: {} as T };
    }),
    notify: vi.fn(async () => undefined),
    respond: vi.fn(async () => undefined),
    respondWithError: vi.fn(async () => undefined),
    onNotification: vi.fn(() => () => undefined),
    onRequest: vi.fn(() => () => undefined),
    onExit: vi.fn((listener: typeof exitListeners extends Set<infer L> ? L : never) => {
      exitListeners.add(listener);
      return () => { exitListeners.delete(listener); };
    }),
    onError: vi.fn(() => () => undefined),
    shutdown: vi.fn(async () => ({
      code: 0, signal: null, expected: true, escalated: false,
    })),
  } as unknown as AcpBackendClient;
}

function makeSession(overrides: Partial<AcpSessionRecord> = {}): AcpSessionRecord {
  return {
    id: 'sess-1',
    durableSessionId: 'sess-1',
    backendRunId: 'run-orig',
    acpAgentSessionId: 'acp-1',
    scope: { tenantId: 'tenant-A', ownerKeyId: 'master' },
    status: 'ready',
    cwd: '/tmp/test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as unknown as AcpSessionRecord;
}

function makeSessionService(record: AcpSessionRecord): AcpBackendSessionService {
  return {
    getSession: vi.fn(async () => record),
    createSession: vi.fn(async () => record),
    attachAgentSession: vi.fn(async () => record),
    transition: vi.fn(async () => record),
    recordBackendRestart: vi.fn(async (_sid, _scope, backendRunId) => ({
      ...record,
      backendRunId: backendRunId ?? 'run-new',
    })),
  } as unknown as AcpBackendSessionService;
}

function makeBackend(
  record: AcpSessionRecord,
  overrides: Partial<AcpBackendOptions> = {}
): { backend: AcpBackend; client: AcpBackendClient; sessionService: AcpBackendSessionService } {
  const sessionService = makeSessionService(record);
  const client = makeClient();
  const clientFactory = (_ctx: AcpBackendClientFactoryContext): AcpBackendClient => client;
  const backend = new AcpBackend({
    sessionService,
    clientFactory,
    backendRunIdProvider: () => 'run-new-1',
    ...overrides,
  });
  return { backend, client, sessionService };
}

describe('Issue #4802 (F-3): session_restarted event on successful restart', () => {
  it('invokes onSessionRestarted callback after successful restartSession', async () => {
    const record = makeSession();
    const onSessionRestarted = vi.fn();
    const { backend } = makeBackend(record, { onSessionRestarted });

    await backend.restartSession({
      sessionId: record.id,
      ...(record as unknown as { scope: { tenantId: string; ownerKeyId: string } }).scope,
      cwd: (record as unknown as { cwd: string }).cwd,
      reason: 'rate_limit_retry_1',
    });

    expect(onSessionRestarted).toHaveBeenCalledTimes(1);
    const event = onSessionRestarted.mock.calls[0]?.[0];
    expect(event).toBeDefined();
    expect(event.sessionId).toBe(record.id);
    expect(event.scope.tenantId).toBe('tenant-A');
    expect(event.scope.ownerKeyId).toBe('master');
    expect(event.backendRunId).toBe('run-new-1');
    expect(event.recoveryReason).toBe('rate_limit_retry_1');
  });

  it('does NOT invoke onSessionRestarted when recordBackendRestart throws', async () => {
    const record = makeSession();
    const onSessionRestarted = vi.fn();
    const sessionService: AcpBackendSessionService = {
      getSession: vi.fn(async () => record),
      createSession: vi.fn(async () => record),
      attachAgentSession: vi.fn(async () => record),
      transition: vi.fn(async () => record),
      recordBackendRestart: vi.fn(async () => {
        throw new Error('DB write failed');
      }),
    } as unknown as AcpBackendSessionService;

    const backend = new AcpBackend({
      sessionService,
      clientFactory: () => makeClient(),
      backendRunIdProvider: () => 'run-new-1',
      onSessionRestarted,
    });

    await expect(backend.restartSession({
      sessionId: record.id,
      ...(record as unknown as { scope: { tenantId: string; ownerKeyId: string } }).scope,
      cwd: (record as unknown as { cwd: string }).cwd,
      reason: 'rate_limit_retry_1',
    })).rejects.toThrow('DB write failed');

    expect(onSessionRestarted).not.toHaveBeenCalled();
  });

  it('does NOT invoke onSessionRestarted when startResumeRuntime throws', async () => {
    const record = makeSession();
    const onSessionRestarted = vi.fn();
    const sessionService: AcpBackendSessionService = {
      getSession: vi.fn(async () => record),
      createSession: vi.fn(async () => record),
      attachAgentSession: vi.fn(async () => {
        throw new Error('session/resume failed');
      }),
      transition: vi.fn(async () => record),
      recordBackendRestart: vi.fn(async (_sid, _scope, backendRunId) => ({
        ...record,
        backendRunId: backendRunId ?? 'run-new',
      })),
    } as unknown as AcpBackendSessionService;

    const backend = new AcpBackend({
      sessionService,
      clientFactory: () => makeClient(),
      backendRunIdProvider: () => 'run-new-1',
      onSessionRestarted,
    });

    await expect(backend.restartSession({
      sessionId: record.id,
      ...(record as unknown as { scope: { tenantId: string; ownerKeyId: string } }).scope,
      cwd: (record as unknown as { cwd: string }).cwd,
      reason: 'stall_recovery_jsonl',
    })).rejects.toThrow('session/resume failed');

    expect(onSessionRestarted).not.toHaveBeenCalled();
  });

  it('is a no-op when onSessionRestarted is not provided (back-compat)', async () => {
    const record = makeSession();
    const { backend } = makeBackend(record);

    // Should not throw when callback is omitted
    await expect(backend.restartSession({
      sessionId: record.id,
      ...(record as unknown as { scope: { tenantId: string; ownerKeyId: string } }).scope,
      cwd: (record as unknown as { cwd: string }).cwd,
      reason: 'rate_limit_retry_1',
    })).resolves.toBeDefined();
  });

  it('preserves onRestartBackoff semantics (existing behavior unchanged)', async () => {
    const record = makeSession();
    const onRestartBackoff = vi.fn();
    const onSessionRestarted = vi.fn();
    const { backend } = makeBackend(record, { onRestartBackoff, onSessionRestarted });

    await backend.restartSession({
      sessionId: record.id,
      ...(record as unknown as { scope: { tenantId: string; ownerKeyId: string } }).scope,
      cwd: (record as unknown as { cwd: string }).cwd,
      reason: 'rate_limit_retry_1',
    });

    // Both fire — restartBackoff before, sessionRestarted after
    expect(onRestartBackoff).toHaveBeenCalledTimes(1);
    expect(onSessionRestarted).toHaveBeenCalledTimes(1);
  });
});
