/**
 * session-actions-routes.test.ts — Route-level tests for session action endpoints.
 *
 * Covers cases NOT already tested elsewhere:
 *   POST /v1/sessions/:id/send      — invalid body (400), session not found (404), delivered=false
 *   POST /v1/sessions/:id/interrupt — happy path, session not found (404)
 *   DELETE /v1/sessions/:id         — already-terminated (404), session not found (404)
 *
 * Not duplicated here (covered by other test files):
 *   send happy path + 403          → per-action-rbac-1922.test.ts
 *   kill 403                       → per-action-rbac-1922.test.ts
 *   kill with ACP cleanup          → fix-3224-orphaned-process-cleanup.test.ts
 *   GET /v1/sessions/:id/read      → session-read-404-2539.test.ts
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file: string, _args: string[], _opts: unknown, cb?: (err: Error | null) => void) => {
    cb?.(new Error('claude unavailable in tests'));
  }),
}));

import { registerSessionActionRoutes } from '../routes/session-actions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = 'ac000001-actn-4000-8000-000000000000';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'action-route-test',
    workDir: '/tmp/action-route-test',
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

function buildApp(session: SessionInfo | null) {
  const sessions = {
    getSession: vi.fn((id: string) => (id === SESSION_ID && session ? session : undefined)),
    sendMessage: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    interrupt: vi.fn(async () => {}),
    killSession: vi.fn(async () => {}),
    escape: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    readMessagesFromSession: vi.fn(async () => ({ messages: [], status: 'idle', statusText: null, interactiveContent: null })),
    submitAnswer: vi.fn(() => true),
    save: vi.fn(async () => {}),
    sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
    listSessions: vi.fn(() => (session ? [session] : [])),
    releaseSessionClaim: vi.fn(),
  };

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.authKeyId = null;
    req.tenantId = undefined;
  });

  const ctx = {
    sessions,
    auth: {
      authEnabled: false,
      getRole: vi.fn(() => 'admin'),
      hasPermission: vi.fn(() => true),
      getKey: vi.fn(() => null),
      getAuditActor: vi.fn((_keyId: unknown, fallback = 'system') => fallback as string),
    },
    quotas: {
      checkSessionQuota: vi.fn(() => ({ allowed: true })),
      checkSendQuota: vi.fn(() => ({ allowed: true })),
    },
    config: {
      enforceSessionOwnership: false,
      acpEnabled: false,
      envDenylist: [],
      envAdminAllowlist: [],
    },
    metrics: {
      sessionCreated: vi.fn(),
      sessionFailed: vi.fn(),
      sessionKilled: vi.fn(),
      cleanupSession: vi.fn(),
      promptSent: vi.fn(),
      recordPermissionResponse: vi.fn(),
      getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })),
    },
    monitor: {
      removeSession: vi.fn(),
      getStallInfo: vi.fn(() => ({ stalled: false })),
    },
    eventBus: {
      emitEnded: vi.fn(),
      emitStatus: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    },
    channels: {
      message: vi.fn(async () => {}),
      sessionEnded: vi.fn(async () => {}),
      sessionCreated: vi.fn(async () => {}),
      statusChange: vi.fn(async () => {}),
    },
    jsonlWatcher: {},
    pipelines: {},
    toolRegistry: {
      cleanupSession: vi.fn(),
      getSessionTools: vi.fn(() => []),
      getToolDefinitions: vi.fn(() => []),
      processEntries: vi.fn(),
    },
    getAuditLogger: vi.fn(() => null),
    alertManager: {},
    sseLimiter: { acquire: vi.fn(() => ({ allowed: false })), release: vi.fn() },
    memoryBridge: null,
    requestKeyMap: new Map<string, string>(),
    validateWorkDir: vi.fn(async (d: string) => d),
    serverState: { draining: false },
  } as unknown as RouteContext;

  registerSessionActionRoutes(app, ctx);
  return { app, sessions };
}

describe('POST /v1/sessions/:id/send', () => {
  let app: ReturnType<typeof Fastify>;
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    const session = makeSession();
    ({ app, sessions } = buildApp(session));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 400 when request body is missing text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/send`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid request body');
    expect(sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('returns 400 when text is empty string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/send`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid request body');
    expect(sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('returns 404 when session does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent-id/send',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Session not found');
    expect(sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('includes reason in response when message is not delivered', async () => {
    sessions.sendMessage.mockResolvedValueOnce({ delivered: false, attempts: 3, error: 'no active pane' } as any);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/send`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.delivered).toBe(false);
    expect(body.reason).toBe('no active pane');
  });
});

describe('POST /v1/sessions/:id/interrupt', () => {
  let app: ReturnType<typeof Fastify>;
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    const session = makeSession();
    ({ app, sessions } = buildApp(session));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('interrupts an active session and returns ok', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/interrupt`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(sessions.interrupt).toHaveBeenCalledWith(SESSION_ID);
  });

  it('returns 404 when session does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent-id/interrupt',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Session not found');
    expect(sessions.interrupt).not.toHaveBeenCalled();
  });

  it('returns 404 when interrupt throws (e.g. transport gone)', async () => {
    sessions.interrupt.mockRejectedValueOnce(new Error('no active pane'));

    const response = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/interrupt`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('no active pane');
  });
});

describe('DELETE /v1/sessions/:id', () => {
  afterEach(async () => {
    vi.clearAllMocks();
  });

  it('returns 404 with status when session is already terminated', async () => {
    const killedSession = makeSession({ status: 'killed' });
    const { app, sessions } = buildApp(killedSession);
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/sessions/${SESSION_ID}`,
    });

    await app.close();
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('Session already terminated');
    expect(body.status).toBe('killed');
    expect(sessions.killSession).not.toHaveBeenCalled();
  });

  it('returns 404 with status when session has completed', async () => {
    const completedSession = makeSession({ status: 'completed' });
    const { app } = buildApp(completedSession);
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/sessions/${SESSION_ID}`,
    });

    await app.close();
    expect(response.statusCode).toBe(404);
    expect(response.json().status).toBe('completed');
  });

  it('returns 404 when session does not exist', async () => {
    const { app, sessions } = buildApp(null);
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/sessions/${SESSION_ID}`,
    });

    await app.close();
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('Session not found');
    expect(sessions.killSession).not.toHaveBeenCalled();
  });

  it('kills an active session and returns ok with killed status', async () => {
    const activeSession = makeSession({ status: 'working' });
    const { app, sessions } = buildApp(activeSession);
    await app.ready();

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/sessions/${SESSION_ID}`,
    });

    await app.close();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, status: 'killed' });
    expect(sessions.killSession).toHaveBeenCalledWith(SESSION_ID);
  });
});
