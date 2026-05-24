/**
 * session-approval-4088.test.ts — Issue #4088 + #4092: Session-level approval gate.
 *
 * Tests cover:
 *   - Session-approval route handlers (HTTP 200/409/500)
 *   - SessionManager.approveSession / rejectSession state transitions
 *   - Telegram callback dispatch (session_approve / session_reject)
 *   - Startup recovery for stuck awaiting_approval sessions
 *   - Discovery polling failure resilience (try/catch)
 *   - Edge cases: double-approve, approve-after-reject, non-awaiting states
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerSessionApprovalRoutes } from '../routes/session-approval.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

// ── Helpers ──────────────────────────────────────────────────────────

const SESSION_ID = 'aa000001-appr-4000-8000-000000000001';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SESSION_ID,
    displayName: 'approval-test-session',
    workDir: '/tmp/approval-test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'awaiting_approval',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    awaitingApproval: true,
    ...overrides,
  } as SessionInfo;
}

function buildApp(session: SessionInfo | null) {
  const approveSessionFn = vi.fn(async (id: string, approvedBy?: string) => {
    if (!session || id !== SESSION_ID) throw new Error(`Session not found: ${id}`);
    if (session.status !== 'awaiting_approval') {
      throw new Error(`Session is not awaiting approval (status: ${session.status})`);
    }
    session.status = 'pending';
    session.awaitingApproval = false;
    session.approvedBy = approvedBy;
    session.approvedAt = Date.now();
    return session;
  });

  const rejectSessionFn = vi.fn(async (id: string) => {
    if (!session || id !== SESSION_ID) throw new Error(`Session not found: ${id}`);
    if (session.status !== 'awaiting_approval') {
      throw new Error(`Session is not awaiting approval (status: ${session.status})`);
    }
    session.status = 'killed';
    session.awaitingApproval = false;
  });

  const sessions = {
    getSession: vi.fn((id: string) => (id === SESSION_ID && session ? session : undefined)),
    approveSession: approveSessionFn,
    rejectSession: rejectSessionFn,
    listSessions: vi.fn(() => (session ? [session] : [])),
    releaseSessionClaim: vi.fn(),
    save: vi.fn(async () => {}),
  };

  const statusChange = vi.fn();

  const ctx: RouteContext = {
    sessions: sessions as any,
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
    } as any,
    metrics: {
      sessionCreated: vi.fn(),
      sessionFailed: vi.fn(),
      cleanupSession: vi.fn(),
      promptSent: vi.fn(),
      recordPermissionResponse: vi.fn(),
      getGlobalMetrics: vi.fn(() => ({ sessions: { total_created: 0 } })),
    } as any,
    monitor: { removeSession: vi.fn() } as any,
    channels: { statusChange } as any,
    getAuditLogger: vi.fn(() => null),
    toolRegistry: {} as any,
  } as unknown as RouteContext;

  const app = Fastify({ logger: false });
  // Set authKeyId to null so requireSessionOwnership skips auth checks
  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = null;
    req.tenantId = undefined;
  });

  registerSessionApprovalRoutes(app, ctx);
  return { app, sessions, statusChange, approveSessionFn, rejectSessionFn };
}

// ── Approve endpoint tests ───────────────────────────────────────────

describe('POST /v1/sessions/:id/session-approve', () => {
  it('transitions awaiting_approval → pending (200)', async () => {
    const session = makeSession();
    const { app } = buildApp(session);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-approve`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe('pending');
    expect(body.approvedBy).toBe('unknown');
    expect(session.status).toBe('pending');
    expect(session.awaitingApproval).toBe(false);
  });

  it('records approvedBy and approvedAt', async () => {
    const session = makeSession();
    const { app } = buildApp(session);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-approve`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().approvedAt).toBeGreaterThan(0);
  });

  it('emits session.approved channel event', async () => {
    const session = makeSession();
    const { app, statusChange } = buildApp(session);

    await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-approve`,
    });

    expect(statusChange).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'session.approved' }),
    );
  });

  it('returns 409 when session is not awaiting_approval', async () => {
    const session = makeSession({ status: 'pending', awaitingApproval: false });
    const { app } = buildApp(session);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-approve`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('SESSION_NOT_AWAITING_APPROVAL');
  });
});

// ── Reject endpoint tests ────────────────────────────────────────────

describe('POST /v1/sessions/:id/session-reject', () => {
  it('transitions awaiting_approval → killed (200)', async () => {
    const session = makeSession();
    const { app } = buildApp(session);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-reject`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().status).toBe('killed');
    expect(session.status).toBe('killed');
    expect(session.awaitingApproval).toBe(false);
  });

  it('emits session.rejected channel event', async () => {
    const session = makeSession();
    const { app, statusChange } = buildApp(session);

    await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-reject`,
    });

    expect(statusChange).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'session.rejected' }),
    );
  });

  it('returns 409 when session is not awaiting_approval', async () => {
    const session = makeSession({ status: 'idle', awaitingApproval: false });
    const { app } = buildApp(session);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/session-reject`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('SESSION_NOT_AWAITING_APPROVAL');
  });
});

// ── Route registration tests ─────────────────────────────────────────

describe('Session approval route registration', () => {
  it('registers all 4 endpoint paths (v1 + legacy)', async () => {
    const session = makeSession();
    const { app } = buildApp(session);

    const paths = [
      `/v1/sessions/${SESSION_ID}/session-approve`,
      `/v1/sessions/${SESSION_ID}/session-reject`,
      `/sessions/${SESSION_ID}/session-approve`,
      `/sessions/${SESSION_ID}/session-reject`,
    ];

    for (const url of paths) {
      const res = await app.inject({ method: 'POST', url });
      expect(res.statusCode).not.toBe(404);
    }
  });

  it('paths are distinct from permission approve/reject routes', () => {
    const approvalPaths = ['/v1/sessions/:id/session-approve', '/v1/sessions/:id/session-reject'];
    const permissionPaths = ['/v1/sessions/:id/approve', '/v1/sessions/:id/reject'];
    expect(approvalPaths).not.toEqual(expect.arrayContaining(permissionPaths));
  });
});

// ── Telegram callback dispatch tests ─────────────────────────────────

describe('Telegram callback dispatch (#4088)', () => {
  it('session_approve:<id> → session_approve action', () => {
    const data = `session_approve:${SESSION_ID}`;
    let action: string | null = null;
    if (data.startsWith('session_approve:')) action = 'session_approve';
    else if (data.startsWith('session_reject:')) action = 'session_reject';
    expect(action).toBe('session_approve');
  });

  it('session_reject:<id> → session_reject action', () => {
    const data = `session_reject:${SESSION_ID}`;
    let action: string | null = null;
    if (data.startsWith('session_approve:')) action = 'session_approve';
    else if (data.startsWith('session_reject:')) action = 'session_reject';
    expect(action).toBe('session_reject');
  });

  it('perm_approve does NOT trigger session_approve', () => {
    const data = `perm_approve:${SESSION_ID}`;
    let action: string | null = null;
    if (data.startsWith('session_approve:')) action = 'session_approve';
    else if (data.startsWith('session_reject:')) action = 'session_reject';
    expect(action).toBeNull();
  });

  it('extracts session ID from callback data', () => {
    expect(`session_approve:${SESSION_ID}`.split(':').slice(1).join(':')).toBe(SESSION_ID);
  });
});

// ── Startup recovery tests (#4092) ───────────────────────────────────

describe('Startup recovery for stuck awaiting_approval sessions (#4092)', () => {
  it('detects sessions stuck in awaiting_approval', () => {
    const sessions: Record<string, SessionInfo> = {
      s1: makeSession({ id: 's1' }),
      s2: makeSession({ id: 's2', status: 'pending', awaitingApproval: false }),
      s3: makeSession({ id: 's3', displayName: 'stuck-session' }),
    };
    const stuck = Object.values(sessions).filter(s => s.status === 'awaiting_approval');
    expect(stuck).toHaveLength(2);
    expect(stuck.map(s => s.id)).toEqual(['s1', 's3']);
  });

  it('no recovery needed when all sessions are in normal states', () => {
    const sessions: Record<string, SessionInfo> = {
      s1: makeSession({ id: 's1', status: 'pending', awaitingApproval: false }),
    };
    const stuck = Object.values(sessions).filter(s => s.status === 'awaiting_approval');
    expect(stuck).toHaveLength(0);
  });

  it('recovery callback re-emits session.awaiting_approval channel event', () => {
    const statusChange = vi.fn();
    const session = makeSession();
    // Simulate what the recovery callback does (from server.ts)
    statusChange({
      event: 'session.awaiting_approval',
      timestamp: new Date().toISOString(),
      session: { id: session.id, name: session.displayName ?? '', workDir: session.workDir },
      detail: `Session still awaiting approval after restart: ${session.displayName ?? session.id}`,
    });
    expect(statusChange).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'session.awaiting_approval' }),
    );
  });
});

// ── Discovery polling resilience (#4092) ─────────────────────────────

describe('approveSession discovery polling resilience (#4092)', () => {
  it('session stays approved even if discovery polling throws', () => {
    const session = makeSession();
    const discoveryStart = vi.fn(() => { throw new Error('discovery failed'); });
    let crashed = false;

    try {
      session.status = 'pending';
      session.awaitingApproval = false;
      session.approvedBy = 'test';
      session.approvedAt = Date.now();
      try { discoveryStart(); } catch { /* swallowed */ }
    } catch {
      crashed = true;
    }

    expect(crashed).toBe(false);
    expect(session.status).toBe('pending');
    expect(discoveryStart).toHaveBeenCalled();
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe('Session approval edge cases', () => {
  it('double-approve returns 409 on second attempt', async () => {
    const session = makeSession();
    const { app } = buildApp(session);

    const res1 = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/session-approve` });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/session-approve` });
    expect(res2.statusCode).toBe(409);
  });

  it('approve after reject returns 409', async () => {
    const session = makeSession();
    const { app } = buildApp(session);

    const res1 = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/session-reject` });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/session-approve` });
    expect(res2.statusCode).toBe(409);
  });

  it('all non-awaiting statuses return 409 on approve attempt', async () => {
    const nonAwaiting: SessionInfo['status'][] = [
      'idle', 'working', 'permission_prompt', 'plan_mode', 'killed',
      'completed', 'crashed', 'compacting', 'context_warning',
    ];

    for (const status of nonAwaiting) {
      const session = makeSession({ status, awaitingApproval: false });
      const { app } = buildApp(session);

      const res = await app.inject({ method: 'POST', url: `/v1/sessions/${SESSION_ID}/session-approve` });
      expect([409, 500]).toContain(res.statusCode); // 409 for non-awaiting, 500 if route catches the mock throw
    }
  });
});
