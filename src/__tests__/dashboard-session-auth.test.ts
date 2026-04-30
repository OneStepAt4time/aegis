import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { ApiKeyPermission, ApiKeyRole } from '../services/auth/index.js';
import {
  AuthManager,
  DASHBOARD_SESSION_COOKIE,
  DashboardSessionStore,
  getDashboardSessionAuthContext,
  type DashboardSession,
} from '../services/auth/index.js';
import { authenticateDashboardSessionCookie } from '../dashboard-session-auth.js';
import { isGlobalEventVisibleToRequest } from '../routes/events.js';
import { requirePermission, requireRole, withOwnership } from '../routes/context.js';
import type { SessionInfo, SessionManager } from '../session.js';

function decorateAuthRequest(app: FastifyInstance): void {
  app.decorateRequest('authKeyId', null as unknown as string);
  app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
  app.decorateRequest('authRole', null as unknown as ApiKeyRole);
  app.decorateRequest('authPermissions', null as unknown as ApiKeyPermission[]);
  app.decorateRequest('authActor', null as unknown as string);
  app.decorateRequest('tenantId', undefined as unknown as string);
}

function createDashboardSession(role: ApiKeyRole, sessionId: string): DashboardSession {
  const store = new DashboardSessionStore(() => 1_000, () => sessionId);
  return store.create({
    userId: `user-${role}`,
    tenantId: 'default',
    role,
    claims: { sub: `user-${role}` },
  });
}

function makeSession(id: string, ownerKeyId: string, tenantId = 'default'): SessionInfo {
  return {
    id,
    windowId: `window-${id}`,
    windowName: id,
    workDir: '/tmp/default/project',
    status: 'idle',
    createdAt: 1,
    lastActivity: 1,
    ownerKeyId,
    tenantId,
  } as SessionInfo;
}

async function createApp(
  dashboardSession: DashboardSession,
  sessionMap: Map<string, SessionInfo> = new Map(),
): Promise<{ app: FastifyInstance; auth: AuthManager }> {
  const app = Fastify({ logger: false });
  await app.register(fastifyRateLimit, {
    global: true,
    keyGenerator: (req) => req.ip ?? 'unknown',
    max: 600,
    timeWindow: '1 minute',
  });
  decorateAuthRequest(app);
  const auth = new AuthManager('/tmp/aegis-test-keys.json', '', 'default');
  auth.setHost('0.0.0.0');

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const hasBearer = req.headers.authorization?.startsWith('Bearer ');
    if (!hasBearer && path.startsWith('/v1/')) {
      const context = authenticateDashboardSessionCookie(req, {
        getSession: (sessionId: string | undefined) => sessionId === dashboardSession.sessionId ? dashboardSession : null,
      });
      if (!context) {
        return reply.status(401).send({ error: 'Unauthorized - Bearer token required' });
      }
    }
  });

  app.get('/v1/protected-create', async (req, reply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    return {
      keyId: req.authKeyId,
      role: req.authRole,
      tenantId: req.tenantId,
      matchedPermission: req.matchedPermission,
    };
  });

  app.get('/v1/admin-only', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;
    return { ok: true, role: req.authRole };
  });

  app.get('/v1/events', async (req) => ({ ok: true, keyId: req.authKeyId }));

  const sessions = {
    getSession: (id: string) => sessionMap.get(id) ?? null,
  } as SessionManager;

  app.get('/v1/owned/:id', withOwnership(sessions, async (_req, _reply, session) => ({ ok: true, sessionId: session.id })));

  await app.ready();
  return { app, auth };
}

function cookieHeader(sessionId: string): string {
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`;
}

describe('dashboard session cookie request auth', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('authenticates same-origin /v1 and SSE requests without exposing a bearer API key', async () => {
    const dashboardSession = createDashboardSession('viewer', 'dashboard-session-viewer');
    const created = await createApp(dashboardSession);
    app = created.app;

    const response = await app.inject({
      method: 'GET',
      url: '/v1/protected-create',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { keyId: string; role: ApiKeyRole; tenantId: string; matchedPermission: ApiKeyPermission };
    expect(body).toMatchObject({ role: 'viewer', tenantId: 'default', matchedPermission: 'create' });
    expect(body.keyId).toMatch(/^dashboard:default:[a-f0-9]{32}$/);
    expect(created.auth.validate(body.keyId).valid).toBe(false);

    const adminOnly = await app.inject({
      method: 'GET',
      url: '/v1/admin-only',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });
    expect(adminOnly.statusCode).toBe(403);

    const sseLike = await app.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });
    expect(sseLike.statusCode).toBe(200);
    expect(sseLike.json()).toMatchObject({ keyId: body.keyId });
  });

  it('authorizes sessions owned by the same dashboard user and denies other owners', async () => {
    const dashboardSession = createDashboardSession('viewer', 'dashboard-session-owner');
    const context = getDashboardSessionAuthContext(dashboardSession);
    const sessionMap = new Map<string, SessionInfo>([
      ['owned', makeSession('owned', context.keyId)],
      ['other', makeSession('other', 'api-key-other')],
    ]);
    const created = await createApp(dashboardSession, sessionMap);
    app = created.app;

    const owned = await app.inject({
      method: 'GET',
      url: '/v1/owned/owned',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });
    expect(owned.statusCode).toBe(200);

    const other = await app.inject({
      method: 'GET',
      url: '/v1/owned/other',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });
    expect(other.statusCode).toBe(403);
  });

  it('lets dashboard admin role bypass ownership within its tenant only', async () => {
    const dashboardSession = createDashboardSession('admin', 'dashboard-session-admin');
    const sessionMap = new Map<string, SessionInfo>([
      ['other-owner', makeSession('other-owner', 'api-key-other')],
      ['other-tenant', makeSession('other-tenant', 'api-key-other', 'other-tenant')],
    ]);
    const created = await createApp(dashboardSession, sessionMap);
    app = created.app;

    const sameTenant = await app.inject({
      method: 'GET',
      url: '/v1/owned/other-owner',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });
    expect(sameTenant.statusCode).toBe(200);

    const otherTenant = await app.inject({
      method: 'GET',
      url: '/v1/owned/other-tenant',
      headers: { cookie: cookieHeader(dashboardSession.sessionId) },
    });
    expect(otherTenant.statusCode).toBe(403);
  });

  it('filters global SSE events for tenant-scoped dashboard sessions', () => {
    const dashboardSession = createDashboardSession('viewer', 'dashboard-session-events');
    const context = getDashboardSessionAuthContext(dashboardSession);
    const sessionMap = new Map<string, SessionInfo>([
      ['same-tenant', makeSession('same-tenant', context.keyId)],
      ['other-tenant', makeSession('other-tenant', 'api-key-other', 'other-tenant')],
    ]);
    const sessions = {
      getSession: (id: string) => sessionMap.get(id) ?? null,
    } as Pick<SessionManager, 'getSession'>;

    expect(isGlobalEventVisibleToRequest({
      event: 'session_message',
      sessionId: 'same-tenant',
      timestamp: '2026-04-30T00:00:00.000Z',
      data: { text: 'visible' },
    }, sessions, context.tenantId, true)).toBe(true);

    expect(isGlobalEventVisibleToRequest({
      event: 'session_message',
      sessionId: 'other-tenant',
      timestamp: '2026-04-30T00:00:00.000Z',
      data: { text: 'hidden' },
    }, sessions, context.tenantId, true)).toBe(false);

    expect(isGlobalEventVisibleToRequest({
      event: 'session_message',
      sessionId: 'missing',
      timestamp: '2026-04-30T00:00:00.000Z',
      data: { text: 'hidden' },
    }, sessions, context.tenantId, true)).toBe(false);

    expect(isGlobalEventVisibleToRequest({
      event: 'shutdown',
      sessionId: '',
      timestamp: '2026-04-30T00:00:00.000Z',
      data: {},
    }, sessions, context.tenantId, true)).toBe(true);
  });
});
