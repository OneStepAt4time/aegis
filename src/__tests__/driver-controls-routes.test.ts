/**
 * driver-controls-routes.test.ts — Integration tests for Issue #3855:
 *   POST /v1/sessions/:id/driver/claim
 *   POST /v1/sessions/:id/driver/release
 *   POST /v1/sessions/:id/driver/transfer
 *   GET  /v1/sessions/:id/participants
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionInfo } from '../session.js';
import type { RouteContext } from '../routes/context.js';
import { registerDriverRoutes } from '../routes/driver-controls.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  if (handlerOrOptions && typeof handlerOrOptions === 'object' && 'handler' in handlerOrOptions) {
    return (handlerOrOptions as { handler: (req: unknown, reply: unknown) => Promise<unknown> }).handler;
  }
  throw new Error(`Could not extract handler for ${method.toUpperCase()} ${path}`);
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    windowId: '@1',
    displayName: 'test-session',
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

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    params: { id: '11111111-1111-1111-1111-111111111111' },
    body: {},
    authKeyId: 'key-owner',
    tenantId: '_system',
    authRole: 'admin',
    authPermissions: ['send'],
    matchedPermission: undefined,
    ...overrides,
  };
}

function makeCtx(): { ctx: RouteContext; acpBackend: Record<string, ReturnType<typeof vi.fn>> } {
  const claimDriver = vi.fn();
  const releaseDriver = vi.fn();
  const transferDriver = vi.fn();
  const getParticipants = vi.fn();

  const acpBackend = { claimDriver, releaseDriver, transferDriver, getParticipants };
  const session = makeSession();

  const ctx: RouteContext = {
    sessions: {
      getSession: vi.fn(() => session),
      findSession: vi.fn(() => session),
    } as unknown as RouteContext['sessions'],
    auth: {
      authEnabled: false,
      getRole: vi.fn(() => 'admin'),
      getPermissions: vi.fn(() => ['send']),
      getAuditActor: vi.fn(() => 'admin'),
    } as unknown as RouteContext['auth'],
    config: { enforceSessionOwnership: true } as unknown as RouteContext['config'],
    quotas: {} as unknown as RouteContext['quotas'],
    metrics: {} as unknown as RouteContext['metrics'],
    monitor: {} as unknown as RouteContext['monitor'],
    eventBus: {} as unknown as RouteContext['eventBus'],
    channels: {} as unknown as RouteContext['channels'],
    jsonlWatcher: {} as unknown as RouteContext['jsonlWatcher'],
    acpBackend: acpBackend as unknown as RouteContext['acpBackend'],
    pipelines: {} as unknown as RouteContext['pipelines'],
    toolRegistry: {} as unknown as RouteContext['toolRegistry'],
    alertManager: {} as unknown as RouteContext['alertManager'],
    sseLimiter: {} as unknown as RouteContext['sseLimiter'],
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: vi.fn(),
    serverState: { draining: false },
    metering: {} as unknown as RouteContext['metering'],
    metricsCache: {} as unknown as RouteContext['metricsCache'],
    getAuditLogger: vi.fn().mockReturnValue({ log: vi.fn() }),
  } as RouteContext;

  return { ctx, acpBackend };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('driver-controls routes', () => {
  let app: FastifyInstance;
  let { ctx, acpBackend } = makeCtx();

  beforeEach(() => {
    app = makeMockApp();
    ({ ctx, acpBackend } = makeCtx());
    registerDriverRoutes(app, ctx);
  });

  // --- Route registration ---

  it('registers all 4 driver endpoints', () => {
    const postCalls = (app.post as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    const getCalls = (app.get as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);

    expect(postCalls).toContain('/v1/sessions/:id/driver/claim');
    expect(postCalls).toContain('/v1/sessions/:id/driver/release');
    expect(postCalls).toContain('/v1/sessions/:id/driver/transfer');
    expect(getCalls).toContain('/v1/sessions/:id/participants');
  });

  // --- POST /driver/claim ---

  describe('POST /v1/sessions/:id/driver/claim', () => {
    it('returns 501 when ACP backend is not configured', async () => {
      const localApp = makeMockApp();
      const localCtx = makeCtx();
      localCtx.ctx.acpBackend = undefined;
      registerDriverRoutes(localApp, localCtx.ctx);

      const handler = getHandler(localApp, 'post', '/v1/sessions/:id/driver/claim');
      const { reply, sent } = makeReply();
      await handler(makeRequest(), reply);
      expect(sent.statusCode).toBe(501);
      expect(sent.payload).toEqual({ error: 'ACP backend is not configured' });
    });

    it('returns 400 for invalid body', async () => {
      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/claim');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: { ttlMs: 'not-a-number' } }), reply);
      expect(sent.statusCode).toBe(400);
      expect((sent.payload as Record<string, unknown>).error).toBe('Invalid request body');
    });

    it('claims driver successfully', async () => {
      const claimResult = { claimed: true, holderId: 'holder-1' };
      acpBackend.claimDriver.mockResolvedValue(claimResult);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/claim');
      const { reply } = makeReply();
      const result = await handler(makeRequest({ body: { holderId: 'holder-1' } }), reply);
      expect(result).toEqual(claimResult);
      expect(acpBackend.claimDriver).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: '11111111-1111-1111-1111-111111111111', holderId: 'holder-1' }),
      );
    });

    it('returns 409 when driver already claimed', async () => {
      acpBackend.claimDriver.mockRejectedValue(new Error('Session already claimed by holder-2'));

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/claim');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: { holderId: 'holder-1' } }), reply);
      expect(sent.statusCode).toBe(409);
      expect((sent.payload as Record<string, unknown>).code).toBe('DRIVER_CLAIMED');
    });

    it('returns 500 for other errors', async () => {
      acpBackend.claimDriver.mockRejectedValue(new Error('Internal failure'));

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/claim');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: {} }), reply);
      expect(sent.statusCode).toBe(500);
      expect((sent.payload as Record<string, unknown>).error).toBe('Internal failure');
    });

    it('logs audit event on successful claim', async () => {
      acpBackend.claimDriver.mockResolvedValue({ claimed: true });

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/claim');
      const { reply } = makeReply();
      await handler(makeRequest({ body: { holderId: 'h1' } }), reply);
      expect(ctx.getAuditLogger).toHaveBeenCalled();
    });
  });

  // --- POST /driver/release ---

  describe('POST /v1/sessions/:id/driver/release', () => {
    it('returns 501 when ACP backend is not configured', async () => {
      const localApp = makeMockApp();
      const localCtx = makeCtx();
      localCtx.ctx.acpBackend = undefined;
      registerDriverRoutes(localApp, localCtx.ctx);

      const handler = getHandler(localApp, 'post', '/v1/sessions/:id/driver/release');
      const { reply, sent } = makeReply();
      await handler(makeRequest(), reply);
      expect(sent.statusCode).toBe(501);
    });

    it('returns 400 for invalid body', async () => {
      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/release');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: { holderId: 12345 } }), reply);
      expect(sent.statusCode).toBe(400);
      expect((sent.payload as Record<string, unknown>).error).toBe('Invalid request body');
    });

    it('releases driver successfully', async () => {
      const releaseResult = { released: true };
      acpBackend.releaseDriver.mockResolvedValue(releaseResult);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/release');
      const { reply } = makeReply();
      const result = await handler(makeRequest({ body: { holderId: 'holder-1' } }), reply);
      expect(result).toEqual(releaseResult);
      expect(acpBackend.releaseDriver).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: '11111111-1111-1111-1111-111111111111', holderId: 'holder-1' }),
      );
    });

    it('returns 500 on release error', async () => {
      acpBackend.releaseDriver.mockRejectedValue(new Error('Release failed'));

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/release');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: {} }), reply);
      expect(sent.statusCode).toBe(500);
    });
  });

  // --- POST /driver/transfer ---

  describe('POST /v1/sessions/:id/driver/transfer', () => {
    it('returns 501 when ACP backend is not configured', async () => {
      const localApp = makeMockApp();
      const localCtx = makeCtx();
      localCtx.ctx.acpBackend = undefined;
      registerDriverRoutes(localApp, localCtx.ctx);

      const handler = getHandler(localApp, 'post', '/v1/sessions/:id/driver/transfer');
      const { reply, sent } = makeReply();
      await handler(makeRequest(), reply);
      expect(sent.statusCode).toBe(501);
    });

    it('returns 400 for invalid body (missing targetSubscriberId)', async () => {
      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/transfer');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: {} }), reply);
      expect(sent.statusCode).toBe(400);
      expect((sent.payload as Record<string, unknown>).error).toBe('Invalid request body');
    });

    it('transfers driver successfully', async () => {
      const transferResult = { transferred: true, newHolder: 'sub-2' };
      acpBackend.transferDriver.mockResolvedValue(transferResult);

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/transfer');
      const { reply } = makeReply();
      const result = await handler(
        makeRequest({ body: { targetSubscriberId: 'sub-2', reason: 'handoff' } }),
        reply,
      );
      expect(result).toEqual(transferResult);
      expect(acpBackend.transferDriver).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: '11111111-1111-1111-1111-111111111111',
          targetSubscriberId: 'sub-2',
          reason: 'handoff',
        }),
      );
    });

    it('returns 500 on transfer error', async () => {
      acpBackend.transferDriver.mockRejectedValue(new Error('Transfer error'));

      const handler = getHandler(app, 'post', '/v1/sessions/:id/driver/transfer');
      const { reply, sent } = makeReply();
      await handler(makeRequest({ body: { targetSubscriberId: 'sub-2' } }), reply);
      expect(sent.statusCode).toBe(500);
    });
  });

  // --- GET /participants ---

  describe('GET /v1/sessions/:id/participants', () => {
    it('returns default when ACP backend is not configured', async () => {
      const localApp = makeMockApp();
      const localCtx = makeCtx();
      localCtx.ctx.acpBackend = undefined;
      registerDriverRoutes(localApp, localCtx.ctx);

      const handler = getHandler(localApp, 'get', '/v1/sessions/:id/participants');
      const { reply } = makeReply();
      const result = await handler(makeRequest(), reply);
      expect(result).toEqual({ driver: null, observers: [], activeCount: 0 });
    });

    it('returns participants from ACP backend', async () => {
      const participants = {
        driver: { holderId: 'holder-1', claimedAt: Date.now() },
        observers: ['obs-1', 'obs-2'],
        activeCount: 3,
      };
      acpBackend.getParticipants.mockResolvedValue(participants);

      const handler = getHandler(app, 'get', '/v1/sessions/:id/participants');
      const { reply } = makeReply();
      const result = await handler(makeRequest(), reply);
      expect(result).toEqual(participants);
      expect(acpBackend.getParticipants).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        expect.objectContaining({ tenantId: '_system' }),
      );
    });
  });
});
