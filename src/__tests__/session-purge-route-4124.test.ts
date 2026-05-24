/**
 * Tests for Issue #4124: DELETE /v1/sessions/purge route
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const KILLED_SESSION_ID = '00000000-0000-4000-8000-000000000099';
const ACTIVE_SESSION_ID = '00000000-0000-4000-8000-000000000100';

function buildApp() {
  const killedSession = {
    id: KILLED_SESSION_ID,
    displayName: 'killed-session',
    workDir: '/tmp/test',
    status: 'killed',
    createdAt: Date.now() - 48 * 60 * 60 * 1000,
    lastActivity: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
    ownerKeyId: 'master',
  } as SessionInfo;

  const activeSession = {
    id: ACTIVE_SESSION_ID,
    displayName: 'active-session',
    workDir: '/tmp/test2',
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    ownerKeyId: 'master',
  } as SessionInfo;

  const purgeKilledMock = vi.fn(async (olderThanMs: number) => {
    // Simulate: killed session is 25h old, default threshold 24h
    const ageHours = olderThanMs / (60 * 60 * 1000);
    if (ageHours <= 25) return 1;
    return 0;
  });

  const sessions = {
    getSession: vi.fn((id: string) =>
      id === KILLED_SESSION_ID ? killedSession :
      id === ACTIVE_SESSION_ID ? activeSession : null
    ),
    listSessions: vi.fn(() => [killedSession, activeSession]),
    killSession: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    createSession: vi.fn(async () => {}),
    purgeKilled: purgeKilledMock,
  };

  const ctx = {
    sessions,
    auth: {
      authEnabled: true,
      getKey: vi.fn(() => ({ role: 'admin', permissions: ['create', 'kill'] })),
      check: vi.fn(() => ({ valid: true, keyId: 'master', permission: 'kill' })),
      getPermissions: vi.fn(() => ['create', 'kill'] as string[]),
      getRole: vi.fn(() => 'admin'),
    },
    config: {
      sseIdleMs: 30_000,
      sseClientTimeoutMs: 60_000,
      acpEnabled: false,
      envDenylist: [],
      envAdminAllowlist: [],
    },
    quotas: { checkSessionQuota: vi.fn(() => ({ allowed: true })) },
    metrics: { sessionCreated: vi.fn(), promptSent: vi.fn(), getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0, completed: 0, failed: 0 } })), cleanupSession: vi.fn() },
    monitor: { removeSession: vi.fn() },
    eventBus: { emitEnded: vi.fn() },
    channels: { sessionCreated: vi.fn(), sessionEnded: vi.fn(), statusChange: vi.fn() },
    memoryBridge: null,
    toolRegistry: { cleanupSession: vi.fn() },
    getAuditLogger: vi.fn(() => null),
    validateWorkDir: vi.fn(async (d: string) => d),
    acpBackend: null,
  } as unknown as RouteContext;

  const app = Fastify();
  app.addHook('onRequest', (req: any, _reply: any, done: any) => {
    req.authKeyId = 'master';
    req.tenantId = 'default';
    done();
  });

  registerSessionRoutes(app, ctx);

  return { app, sessions, purgeKilledMock };
}

describe('Issue #4124: DELETE /v1/sessions/purge', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let purgeKilledMock: ReturnType<typeof buildApp>['purgeKilledMock'];

  beforeEach(() => {
    const built = buildApp();
    app = built.app;
    purgeKilledMock = built.purgeKilledMock;
  });

  it('purges killed sessions with default 24h threshold', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/purge',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.purged).toBe(1);
    expect(body.olderThanHours).toBe(24);
    expect(purgeKilledMock).toHaveBeenCalledWith(24 * 60 * 60 * 1000);
  });

  it('purges with custom olderThanHours', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/purge?olderThanHours=2',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.olderThanHours).toBe(2);
    expect(purgeKilledMock).toHaveBeenCalledWith(2 * 60 * 60 * 1000);
  });

  it('rejects olderThanHours=0', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/purge?olderThanHours=0',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects olderThanHours > 8760', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/purge?olderThanHours=9000',
    });
    expect(res.statusCode).toBe(400);
  });
});
