import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const TENANT_A_SESSION = '00000000-0000-4000-8000-0000000000a1';
const TENANT_B_SESSION = '00000000-0000-4000-8000-0000000000b1';

function makeSession(id: string, tenantId: string): SessionInfo {
  return {
    id,
    tenantId,
    ownerKeyId: `${tenantId}-key`,
    displayName: `${tenantId}-session`,
    workDir: `C:\\work\\${tenantId}`,
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
  } as SessionInfo;
}

function buildApp() {
  const auditQueryResult = [
    { ts: new Date().toISOString(), actor: 'tenant-a-key', action: 'session.create', detail: 'tenant a', sessionId: TENANT_A_SESSION, tenantId: 'tenant-a' },
    { ts: new Date().toISOString(), actor: 'tenant-b-key', action: 'session.create', detail: 'tenant b', sessionId: TENANT_B_SESSION, tenantId: 'tenant-b' },
  ];
  const auditQuery = vi.fn(async () => auditQueryResult);
  const sessions = {
    listSessions: vi.fn(() => [
      makeSession(TENANT_A_SESSION, 'tenant-a'),
      makeSession(TENANT_B_SESSION, 'tenant-b'),
    ]),
    getSession: vi.fn(),
    findIdleSessionByWorkDir: vi.fn(async () => null),
    createSession: vi.fn(),
    sendInitialPrompt: vi.fn(),
    killSession: vi.fn(),
    save: vi.fn(),
    releaseSessionClaim: vi.fn(),
    getHealth: vi.fn(),
    getSummary: vi.fn(),
    getLatencyMetrics: vi.fn(),
    readTranscript: vi.fn(),
    readTranscriptCursor: vi.fn(),
    getPendingPermissionInfo: vi.fn(),
    getPendingQuestionInfo: vi.fn(),
  };
  const ctx = {
    sessions,
    auth: {
      authEnabled: true,
      getRole: vi.fn(() => 'admin'),
      getPermissions: vi.fn(() => ['create', 'kill']),
      getKey: vi.fn(() => null),
    },
    config: { acpEnabled: false, envDenylist: [], envAdminAllowlist: [] },
    quotas: { checkSessionQuota: vi.fn(() => ({ allowed: true })) },
    metrics: { sessionCreated: vi.fn(), promptSent: vi.fn(), sessionCompleted: vi.fn(), sessionFailed: vi.fn() },
    monitor: { removeSession: vi.fn() },
    eventBus: { emitEnded: vi.fn(), getEventsSince: vi.fn(() => []) },
    channels: { sessionCreated: vi.fn(), sessionEnded: vi.fn(), statusChange: vi.fn() },
    memoryBridge: null,
    toolRegistry: { cleanupSession: vi.fn(), getSessionTools: vi.fn(() => []), getToolDefinitions: vi.fn(() => []) },
    getAuditLogger: vi.fn(() => ({ log: vi.fn(), query: auditQuery })),
    validateWorkDir: vi.fn(async (dir: string) => dir),
    acpBackend: null,
    sseLimiter: { acquire: vi.fn(), release: vi.fn(), unregisterWriter: vi.fn() },
    requestKeyMap: new Map(),
    serverState: { draining: false },
    eventStore: { list: vi.fn(async () => []) },
  } as unknown as RouteContext;
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = 'tenant-admin';
    req.tenantId = 'tenant-a';
    req.authRole = 'admin';
  });
  registerSessionRoutes(app, ctx);
  return { app, auditQuery };
}

describe('GET /v1/sessions/history tenant scoping', () => {
  it('does not include audit or live sessions from another tenant', async () => {
    const { app, auditQuery } = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/v1/sessions/history' });

      expect(res.statusCode).toBe(200);
      expect(auditQuery).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a' }));
      const body = res.json() as { records: Array<{ id: string; tenantId?: string }> };
      expect(body.records).toEqual([
        expect.objectContaining({ id: TENANT_A_SESSION, tenantId: 'tenant-a' }),
      ]);
    } finally {
      await app.close();
    }
  });
});
