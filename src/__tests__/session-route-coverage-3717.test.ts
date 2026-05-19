/**
 * Issue #3717: Improve test coverage for session route handlers.
 *
 * Covers endpoints in routes/sessions.ts and routes/session-data.ts:
 *   GET  /v1/sessions/history  — pagination, filtering, ownership
 *   GET  /v1/sessions          — list with pagination, status/project filter
 *   GET  /v1/sessions/stats    — aggregated stats
 *   DELETE /v1/sessions/batch  — batch delete by ids/status
 *   GET  /sessions             — legacy list
 *   GET  /v1/sessions/:id      — single session with actionHints (permission_prompt)
 *   GET  /v1/sessions/:id/metrics — per-session metrics
 *   GET  /v1/sessions/:id/tools   — per-session tools
 *   GET  /v1/tools             — global tool definitions
 *   GET  /v1/sessions/:id/latency — per-session latency
 *   GET  /v1/sessions/:id/transcript/cursor — cursor-based transcript
 *   POST /v1/sessions/:id/hooks/permission — CC permission hook
 *   POST /v1/sessions/:id/hooks/stop — CC stop hook
 *   POST /v1/sessions/:id/events/replay — event replay
 *   GET  /v1/sessions/:id/events/schema — event schema
 *   GET  /v1/sessions/health   — bulk health
 *   GET  /v1/sessions/:id/health — single health
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerSessionRoutes } from '../routes/sessions.js';
import { registerSessionDataRoutes } from '../routes/session-data.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const SESSION_ID_2 = '00000000-0000-4000-8000-000000000002';
const SESSION_ID_PERM = '00000000-0000-4000-8000-000000000003';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: overrides.id ?? SESSION_ID,
    displayName: overrides.displayName ?? 'test-session',
    workDir: overrides.workDir ?? '/tmp/test-session',
    byteOffset: 0,
    monitorOffset: 0,
    status: overrides.status ?? 'idle',
    createdAt: overrides.createdAt ?? Date.now() - 60_000,
    lastActivity: overrides.lastActivity ?? Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

function buildApp(opts: { authEnabled?: boolean; acpEnabled?: boolean } = {}) {
  const session1 = makeSession();
  const session2 = makeSession({
    id: SESSION_ID_2,
    displayName: 'test-session-2',
    workDir: '/tmp/project-alpha',
    status: 'working',
    createdAt: Date.now() - 120_000,
    ownerKeyId: 'key-123',
  });
  const sessionPerm = makeSession({
    id: SESSION_ID_PERM,
    displayName: 'perm-session',
    status: 'permission_prompt',
  });

  const sessionMap = new Map<string, SessionInfo>();
  sessionMap.set(SESSION_ID, session1);
  sessionMap.set(SESSION_ID_2, session2);
  sessionMap.set(SESSION_ID_PERM, sessionPerm);

  const sessions = {
    getSession: vi.fn((id: string) => sessionMap.get(id)),
    listSessions: vi.fn(() => Array.from(sessionMap.values())),
    killSession: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    createSession: vi.fn(async (o: any) => {
      const s = makeSession({ id: 'new-session-id', ...o });
      sessionMap.set(s.id, s);
      return s;
    }),
    findIdleSessionByWorkDir: vi.fn(async () => null),
    sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    getHealth: vi.fn(async (id: string) => ({
      alive: true, claudeRunning: true, status: 'idle', hasTranscript: true,
      lastActivity: Date.now(), lastActivityAgo: 5, sessionAge: 120,
      details: 'OK',
    })),
    getSummary: vi.fn(async () => ({ summary: 'Test summary', sessionId: SESSION_ID })),
    getLatencyMetrics: vi.fn(() => ({ permission_response_ms: 150 })),
    readTranscript: vi.fn(async () => ({
      messages: [{ role: 'user', contentType: 'text', text: 'hello' }],
      total: 1, page: 1, limit: 50, hasMore: false,
    })),
    readTranscriptCursor: vi.fn(async () => ({
      messages: [{ role: 'user', contentType: 'text', text: 'hello', cursorId: 1 }],
      hasMore: false, nextCursorId: null,
    })),
    releaseSessionClaim: vi.fn(),
    getPendingPermissionInfo: vi.fn(() => null),
    getPendingQuestionInfo: vi.fn(() => null),
  };

  const auditQueryResult: any[] = [];

  const ctx = {
    sessions,
    auth: {
      authEnabled: opts.authEnabled ?? false,
      getKey: vi.fn(() => ({ role: 'admin', permissions: ['create', 'kill'] })),
      check: vi.fn(() => ({ valid: true, keyId: null, permission: 'kill' })),
      getPermissions: vi.fn(() => ['create', 'kill'] as string[]),
      getRole: vi.fn(() => 'admin'),
    },
    config: {
      sseIdleMs: 30_000,
      sseClientTimeoutMs: 60_000,
      acpEnabled: opts.acpEnabled ?? false,
      envDenylist: [],
      envAdminAllowlist: [],
    },
    quotas: {
      checkSessionQuota: vi.fn(() => ({ allowed: true })),
    },
    metrics: {
      sessionCreated: vi.fn(),
      sessionCompleted: vi.fn(),
      sessionFailed: vi.fn(),
      promptSent: vi.fn(),
      getGlobalMetrics: vi.fn((count: number) => ({
        sessions: { total_created: count, completed: count - 1, failed: 0 },
      })),
      getSessionMetrics: vi.fn((id: string) => ({
        promptCount: 5, tokenUsage: { input: 1000, output: 500 },
      })),
      getSessionLatency: vi.fn(() => ({ avgResponseMs: 200 })),
      recordPermissionResponse: vi.fn(), cleanupSession: vi.fn(),
    },
    monitor: { removeSession: vi.fn() },
    eventBus: {
      subscribe: vi.fn(() => vi.fn()),
      emitStatus: vi.fn(),
      emitVerification: vi.fn(),
      emitApproval: vi.fn(),
      emitEnded: vi.fn(),
      getEventsSince: vi.fn(() => []),
    },
    channels: {
      sessionCreated: vi.fn(async () => {}),
      sessionEnded: vi.fn(async () => {}),
      statusChange: vi.fn(async () => {}),
    },
    toolRegistry: {
      getSessionTools: vi.fn(() => [
        { name: 'Read', count: 3, category: 'file' },
      ]),
      processEntries: vi.fn(),
      cleanupSession: vi.fn(),
      getToolDefinitions: vi.fn(() => [
        { name: 'Read', category: 'file', description: 'Read a file' },
      ]),
    },
    sseLimiter: {
      acquire: vi.fn(() => ({ allowed: false, reason: 'per_ip_limit', current: 1, limit: 1 })),
      release: vi.fn(),
      unregisterWriter: vi.fn(),
    },
    memoryBridge: null,
    validateWorkDir: vi.fn(async (dir: string) => dir),
    getAuditLogger: vi.fn(() => ({
      log: vi.fn(async () => {}),
      query: vi.fn(async () => auditQueryResult),
    })),
    alertManager: {},
    jsonlWatcher: {} as any,
    pipelines: {} as any,
    requestKeyMap: new Map(),
    serverState: { draining: false },
    metering: {} as any,
    metricsCache: {} as any,
    acpBackend: null,
    eventStore: {
      list: vi.fn(async () => [{
        eventId: 'evt-1', eventType: 'message.sent', sessionId: SESSION_ID,
        occurredAt: new Date(), ingestedAt: new Date(), payload: {},
      }]),
    },
  } as unknown as RouteContext;

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = null;
    req.tenantId = "_system";
    req.matchedPermission = 'kill';
  });

  registerSessionRoutes(app, ctx);
  registerSessionDataRoutes(app, ctx);

  return { app, sessions, session1, session2, ctx, auditQueryResult };
}

// ─── GET /v1/sessions/history ────────────────────────────────────────────

describe('GET /v1/sessions/history', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns history with active sessions from listSessions', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/history' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
  });

  it('respects page and limit query params', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions/history?page=1&limit=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.limit).toBe(1);
    expect(body.records.length).toBeLessThanOrEqual(1);
  });

  it('returns 400 for invalid query params', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions/history?page=-1',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Invalid query params');
  });

  it('filters by status query param', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions/history?status=active',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const r of body.records) {
      expect(r.finalStatus).toBe('active');
    }
  });

  it('filters by ownerKeyId query param', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions/history?ownerKeyId=key-123',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const r of body.records) {
      expect(r.ownerKeyId).toBe('key-123');
    }
  });
});

// ─── GET /v1/sessions (list) ─────────────────────────────────────────────

describe('GET /v1/sessions', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns sessions with pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessions).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(20);
  });

  it('filters by status', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions?status=working',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const s of body.sessions) {
      expect(s.status).toBe('working');
    }
  });

  it('filters by project', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions?project=alpha',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const s of body.sessions) {
      expect((s.workDir as string).toLowerCase()).toContain('alpha');
    }
  });

  it('returns 400 for invalid pagination params', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions?page=0',
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for limit exceeding max', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions?limit=101',
    });
    expect(res.statusCode).toBe(400);
  });

  it('respects custom page and limit', async () => {
    const res = await app.inject({
      method: 'GET', url: '/v1/sessions?page=2&limit=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.page).toBe(2);
    expect(body.pagination.limit).toBe(1);
  });
});

// ─── GET /v1/sessions/stats ──────────────────────────────────────────────

describe('GET /v1/sessions/stats', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns session stats with byStatus breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.byStatus).toBeDefined();
    expect(body.active).toBeDefined();
    expect(body.totalCreated).toBeDefined();
    expect(typeof body.active).toBe('number');
  });

  it('counts active sessions excluding killed/completed/crashed', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/stats' });
    const body = res.json();
    // session1=idle, session2=working, session3=permission_prompt → all active
    expect(body.active).toBe(3);
    expect(body.byStatus.idle).toBe(1);
    expect(body.byStatus.working).toBe(1);
    expect(body.byStatus.permission_prompt).toBe(1);
  });
});

// ─── DELETE /v1/sessions/batch ───────────────────────────────────────────

describe('DELETE /v1/sessions/batch', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('deletes sessions by ids', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/batch',
      payload: { ids: [SESSION_ID] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBeGreaterThanOrEqual(1);
    expect(sessions.killSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it('deletes sessions by status', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/batch',
      payload: { status: 'idle' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBeGreaterThanOrEqual(0);
  });

  it('returns notFound for non-existent ids', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/batch',
      payload: { ids: ['99999999-9999-4999-8999-999999999999'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notFound).toContain('99999999-9999-4999-8999-999999999999');
    expect(body.deleted).toBe(0);
  });

  it('returns 400 when neither ids nor status provided', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/batch',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('handles kill errors gracefully', async () => {
    sessions.killSession.mockRejectedValueOnce(new Error('kill failed'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/sessions/batch',
      payload: { ids: [SESSION_ID] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toContain('kill failed');
  });
});

// ─── GET /sessions (legacy) ─────────────────────────────────────────────

describe('GET /sessions (legacy)', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns raw array of sessions', async () => {
    const res = await app.inject({ method: 'GET', url: '/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });
});

// ─── GET /v1/sessions/:id ───────────────────────────────────────────────

describe('GET /v1/sessions/:id', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns session data for idle session', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(SESSION_ID);
  });

  it('returns actionHints for permission_prompt session', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID_PERM}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.actionHints).toBeDefined();
    expect(body.actionHints.approve).toBeDefined();
    expect(body.actionHints.reject).toBeDefined();
  });

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/sessions/:id/metrics ────────────────────────────────────────

describe('GET /v1/sessions/:id/metrics', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let ctx: ReturnType<typeof buildApp>['ctx'];

  beforeEach(async () => {
    ({ app, ctx } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns session metrics', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/metrics` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.promptCount).toBe(5);
  });

  it('returns 404 when no metrics exist', async () => {
    (ctx.metrics.getSessionMetrics as any).mockReturnValueOnce(null);
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/metrics` });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/sessions/:id/tools ──────────────────────────────────────────

describe('GET /v1/sessions/:id/tools', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns tools used by session', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/tools` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.tools).toBeInstanceOf(Array);
    expect(body.totalCalls).toBe(3);
  });
});

// ─── GET /v1/tools ───────────────────────────────────────────────────────

describe('GET /v1/tools', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns global tool definitions', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tools' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tools).toBeInstanceOf(Array);
    expect(body.categories).toBeInstanceOf(Array);
    expect(body.totalTools).toBe(1);
  });
});

// ─── GET /v1/sessions/:id/latency ────────────────────────────────────────

describe('GET /v1/sessions/:id/latency', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns realtime and aggregated latency', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}/latency` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.realtime).toBeDefined();
    expect(body.aggregated).toBeDefined();
  });
});

// ─── GET /v1/sessions/:id/transcript/cursor ──────────────────────────────

describe('GET /v1/sessions/:id/transcript/cursor', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns cursor-based transcript', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript/cursor`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toBeInstanceOf(Array);
  });

  it('passes before_id to readTranscriptCursor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript/cursor?before_id=10&limit=25`,
    });
    expect(res.statusCode).toBe(200);
    expect(sessions.readTranscriptCursor).toHaveBeenCalledWith(
      SESSION_ID, 10, 25, undefined,
    );
  });

  it('returns 400 for invalid before_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript/cursor?before_id=-5`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('positive integer');
  });

  it('returns 400 for invalid role filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript/cursor?role=invalid`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid role filter');
  });

  it('returns 404 when readTranscriptCursor throws', async () => {
    sessions.readTranscriptCursor.mockRejectedValueOnce(new Error('no transcript'));
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/transcript/cursor`,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/sessions/:id/hooks/permission ──────────────────────────────

describe('POST /v1/sessions/:id/hooks/permission', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('processes permission hook and updates session status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/hooks/permission`,
      payload: {
        tool_name: 'Write',
        tool_input: { file: '/tmp/test.txt' },
        permission_mode: 'default',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sessions.save).toHaveBeenCalled();
  });

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent/hooks/permission',
      payload: { tool_name: 'Write' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/sessions/:id/hooks/stop ────────────────────────────────────

describe('POST /v1/sessions/:id/hooks/stop', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('processes stop hook and sets status to idle', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/hooks/stop`,
      payload: { stop_reason: 'end_turn' },
    });
    expect(res.statusCode).toBe(200);
    expect(sessions.save).toHaveBeenCalled();
  });

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/nonexistent/hooks/stop',
      payload: { stop_reason: 'end_turn' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/sessions/:id/events/replay ─────────────────────────────────

describe('POST /v1/sessions/:id/events/replay', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let ctx: ReturnType<typeof buildApp>['ctx'];

  beforeEach(async () => {
    ({ app, ctx } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns replayed events', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/events/replay`,
      payload: { afterSeq: 0, limit: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toBeInstanceOf(Array);
    expect(body.count).toBe(1);
  });

  it('returns 400 for invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/events/replay`,
      payload: { afterSeq: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 501 when event store not configured', async () => {
    (ctx as any).eventStore = undefined;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${SESSION_ID}/events/replay`,
      payload: { afterSeq: 0 },
    });
    expect(res.statusCode).toBe(501);
  });
});

// ─── GET /v1/sessions/:id/events/schema ──────────────────────────────────

describe('GET /v1/sessions/:id/events/schema', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns event schema', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${SESSION_ID}/events/schema`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe('1.0');
    expect(body.eventTypes).toBeInstanceOf(Array);
    expect(body.fields).toBeDefined();
    expect(body.eventTypes).toContain('session.created');
    expect(body.eventTypes).toContain('permission.requested');
  });
});

// ─── GET /v1/sessions/health (bulk) ─────────────────────────────────────

describe('GET /v1/sessions/health (bulk)', () => {
  let app: ReturnType<typeof buildApp>['app'];

  beforeEach(async () => {
    ({ app } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns health for all sessions as keyed object', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body).toBe('object');
    // Should have entries for our sessions
    expect(Object.keys(body)).toContain(SESSION_ID);
    expect(body[SESSION_ID].alive).toBe(true);
  });
});

// ─── GET /v1/sessions/:id/health (single) ────────────────────────────────

describe('GET /v1/sessions/:id/health (single)', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp());
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  it('returns health for a specific session', async () => {
    const res = await app.inject({
      method: 'GET', url: `/v1/sessions/${SESSION_ID}/health`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.alive).toBe(true);
  });

  it('returns 404 when getHealth throws', async () => {
    sessions.getHealth.mockRejectedValueOnce(new Error('health check failed'));
    const res = await app.inject({
      method: 'GET', url: `/v1/sessions/${SESSION_ID}/health`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('health check failed');
  });
});
