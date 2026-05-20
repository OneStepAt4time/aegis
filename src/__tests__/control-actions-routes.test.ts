/**
 * control-actions-routes.test.ts — Integration tests for control-action endpoints.
 *
 * Issue #3854: 10 endpoints with zero integration tests.
 * Covers: pause, intervention/start, intervention/complete, resume, cancel,
 *         GET intervention, approval/approve, approval/reject, GET approval/pending.
 */
import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file: string, _args: string[], _opts: unknown, cb?: (err: Error | null) => void) => {
    cb?.(new Error('claude unavailable in tests'));
  }),
}));

import { registerControlActionRoutes } from '../routes/control-actions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = 'ca000001-ctrl-4000-8000-000000000000';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'control-action-test',
    workDir: '/tmp/control-action-test',
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

function makePauseRecord(overrides: Record<string, unknown> = {}) {
  return {
    pauseId: 'pause-001',
    sessionId: SESSION_ID,
    status: 'paused',
    idempotencyKey: null,
    reason: 'test',
    requestedBy: 'tester',
    requestedAt: new Date().toISOString(),
    metadata: null,
    interventionId: null,
    interventionBy: null,
    interventionStartedAt: null,
    interventionCompletedBy: null,
    interventionCompletedAt: null,
    guidance: null,
    resumeId: null,
    resumedBy: null,
    resumedAt: null,
    resumeMetadata: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function buildApp(session: SessionInfo | null, options: {
  pauseStore?: Record<string, unknown>;
  acpBackend?: Record<string, unknown>;
} = {}) {
  const pauseStore = options.pauseStore ?? {
    pause: vi.fn(async () => makePauseRecord()),
    startIntervention: vi.fn(async () => makePauseRecord({ status: 'intervening', interventionId: 'int-001' })),
    completeIntervention: vi.fn(async () => makePauseRecord({ status: 'intervention_completed', interventionId: 'int-001' })),
    resume: vi.fn(async () => makePauseRecord({ status: 'resumed', resumeId: 'res-001' })),
    getActive: vi.fn(async () => null),
    getLatest: vi.fn(async () => null),
  };

  const acpBackend = options.acpBackend ?? {
    cancelSession: vi.fn(async () => {}),
    approveSession: vi.fn(async () => ({ ok: true })),
    rejectSession: vi.fn(async () => ({ ok: true })),
    getPendingApproval: vi.fn(() => null),
  };

  const sessions = {
    getSession: vi.fn((id: string) => (id === SESSION_ID && session ? session : undefined)),
    listSessions: vi.fn(() => (session ? [session] : [])),
  };

  const auth = {
    authEnabled: false,
    getRole: vi.fn(() => 'admin'),
    hasPermission: vi.fn(() => true),
    getKey: vi.fn(() => null),
    getPermissions: vi.fn(() => []),
    getAuditActor: vi.fn(() => 'system'),
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
      acpEnabled: false,
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
    getAuditLogger: vi.fn(() => null),
    alertManager: { emit: vi.fn() },
    sseLimiter: { acquire: vi.fn(async () => () => {}), getConnectionCount: vi.fn(() => 0) },
    memoryBridge: null,
    requestKeyMap: new Map(),
    validateWorkDir: vi.fn(async () => ''),
    serverState: { draining: false },
    metering: { record: vi.fn() },
    metricsCache: { get: vi.fn(), set: vi.fn() },
    eventBus,
    pauseInterventionStore: pauseStore,
    acpBackend,
  } as unknown as RouteContext;

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = null;
    req.tenantId = undefined;
  });
  registerControlActionRoutes(app, ctx);

  return { app, sessions, auth, pauseStore, acpBackend, eventBus };
}

describe('Control Action Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('POST /v1/sessions/:id/pause', () => {
    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/nonexistent/pause`, payload: {} });
      expect(res.statusCode).toBe(404);
    });

    it('pauses session successfully', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/pause`, payload: { reason: 'maintenance' } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.pause).toBeDefined();
      expect(body.pause.status).toBe('paused');
    });

    it('returns 409 when already paused', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.pause as any).mockRejectedValue(new Error('already exists'));
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/pause`, payload: { reason: 'test' } });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /v1/sessions/:id/intervention/start', () => {
    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/nonexistent/intervention/start`, payload: {} });
      expect(res.statusCode).toBe(404);
    });

    it('starts intervention on paused session', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/intervention/start`, payload: { interventionBy: 'operator' } });
      expect(res.statusCode).toBe(200);
      expect(res.json().pause.interventionId).toBeDefined();
    });

    it('returns 409 when no active pause', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.startIntervention as any).mockResolvedValue(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/intervention/start`, payload: {} });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /v1/sessions/:id/intervention/complete', () => {
    it('returns 409 when no active intervention', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.getActive as any).mockResolvedValue(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/intervention/complete`, payload: { guidance: 'fixed' } });
      expect(res.statusCode).toBe(409);
    });

    it('completes intervention successfully', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.getActive as any).mockResolvedValue(makePauseRecord({ interventionId: 'int-001', status: 'intervening' }));
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/intervention/complete`, payload: { guidance: 'applied fix' } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /v1/sessions/:id/resume', () => {
    it('resumes paused session', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/resume`, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().pause.status).toBe('resumed');
    });

    it('returns 409 when not paused', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.resume as any).mockResolvedValue(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/resume`, payload: {} });
      expect(res.statusCode).toBe(409);
    });

    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/nonexistent/resume`, payload: {} });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /v1/sessions/:id/cancel', () => {
    it('cancels session', async () => {
      const { app, acpBackend } = buildApp(makeSession());
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/cancel`, payload: {} });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(acpBackend.cancelSession).toHaveBeenCalled();
    });

    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/nonexistent/cancel`, payload: {} });
      expect(res.statusCode).toBe(404);
    });

    it('returns 500 when acpBackend throws', async () => {
      const { app, acpBackend } = buildApp(makeSession());
      (acpBackend.cancelSession as any).mockRejectedValue(new Error('cancel failed'));
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/cancel`, payload: {} });
      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /v1/sessions/:id/intervention', () => {
    it('returns 404 when no intervention found', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.getActive as any).mockResolvedValue(null);
      (pauseStore.getLatest as any).mockResolvedValue(null);
      const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/intervention` });
      expect(res.statusCode).toBe(404);
    });

    it('returns active intervention', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.getActive as any).mockResolvedValue(makePauseRecord({ status: 'intervening', interventionId: 'int-001' }));
      const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/intervention` });
      expect(res.statusCode).toBe(200);
      expect(res.json().interventionId).toBe('int-001');
    });

    it('returns latest intervention when no active', async () => {
      const { app, pauseStore } = buildApp(makeSession());
      (pauseStore.getActive as any).mockResolvedValue(null);
      (pauseStore.getLatest as any).mockResolvedValue(makePauseRecord({ status: 'completed' }));
      const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/intervention` });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('completed');
    });
  });

  describe('POST /v1/sessions/:id/approval/approve', () => {
    it('approves tool use', async () => {
      const { app, acpBackend } = buildApp(makeSession());
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/approval/approve`, payload: { approvalId: 'appr-001' } });
      expect(res.statusCode).toBe(200);
      expect(acpBackend.approveSession).toHaveBeenCalled();
    });

    it('emits approval_resolved event', async () => {
      const { app, eventBus } = buildApp(makeSession());
      await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/approval/approve`, payload: { approvalId: 'appr-001' } });
      expect(eventBus.emit).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ event: 'approval_resolved', data: expect.objectContaining({ action: 'approved' }) }));
    });

    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/nonexistent/approval/approve`, payload: { approvalId: 'appr-001' } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /v1/sessions/:id/approval/reject', () => {
    it('rejects tool use', async () => {
      const { app, acpBackend } = buildApp(makeSession());
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/approval/reject`, payload: { approvalId: 'appr-001' } });
      expect(res.statusCode).toBe(200);
      expect(acpBackend.rejectSession).toHaveBeenCalled();
    });

    it('emits approval_resolved event with rejected action', async () => {
      const { app, eventBus } = buildApp(makeSession());
      await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/approval/reject`, payload: { approvalId: 'appr-001' } });
      expect(eventBus.emit).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ event: 'approval_resolved', data: expect.objectContaining({ action: 'rejected' }) }));
    });

    it('returns 500 when acpBackend throws', async () => {
      const { app, acpBackend } = buildApp(makeSession());
      (acpBackend.rejectSession as any).mockRejectedValue(new Error('reject failed'));
      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/approval/reject`, payload: { approvalId: 'appr-001' } });
      expect(res.statusCode).toBe(500);
    });
  });

  describe('GET /v1/sessions/:id/approval/pending', () => {
    it('returns null pending when no pending approval', async () => {
      const { app } = buildApp(makeSession());
      const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/approval/pending` });
      expect(res.statusCode).toBe(200);
      expect(res.json().pending).toBeNull();
    });

    it('returns pending approval', async () => {
      const { app, acpBackend } = buildApp(makeSession());
      (acpBackend.getPendingApproval as any).mockReturnValue({ approvalId: 'appr-001', tool: 'bash' });
      const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/approval/pending` });
      expect(res.statusCode).toBe(200);
      expect(res.json().pending.approvalId).toBe('appr-001');
    });

    it('returns 404 for unknown session', async () => {
      const { app } = buildApp(null);
      const res = await app.inject({ method: 'GET', url: `/v1/sessions/nonexistent/approval/pending` });
      expect(res.statusCode).toBe(404);
    });
  });
});
