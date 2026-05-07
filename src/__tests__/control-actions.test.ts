/**
 * control-actions.test.ts — Tests for Issue #2607 (ACP-064):
 *   POST /v1/sessions/:id/pause
 *   POST /v1/sessions/:id/intervention/start
 *   POST /v1/sessions/:id/intervention/complete
 *   POST /v1/sessions/:id/resume
 *   GET  /v1/sessions/:id/intervention
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionInfo } from '../session.js';
import type { RouteContext } from '../routes/context.js';
import type { AcpPauseInterventionStore, AcpPauseInterventionRecord } from '../services/acp/pause-intervention.js';
import { registerControlActionRoutes } from '../routes/control-actions.js';

function makeMockApp(): FastifyInstance {
  return {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  } as unknown as FastifyInstance;
}

function makeReply(): { reply: FastifyReply; sent: { statusCode?: number; payload?: unknown } } {
  const sent: { statusCode?: number; payload?: unknown } = {};
  const reply = {
    status: vi.fn((code: number) => {
      sent.statusCode = code;
      return {
        send: vi.fn((payload: unknown) => {
          sent.payload = payload;
          return payload;
        }),
      };
    }),
    send: vi.fn((payload: unknown) => {
      sent.statusCode = sent.statusCode ?? 200;
      sent.payload = payload;
      return payload;
    }),
    header: vi.fn(),
  } as unknown as FastifyReply;
  return { reply, sent };
}

function getHandler(app: FastifyInstance, method: 'post' | 'get', path: string) {
  const mockMethod = app[method] as ReturnType<typeof vi.fn>;
  const call = mockMethod.mock.calls.find((args: unknown[]) => args[0] === path);
  if (!call) {
    throw new Error(`Missing route registration for ${method.toUpperCase()} ${path}`);
  }
  const handlerOrOptions = call[1];
  if (typeof handlerOrOptions === 'function') {
    return handlerOrOptions as (req: unknown, reply: unknown) => Promise<unknown>;
  }
  return (handlerOrOptions as { handler: (req: unknown, reply: unknown) => Promise<unknown> }).handler;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    windowId: '@1',
    displayName: 'cc-test',
    workDir: '/home/user/repo',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ownerKeyId: 'key-owner',
    ...overrides,
  } as SessionInfo;
}

function makePauseRecord(overrides: Partial<AcpPauseInterventionRecord> = {}): AcpPauseInterventionRecord {
  return {
    pauseId: 'pause-1',
    sessionId: '11111111-1111-1111-1111-111111111111',
    tenantId: '_system',
    ownerKeyId: 'key-owner',
    status: 'paused',
    reason: 'manual pause',
    requestedBy: 'user',
    requestedAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeMockStore(): AcpPauseInterventionStore {
  return {
    pause: vi.fn(async (input) => makePauseRecord({
      pauseId: input.pauseId,
      sessionId: input.sessionId,
      reason: input.reason,
      requestedBy: input.requestedBy,
    })),
    getActive: vi.fn(async () => null),
    getLatest: vi.fn(async () => null),
    startIntervention: vi.fn(async (input) => makePauseRecord({
      sessionId: input.sessionId,
      status: 'intervening',
      interventionId: input.interventionId,
      interventionBy: input.interventionBy,
      interventionStartedAt: new Date(),
    })),
    completeIntervention: vi.fn(async (input) => makePauseRecord({
      sessionId: input.sessionId,
      status: 'paused',
      interventionId: input.interventionId,
      interventionCompletedBy: input.completedBy,
      interventionCompletedAt: new Date(),
      guidance: input.guidance,
    })),
    resume: vi.fn(async (input) => makePauseRecord({
      sessionId: input.sessionId,
      status: 'resumed',
      resumeId: input.resumeId,
      resumedBy: input.resumedBy,
      resumedAt: new Date(),
    })),
  };
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    params: { id: '11111111-1111-1111-1111-111111111111' },
    body: {},
    authKeyId: 'key-owner',
    tenantId: '_system',
    authRole: 'admin',
    authPermissions: ['send'],
    ...overrides,
  };
}

function makeCtx(store?: AcpPauseInterventionStore): RouteContext {
  const session = makeSession();
  return {
    sessions: {
      getSession: vi.fn(() => session),
      listSessions: vi.fn(() => [session]),
    } as unknown as RouteContext['sessions'],
    auth: {
      authEnabled: false,
      getRole: vi.fn(() => 'admin'),
      getPermissions: vi.fn(() => ['send']),
      getAuditActor: vi.fn(() => 'admin'),
    } as unknown as RouteContext['auth'],
    config: { enforceSessionOwnership: true } as unknown as RouteContext['config'],
    metrics: {} as unknown as RouteContext['metrics'],
    monitor: {} as unknown as RouteContext['monitor'],
    eventBus: {} as unknown as RouteContext['eventBus'],
    channels: {} as unknown as RouteContext['channels'],
    jsonlWatcher: {} as unknown as RouteContext['jsonlWatcher'],
    pipelines: {} as unknown as RouteContext['pipelines'],
    toolRegistry: {} as unknown as RouteContext['toolRegistry'],
    getAuditLogger: () => undefined,
    alertManager: {} as unknown as RouteContext['alertManager'],
    sseLimiter: {} as unknown as RouteContext['sseLimiter'],
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: vi.fn(),
    serverState: { draining: false },
    quotas: {} as unknown as RouteContext['quotas'],
    metering: {} as unknown as RouteContext['metering'],
    metricsCache: {} as unknown as RouteContext['metricsCache'],
    pauseInterventionStore: store,
  };
}

describe('control-actions routes (Issue #2607)', () => {
  let app: FastifyInstance;
  let ctx: RouteContext;
  let store: AcpPauseInterventionStore;

  beforeEach(() => {
    app = makeMockApp();
    store = makeMockStore();
    ctx = makeCtx(store);
    registerControlActionRoutes(app, ctx);
  });

  // ── Route registration ──────────────────────────────────────

  it('registers all 5 control action routes', () => {
    const postCalls = (app.post as ReturnType<typeof vi.fn>).mock.calls;
    const getCalls = (app.get as ReturnType<typeof vi.fn>).mock.calls;

    const paths = [...postCalls, ...getCalls].map((args: unknown[]) => args[0] as string);
    expect(paths).toContain('/v1/sessions/:id/pause');
    expect(paths).toContain('/v1/sessions/:id/intervention/start');
    expect(paths).toContain('/v1/sessions/:id/intervention/complete');
    expect(paths).toContain('/v1/sessions/:id/resume');
    expect(paths).toContain('/v1/sessions/:id/intervention');
  });

  // ── 501 when store not configured ───────────────────────────

  it('returns 501 for pause when store is not configured', async () => {
    const noStoreCtx = makeCtx(undefined);
    const noStoreApp = makeMockApp();
    registerControlActionRoutes(noStoreApp, noStoreCtx);
    const handler = getHandler(noStoreApp, 'post', '/v1/sessions/:id/pause');
    const { reply, sent } = makeReply();
    await handler(makeRequest(), reply);
    expect(sent.statusCode).toBe(501);
  });

  it('returns 501 for intervention/start when store is not configured', async () => {
    const noStoreCtx = makeCtx(undefined);
    const noStoreApp = makeMockApp();
    registerControlActionRoutes(noStoreApp, noStoreCtx);
    const handler = getHandler(noStoreApp, 'post', '/v1/sessions/:id/intervention/start');
    const { reply, sent } = makeReply();
    await handler(makeRequest(), reply);
    expect(sent.statusCode).toBe(501);
  });

  it('returns 501 for resume when store is not configured', async () => {
    const noStoreCtx = makeCtx(undefined);
    const noStoreApp = makeMockApp();
    registerControlActionRoutes(noStoreApp, noStoreCtx);
    const handler = getHandler(noStoreApp, 'post', '/v1/sessions/:id/resume');
    const { reply, sent } = makeReply();
    await handler(makeRequest(), reply);
    expect(sent.statusCode).toBe(501);
  });

  it('returns 501 for GET intervention when store is not configured', async () => {
    const noStoreCtx = makeCtx(undefined);
    const noStoreApp = makeMockApp();
    registerControlActionRoutes(noStoreApp, noStoreCtx);
    const handler = getHandler(noStoreApp, 'get', '/v1/sessions/:id/intervention');
    const { reply, sent } = makeReply();
    await handler(makeRequest(), reply);
    expect(sent.statusCode).toBe(501);
  });

  // ── Pause ───────────────────────────────────────────────────

  it('pauses a session and returns policy result', async () => {
    const handler = getHandler(app, 'post', '/v1/sessions/:id/pause');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest({ body: { reason: 'manual check' } }), reply);

    expect(store.pause).toHaveBeenCalledOnce();
    expect(sent.statusCode).toBeUndefined(); // no error status set
    const body = result as Record<string, unknown>;
    expect(body).toHaveProperty('session');
    expect(body).toHaveProperty('pause');
    expect((body.session as Record<string, unknown>).id).toBe('11111111-1111-1111-1111-111111111111');
    expect((body.pause as Record<string, unknown>).status).toBe('paused');
  });

  it('rejects pause without reason', async () => {
    const handler = getHandler(app, 'post', '/v1/sessions/:id/pause');
    const { reply, sent } = makeReply();
    await handler(makeRequest({ body: {} }), reply);
    expect(sent.statusCode).toBe(400);
  });

  // ── Intervention start ──────────────────────────────────────

  it('starts an intervention on a paused session', async () => {
    const handler = getHandler(app, 'post', '/v1/sessions/:id/intervention/start');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest({ body: { interventionBy: 'admin' } }), reply);

    expect(store.startIntervention).toHaveBeenCalledOnce();
    const body = result as Record<string, unknown>;
    expect((body.pause as Record<string, unknown>).status).toBe('intervening');
    expect((body.pause as Record<string, unknown>).interventionBy).toBe('admin');
  });

  it('returns 409 when startIntervention returns null', async () => {
    (store.startIntervention as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const handler = getHandler(app, 'post', '/v1/sessions/:id/intervention/start');
    const { reply, sent } = makeReply();
    await handler(makeRequest({ body: {} }), reply);
    expect(sent.statusCode).toBe(409);
  });

  // ── Intervention complete ───────────────────────────────────

  it('completes an intervention with guidance', async () => {
    const activeRecord = makePauseRecord({
      status: 'intervening',
      interventionId: 'intervention-1',
      interventionBy: 'admin',
    });
    (store.getActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(activeRecord);

    const handler = getHandler(app, 'post', '/v1/sessions/:id/intervention/complete');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest({ body: { completedBy: 'admin', guidance: 'Use approach B' } }), reply);

    expect(store.completeIntervention).toHaveBeenCalledOnce();
    const body = result as Record<string, unknown>;
    expect((body.pause as Record<string, unknown>).guidance).toBe('Use approach B');
  });

  it('returns 409 when no active intervention exists for complete', async () => {
    (store.getActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const handler = getHandler(app, 'post', '/v1/sessions/:id/intervention/complete');
    const { reply, sent } = makeReply();
    await handler(makeRequest({ body: {} }), reply);
    expect(sent.statusCode).toBe(409);
  });

  // ── Resume ──────────────────────────────────────────────────

  it('resumes a paused session', async () => {
    const handler = getHandler(app, 'post', '/v1/sessions/:id/resume');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest({ body: { resumedBy: 'admin' } }), reply);

    expect(store.resume).toHaveBeenCalledOnce();
    const body = result as Record<string, unknown>;
    expect((body.pause as Record<string, unknown>).status).toBe('resumed');
    expect((body.pause as Record<string, unknown>).resumedBy).toBe('admin');
  });

  it('returns 409 when resume returns null', async () => {
    (store.resume as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const handler = getHandler(app, 'post', '/v1/sessions/:id/resume');
    const { reply, sent } = makeReply();
    await handler(makeRequest({ body: {} }), reply);
    expect(sent.statusCode).toBe(409);
  });

  // ── GET intervention ────────────────────────────────────────

  it('returns active intervention', async () => {
    const activeRecord = makePauseRecord({ status: 'intervening' });
    (store.getActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(activeRecord);

    const handler = getHandler(app, 'get', '/v1/sessions/:id/intervention');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest(), reply);

    expect(sent.statusCode).toBeUndefined();
    const body = result as Record<string, unknown>;
    expect(body.status).toBe('intervening');
  });

  it('returns 404 when no intervention found', async () => {
    (store.getActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const handler = getHandler(app, 'get', '/v1/sessions/:id/intervention');
    const { reply, sent } = makeReply();
    await handler(makeRequest(), reply);
    expect(sent.statusCode).toBe(404);
  });

  it('falls back to getLatest when no active intervention', async () => {
    (store.getActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const latestRecord = makePauseRecord({ status: 'resumed' });
    (store.getLatest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(latestRecord);

    const handler = getHandler(app, 'get', '/v1/sessions/:id/intervention');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest(), reply);

    expect(sent.statusCode).toBeUndefined();
    expect((result as Record<string, unknown>).status).toBe('resumed');
    expect(store.getLatest).toHaveBeenCalledOnce();
  });

  // ── Response serialization ──────────────────────────────────

  it('serializes dates as ISO strings in the response', async () => {
    const date = new Date('2026-05-05T12:00:00.000Z');
    (store.getActive as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makePauseRecord({ requestedAt: date, updatedAt: date })
    );

    const handler = getHandler(app, 'get', '/v1/sessions/:id/intervention');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest(), reply);

    const body = result as Record<string, unknown>;
    expect(body.requestedAt).toBe('2026-05-05T12:00:00.000Z');
    expect(body.updatedAt).toBe('2026-05-05T12:00:00.000Z');
  });

  it('serializes dates as ISO strings in pause result', async () => {
    const handler = getHandler(app, 'post', '/v1/sessions/:id/pause');
    const { reply, sent } = makeReply();
    const result = await handler(makeRequest({ body: { reason: 'test' } }), reply);

    const body = result as Record<string, unknown>;
    const session = body.session as Record<string, unknown>;
    expect(typeof session.updatedAt).toBe('string');
    expect((session.updatedAt as string).endsWith('Z')).toBe(true);

    const pause = body.pause as Record<string, unknown>;
    expect(typeof pause.requestedAt).toBe('string');
    expect(typeof pause.updatedAt).toBe('string');
  });
});
