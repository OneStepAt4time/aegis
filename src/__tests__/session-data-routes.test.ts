/**
 * session-data-routes.test.ts — Route-level tests for session data endpoints.
 *
 * Covers:
 *   GET /v1/sessions/:id/transcript — pagination, role filter, error cases
 *   GET /v1/sessions/:id/summary   — happy path and error cases
 *
 * Not duplicated here (covered by other test files):
 *   GET /v1/sessions/:id/read   → session-read-404-2539.test.ts
 *   GET /v1/sessions/:id/export → session-export-3114.test.ts
 *   GET /v1/sessions/:id/events → route-aliases-2461.test.ts
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSessionDataRoutes } from '../routes/session-data.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = 'aa000001-data-4000-8000-000000000000';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'data-route-test',
    workDir: '/tmp/data-route-test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

function buildApp() {
  const session = makeSession();
  const sessions = {
    getSession: vi.fn((id: string) => (id === SESSION_ID ? session : undefined)),
    readTranscript: vi.fn(async (_id: string, page: number, limit: number, _role?: string) => ({
      messages: [{ role: 'user', contentType: 'text', text: 'hello world' }],
      total: 1,
      page,
      limit,
      hasMore: false,
    })),
    getSummary: vi.fn(async () => ({ summary: 'The session did useful work', sessionId: SESSION_ID })),
    getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    listSessions: vi.fn(() => [session]),
  };

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.authKeyId = null;
    req.tenantId = undefined;
  });

  const ctx = {
    sessions,
    auth: { authEnabled: false },
    config: { sseIdleMs: 30_000, sseClientTimeoutMs: 60_000 },
    metrics: {
      getSessionMetrics: vi.fn(() => null),
      getSessionLatency: vi.fn(() => ({})),
      recordPermissionResponse: vi.fn(),
    },
    monitor: {},
    eventBus: {
      subscribe: vi.fn(() => vi.fn()),
      emitStatus: vi.fn(),
      emitVerification: vi.fn(),
      emitApproval: vi.fn(),
      getEventsSince: vi.fn(() => []),
    },
    channels: { statusChange: vi.fn(async () => {}) },
    toolRegistry: {
      getSessionTools: vi.fn(() => []),
      processEntries: vi.fn(),
      getToolDefinitions: vi.fn(() => []),
    },
    sseLimiter: {
      acquire: vi.fn(() => ({ allowed: false, reason: 'per_ip_limit', current: 1, limit: 1 })),
      release: vi.fn(),
      unregisterWriter: vi.fn(),
    },
  } as unknown as RouteContext;

  registerSessionDataRoutes(app, ctx);
  return { app, sessions, session };
}

describe('GET /v1/sessions/:id/transcript', () => {
  let app: ReturnType<typeof Fastify>;
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns transcript entries for an existing session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].text).toBe('hello world');
    expect(sessions.readTranscript).toHaveBeenCalledWith(SESSION_ID, 1, 50, undefined);
  });

  it('passes page and limit query params to readTranscript', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript?page=3&limit=20`,
    });

    expect(response.statusCode).toBe(200);
    expect(sessions.readTranscript).toHaveBeenCalledWith(SESSION_ID, 3, 20, undefined);
  });

  it('passes role filter to readTranscript', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript?role=assistant`,
    });

    expect(response.statusCode).toBe(200);
    expect(sessions.readTranscript).toHaveBeenCalledWith(SESSION_ID, 1, 50, 'assistant');
  });

  it('returns 400 when role filter value is not allowed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript?role=unknown`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Invalid role filter: unknown');
  });

  it('returns 404 when session does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent-session-id/transcript',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Session not found');
    expect(sessions.readTranscript).not.toHaveBeenCalled();
  });

  it('returns 404 when readTranscript throws', async () => {
    sessions.readTranscript.mockRejectedValueOnce(new Error('transcript file missing'));

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('transcript file missing');
  });
});

describe('GET /v1/sessions/:id/summary', () => {
  let app: ReturnType<typeof Fastify>;
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns session summary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/summary`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary).toBe('The session did useful work');
    expect(body.sessionId).toBe(SESSION_ID);
    expect(sessions.getSummary).toHaveBeenCalledWith(SESSION_ID);
  });

  it('returns 404 when session does not exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent/summary',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Session not found');
    expect(sessions.getSummary).not.toHaveBeenCalled();
  });

  it('returns 404 when getSummary throws', async () => {
    sessions.getSummary.mockRejectedValueOnce(new Error('No summary available for this session'));

    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/summary`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('No summary available for this session');
  });
});
