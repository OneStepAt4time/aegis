/**
 * fix-3860-3864.test.ts — Tests for Issues #3860 + #3864
 *
 * #3860: GET /v1/sessions/:id/status returns 404 (route never existed)
 * #3864: byteOffset stuck at 0 while monitorOffset advances
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSessionRoutes } from '../routes/sessions.js';
import { registerSessionDataRoutes } from '../routes/session-data.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-test-1',
    windowId: '@0',
    displayName: 'test-session',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 24594,
    status: 'working',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now() - 10_000,
    stallThresholdMs: 120_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    tenantId: '_system',
    ownerKeyId: 'master',
    ...overrides,
  } as SessionInfo;
}

function createMockContext(sessions: SessionInfo[] = []): RouteContext {
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) sessionMap.set(s.id, { ...s });

  return {
    sessions: {
      listSessions: vi.fn(() => [...sessionMap.values()]),
      getSession: vi.fn((id: string) => sessionMap.get(id) ?? null),
      readTranscript: vi.fn(async () => ({
        messages: [
          { role: 'user', contentType: 'text', text: 'hello', timestamp: new Date().toISOString() },
          { role: 'assistant', contentType: 'text', text: 'hi', timestamp: new Date().toISOString() },
        ],
        total: 2,
        page: 1,
        limit: 50,
        hasMore: false,
      })),
    } as unknown as RouteContext['sessions'],
    auth: {
      authEnabled: false,
      getRole: () => 'admin',
      getPermissions: () => [],
      hasPermission: () => true,
      validateToken: () => ({ valid: true, keyId: 'test' }),
    } as unknown as RouteContext['auth'],
    quotas: {} as RouteContext['quotas'],
    config: {} as RouteContext['config'],
    metrics: {} as RouteContext['metrics'],
    monitor: {} as RouteContext['monitor'],
    eventBus: {} as RouteContext['eventBus'],
    channels: {
      statusChange: vi.fn(async () => {}),
    } as unknown as RouteContext['channels'],
    jsonlWatcher: {} as RouteContext['jsonlWatcher'],
    pipelines: {} as RouteContext['pipelines'],
    toolRegistry: {} as RouteContext['toolRegistry'],
    getAuditLogger: () => undefined,
    alertManager: {} as RouteContext['alertManager'],
    sseLimiter: {} as RouteContext['sseLimiter'],
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: async () => '/tmp',
    serverState: { draining: false },
    metering: {} as RouteContext['metering'],
    metricsCache: {} as RouteContext['metricsCache'],
  } as RouteContext;
}

describe('Issue #3860: GET /v1/sessions/:id/status', () => {
  it('returns status for existing session', async () => {
    const session = makeSession({ id: 'status-test-1', status: 'working' });
    const ctx = createMockContext([session]);
    const app = Fastify();
    registerSessionRoutes(app, ctx);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/sessions/status-test-1/status',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe('status-test-1');
    expect(body.status).toBe('working');
    expect(body).toHaveProperty('lastActivity');

    await app.close();
  });

  it('returns 404 for non-existent session', async () => {
    const ctx = createMockContext([]);
    const app = Fastify();
    registerSessionRoutes(app, ctx);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent/status',
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });
});

describe('Issue #3864: Transcript endpoint', () => {
  it('returns transcript data for existing session', async () => {
    const session = makeSession({ id: 'transcript-test-1' });
    const ctx = createMockContext([session]);
    const app = Fastify();
    registerSessionDataRoutes(app, ctx);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/sessions/transcript-test-1/transcript',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(2);
    expect(body.total).toBe(2);

    await app.close();
  });
});
