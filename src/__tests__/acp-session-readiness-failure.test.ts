import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = '00000000-0000-4000-8000-0000000000ac';

function buildApp() {
  const sessionMap = new Map<string, SessionInfo>();
  const sessions = {
    listSessions: vi.fn(() => Array.from(sessionMap.values())),
    getSession: vi.fn((id: string) => sessionMap.get(id)),
    createSession: vi.fn(async (opts: { id?: string; workDir: string; tenantId?: string; ownerKeyId?: string }) => {
      const session = {
        id: opts.id ?? SESSION_ID,
        tenantId: opts.tenantId,
        ownerKeyId: opts.ownerKeyId,
        displayName: 'ACP readiness failure',
        workDir: opts.workDir,
        byteOffset: 0,
        monitorOffset: 0,
        status: 'idle',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        stallThresholdMs: 300_000,
        permissionStallMs: 300_000,
        permissionMode: 'default',
      } as SessionInfo;
      sessionMap.set(session.id, session);
      return session;
    }),
    save: vi.fn(async () => {}),
    findIdleSessionByWorkDir: vi.fn(async () => null),
    sendInitialPrompt: vi.fn(),
    killSession: vi.fn(),
    releaseSessionClaim: vi.fn(),
    getHealth: vi.fn(),
    getSummary: vi.fn(),
    getLatencyMetrics: vi.fn(),
    readTranscript: vi.fn(),
    readTranscriptCursor: vi.fn(),
    getPendingPermissionInfo: vi.fn(),
    getPendingQuestionInfo: vi.fn(),
  };
  const failingReady = {
    then: (onfulfilled?: (value: never) => unknown, onrejected?: (reason: unknown) => unknown) =>
      Promise.reject(new Error('runtime failed')).then(onfulfilled, onrejected),
  } as Promise<never>;
  const acpBackend = {
    createSessionAsync: vi.fn(async () => ({
      session: {
        id: SESSION_ID,
        tenantId: '_system',
        ownerKeyId: 'master',
        conversationId: 'conv-1',
        transcriptId: 'trans-1',
        status: 'initializing' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      initializeResult: {},
      backendRunId: 'run-failed',
      ready: failingReady,
    })),
    sendPrompt: vi.fn(),
    shutdownSession: vi.fn(),
  };
  const ctx = {
    sessions,
    auth: { authEnabled: false, getKey: vi.fn(() => null), getRole: vi.fn(() => 'admin'), getPermissions: vi.fn(() => ['create']) },
    config: { acpEnabled: true, envDenylist: [], envAdminAllowlist: [], tenantWorkdirs: {} },
    quotas: { checkSessionQuota: vi.fn(() => ({ allowed: true })) },
    metrics: { sessionCreated: vi.fn(), promptSent: vi.fn(), sessionCompleted: vi.fn(), sessionFailed: vi.fn() },
    monitor: { removeSession: vi.fn() },
    eventBus: { emitEnded: vi.fn(), getEventsSince: vi.fn(() => []) },
    channels: { sessionCreated: vi.fn(), sessionEnded: vi.fn(), statusChange: vi.fn() },
    memoryBridge: null,
    toolRegistry: { cleanupSession: vi.fn(), getSessionTools: vi.fn(() => []), getToolDefinitions: vi.fn(() => []) },
    getAuditLogger: vi.fn(() => undefined),
    validateWorkDir: vi.fn(async (dir: string) => dir),
    acpBackend,
    sseLimiter: { acquire: vi.fn(), release: vi.fn(), unregisterWriter: vi.fn() },
    requestKeyMap: new Map(),
    serverState: { draining: false },
    eventStore: { list: vi.fn(async () => []) },
  } as unknown as RouteContext;
  const app = Fastify({ logger: false });
  registerSessionRoutes(app, ctx);
  return { app, sessions, acpBackend };
}

describe('POST /v1/sessions ACP readiness failure', () => {
  it('marks the local REST session failed when readiness rejects before prompt delivery', async () => {
    const { app, sessions, acpBackend } = buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        payload: { prompt: 'hello', workDir: process.cwd() },
      });

      expect(res.statusCode).toBe(500);
      expect(acpBackend.sendPrompt).not.toHaveBeenCalled();
      expect(sessions.getSession(SESSION_ID)).toMatchObject({
        status: 'error',
        latestActivityText: 'Agent runtime failed',
      });
    } finally {
      await app.close();
    }
  });
});
