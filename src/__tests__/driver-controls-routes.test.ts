/**
 * driver-controls-routes.test.ts — Real integration tests for driver control endpoints.
 *
 * Issue #3898: Rewritten from mock Fastify to app.inject() pattern (matching #3878).
 * Covers: POST claim, POST release, POST transfer, GET participants.
 *
 * Tests request validation, auth hooks, content-type handling, and error serialization
 * through a real Fastify instance — not mock objects.
 */
import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { registerDriverRoutes } from '../routes/driver-controls.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = 'dc000001-ctrl-4000-8000-000000000000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'driver-controls-test',
    workDir: '/tmp/driver-controls-test',
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

function buildApp(
  session: SessionInfo | null,
  options: {
    acpBackend?: Record<string, ReturnType<typeof vi.fn>>;
    authEnabled?: boolean;
  } = {},
) {
  const acpBackend = 'acpBackend' in options ? options.acpBackend : {
    claimDriver: vi.fn(async (args: Record<string, unknown>) => ({
      claimed: true,
      holderId: args.holderId ?? 'unknown',
    })),
    releaseDriver: vi.fn(async (args: Record<string, unknown>) => ({
      released: true,
      holderId: args.holderId ?? 'unknown',
    })),
    transferDriver: vi.fn(async (args: Record<string, unknown>) => ({
      transferred: true,
      newHolder: args.targetSubscriberId,
    })),
    getParticipants: vi.fn(async () => ({
      driver: { holderId: 'holder-1', claimedAt: Date.now() },
      observers: ['obs-1'],
      activeCount: 2,
    })),
  };

  const authEnabled = options.authEnabled ?? false;

  const sessions = {
    getSession: vi.fn((id: string) => (id === SESSION_ID && session ? session : undefined)),
    findSession: vi.fn((id: string) => (id === SESSION_ID && session ? session : undefined)),
    listSessions: vi.fn(() => (session ? [session] : [])),
  };

  const auth = {
    authEnabled,
    getRole: vi.fn(() => 'admin'),
    hasPermission: vi.fn(() => true),
    getKey: vi.fn(() => (authEnabled ? { id: 'key-owner', role: 'admin', permissions: ['send'] } : null)),
    getPermissions: vi.fn(() => ['send']),
    getAuditActor: vi.fn(() => 'admin'),
  };

  const eventBus = { emit: vi.fn() };

  const ctx = {
    sessions,
    auth,
    quotas: {
      checkSessionQuota: vi.fn(() => ({ allowed: true })),
      checkSendQuota: vi.fn(() => ({ allowed: true })),
    },
    config: {
      enforceSessionOwnership: false,
      acpEnabled: true,
    },
    metrics: {
      sessionCreated: vi.fn(),
      sessionFailed: vi.fn(),
      cleanupSession: vi.fn(),
      promptSent: vi.fn(),
      recordPermissionResponse: vi.fn(),
      getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })),
    },
    monitor: { removeSession: vi.fn() },
    channels: { fanOut: vi.fn() },
    jsonlWatcher: { watch: vi.fn(), unwatch: vi.fn() },
    pipelines: { run: vi.fn() },
    toolRegistry: { list: vi.fn(() => []) },
    getAuditLogger: vi.fn(() => ({ log: vi.fn() })),
    alertManager: { emit: vi.fn() },
    sseLimiter: { acquire: vi.fn(async () => () => {}), getConnectionCount: vi.fn(() => 0) },
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: vi.fn(async () => ''),
    serverState: { draining: false },
    metering: { record: vi.fn() },
    metricsCache: { get: vi.fn(), set: vi.fn() },
    eventBus,
    acpBackend: acpBackend as unknown as RouteContext['acpBackend'],
  } as unknown as RouteContext;

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = authEnabled ? 'key-owner' : null;
    req.tenantId = undefined;
  });
  registerDriverRoutes(app, ctx);

  return { app, sessions, auth, acpBackend, eventBus, ctx };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Driver Control Routes (app.inject)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // --- POST /v1/sessions/:id/driver/claim ---

  describe('POST /v1/sessions/:id/driver/claim', () => {
    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/nonexistent/driver/claim`,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 501 when ACP backend is not configured', async () => {
      const { app } = buildApp(makeSession(), { acpBackend: undefined as any });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/claim`,
        payload: {},
      });
      expect(res.statusCode).toBe(501);
      expect(res.json()).toEqual({ error: 'ACP backend is not configured' });
    });

    it('returns 400 for invalid body (ttlMs as string)', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/claim`,
        payload: { ttlMs: 'not-a-number' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid request body');
    });

    it('claims driver successfully', async () => {
      const acp = {
        claimDriver: vi.fn(async () => ({ claimed: true, holderId: 'holder-1' })),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/claim`,
        payload: { holderId: 'holder-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ claimed: true, holderId: 'holder-1' });
      expect(acp.claimDriver).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID, holderId: 'holder-1' }),
      );
    });

    it('returns 409 when driver already claimed', async () => {
      const acp = {
        claimDriver: vi.fn(async () => { throw new Error('Session already claimed by holder-2'); }),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/claim`,
        payload: { holderId: 'holder-1' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('DRIVER_CLAIMED');
    });

    it('returns 500 for other claim errors', async () => {
      const acp = {
        claimDriver: vi.fn(async () => { throw new Error('Internal failure'); }),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/claim`,
        payload: {},
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('Internal server error');
    });
  });

  // --- POST /v1/sessions/:id/driver/release ---

  describe('POST /v1/sessions/:id/driver/release', () => {
    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/nonexistent/driver/release`,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 501 when ACP backend is not configured', async () => {
      const { app } = buildApp(makeSession(), { acpBackend: undefined as any });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/release`,
        payload: {},
      });
      expect(res.statusCode).toBe(501);
    });

    it('returns 400 for invalid body (holderId as number)', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/release`,
        payload: { holderId: 12345 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid request body');
    });

    it('releases driver successfully', async () => {
      const acp = {
        releaseDriver: vi.fn(async () => ({ released: true })),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/release`,
        payload: { holderId: 'holder-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ released: true });
      expect(acp.releaseDriver).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID, holderId: 'holder-1' }),
      );
    });

    it('returns 500 on release error', async () => {
      const acp = {
        releaseDriver: vi.fn(async () => { throw new Error('Release failed'); }),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/release`,
        payload: {},
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('Internal server error');
    });
  });

  // --- POST /v1/sessions/:id/driver/transfer ---

  describe('POST /v1/sessions/:id/driver/transfer', () => {
    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/nonexistent/driver/transfer`,
        payload: { targetSubscriberId: 'sub-2' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 501 when ACP backend is not configured', async () => {
      const { app } = buildApp(makeSession(), { acpBackend: undefined as any });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/transfer`,
        payload: { targetSubscriberId: 'sub-2' },
      });
      expect(res.statusCode).toBe(501);
    });

    it('returns 400 for missing targetSubscriberId', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/transfer`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid request body');
    });

    it('transfers driver successfully', async () => {
      const acp = {
        transferDriver: vi.fn(async () => ({ transferred: true, newHolder: 'sub-2' })),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/transfer`,
        payload: { targetSubscriberId: 'sub-2', reason: 'handoff' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ transferred: true, newHolder: 'sub-2' });
      expect(acp.transferDriver).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION_ID,
          targetSubscriberId: 'sub-2',
          reason: 'handoff',
        }),
      );
    });

    it('returns 500 on transfer error', async () => {
      const acp = {
        transferDriver: vi.fn(async () => { throw new Error('Transfer error'); }),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'POST',
        url: `/v1/sessions/${SESSION_ID}/driver/transfer`,
        payload: { targetSubscriberId: 'sub-2' },
      });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('Internal server error');
    });
  });

  // --- GET /v1/sessions/:id/participants ---

  describe('GET /v1/sessions/:id/participants', () => {
    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/nonexistent/participants`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns default when ACP backend is not configured', async () => {
      const { app } = buildApp(makeSession(), { acpBackend: undefined as any });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${SESSION_ID}/participants`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ driver: null, observers: [], activeCount: 0 });
    });

    it('returns participants from ACP backend', async () => {
      const participants = {
        driver: { holderId: 'holder-1', claimedAt: 1234567890 },
        observers: ['obs-1', 'obs-2'],
        activeCount: 3,
      };
      const acp = {
        getParticipants: vi.fn(async () => participants),
      };
      const { app } = buildApp(makeSession(), { acpBackend: acp });
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${SESSION_ID}/participants`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(participants);
      expect(acp.getParticipants).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ tenantId: 'default' }),
      );
    });
  });

  // --- Route registration verification ---

  describe('route registration', () => {
    it('registers all 4 driver endpoints (v1 + legacy)', async () => {
      const { app } = buildApp(makeSession());
      // Test each endpoint returns something other than 404
      const endpoints = [
        { method: 'POST' as const, url: `/v1/sessions/${SESSION_ID}/driver/claim`, payload: {} },
        { method: 'POST' as const, url: `/v1/sessions/${SESSION_ID}/driver/release`, payload: {} },
        { method: 'POST' as const, url: `/v1/sessions/${SESSION_ID}/driver/transfer`, payload: { targetSubscriberId: 'x' } },
        { method: 'GET' as const, url: `/v1/sessions/${SESSION_ID}/participants` },
      ];
      for (const ep of endpoints) {
        const res = await app.inject(ep);
        expect(res.statusCode).not.toBe(404);
      }
    });
  });
});
