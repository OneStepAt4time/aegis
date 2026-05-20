/**
 * no-runner-prompt-3797.test.ts — Tests for Issue #3797.
 *
 * When acpEnabled=false and no runner is available, the API must not
 * silently return 201 with promptDelivery.delivered=false. It must
 * return 422 with NO_RUNNER_AVAILABLE.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';
import type { SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-id',
    displayName: 'test-session',
    workDir: '/tmp/test-project',
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    ownerKeyId: null,
    tenantId: '_system',
    ...overrides,
  } as SessionInfo;
}

function buildApp(opts: { acpEnabled?: boolean; sendInitialPromptDelivered?: boolean } = {}) {
  const sessionMap = new Map<string, SessionInfo>();

  const sessions = {
    getSession: vi.fn((id: string) => sessionMap.get(id)),
    listSessions: vi.fn(() => Array.from(sessionMap.values())),
    killSession: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    createSession: vi.fn(async (o: any) => {
      const s = makeSession({ id: `new-${Date.now()}`, ...o });
      sessionMap.set(s.id, s);
      return s;
    }),
    findIdleSessionByWorkDir: vi.fn(async () => null),
    sendInitialPrompt: vi.fn(async () => ({
      delivered: opts.sendInitialPromptDelivered ?? false,
      attempts: 0,
    })),
    releaseSessionClaim: vi.fn(),
    getHealth: vi.fn(async () => ({ alive: false, claudeRunning: false, status: 'idle', hasTranscript: false, lastActivity: 0, lastActivityAgo: 0, sessionAge: 0, details: 'OK' })),
    getSummary: vi.fn(async () => ({ summary: '', sessionId: '' })),
    getLatencyMetrics: vi.fn(() => ({})),
    readTranscript: vi.fn(async () => ({ messages: [], total: 0, page: 1, limit: 50, hasMore: false })),
    readTranscriptCursor: vi.fn(async () => ({ messages: [], hasMore: false, nextCursorId: null })),
    getPendingPermissionInfo: vi.fn(() => null),
    getPendingQuestionInfo: vi.fn(() => null),
  };

  const ctx = {
    sessions,
    auth: {
      authEnabled: false,
      getKey: vi.fn(() => ({ role: 'admin', permissions: ['create', 'kill'] })),
      check: vi.fn(() => ({ valid: true, keyId: null, permission: 'create' })),
      getPermissions: vi.fn(() => ['create', 'kill']),
      getRole: vi.fn(() => 'admin'),
    },
    config: { sseIdleMs: 30000, sseClientTimeoutMs: 60000, acpEnabled: opts.acpEnabled ?? false, envDenylist: [], envAdminAllowlist: [] },
    quotas: { checkSessionQuota: vi.fn(() => ({ allowed: true })) },
    metrics: { sessionCreated: vi.fn(), sessionCompleted: vi.fn(), sessionFailed: vi.fn(), promptSent: vi.fn(), getGlobalMetrics: vi.fn(() => ({})), getSessionMetrics: vi.fn(() => ({})), getSessionLatency: vi.fn(() => ({})), recordPermissionResponse: vi.fn(), cleanupSession: vi.fn() },
    monitor: { removeSession: vi.fn() },
    eventBus: { subscribe: vi.fn(() => vi.fn()), emitStatus: vi.fn(), emitVerification: vi.fn(), emitApproval: vi.fn(), emitEnded: vi.fn(), getEventsSince: vi.fn(() => []) },
    channels: { sessionCreated: vi.fn(async () => {}), sessionEnded: vi.fn(async () => {}), statusChange: vi.fn(async () => {}) },
    toolRegistry: { getSessionTools: vi.fn(() => []), processEntries: vi.fn(), cleanupSession: vi.fn(), getToolDefinitions: vi.fn(() => []) },
    sseLimiter: { acquire: vi.fn(() => ({ allowed: true })), release: vi.fn(), unregisterWriter: vi.fn() },
    memoryBridge: null,
    validateWorkDir: vi.fn(async (dir: string) => dir),
    getAuditLogger: vi.fn(() => ({ log: vi.fn(async () => {}), query: vi.fn(async () => []) })),
    alertManager: {},
    jsonlWatcher: {} as any,
    pipelines: {} as any,
    requestKeyMap: new Map(),
    serverState: { draining: false },
    metering: {} as any,
    metricsCache: {} as any,
    acpBackend: null,
    eventStore: { list: vi.fn(async () => []) },
  } as unknown as RouteContext;

  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req: any) => {
    req.authKeyId = null;
    req.tenantId = '_system';
    req.matchedPermission = 'create';
  });

  registerSessionRoutes(app, ctx);

  return { app, sessions, ctx };
}

describe('Issue #3797: NO_RUNNER_AVAILABLE when no runner and prompt provided', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let sessions: ReturnType<typeof buildApp>['sessions'];

  beforeEach(async () => {
    ({ app, sessions } = buildApp({ acpEnabled: false }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 422 NO_RUNNER_AVAILABLE on create path when ACP disabled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: {
        workDir: '/tmp/test-project',
        prompt: 'Hello, do something',
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('NO_RUNNER_AVAILABLE');
    expect(body.message).toContain('no agent runner available');
  });

  it('returns 422 NO_RUNNER_AVAILABLE on reuse path when ACP disabled', async () => {
    // Create a pre-existing idle session so reuse path triggers
    const existing = makeSession({ id: 'idle-1', workDir: '/tmp/test-project', status: 'idle' });
    sessions.createSession = vi.fn(async (o: any) => {
      const s = makeSession({ id: 'idle-1', ...o });
      return s;
    });
    sessions.findIdleSessionByWorkDir = vi.fn(async () => existing) as any;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: {
        workDir: '/tmp/test-project',
        prompt: 'Reuse and fail',
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('NO_RUNNER_AVAILABLE');
  });

  it('creates session without prompt when ACP disabled (no runner needed)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: {
        workDir: '/tmp/test-project',
      },
    });

    // Without a prompt, no runner is needed — session should be created normally
    expect(response.statusCode).toBe(201);
  });

  it('allows prompt delivery when ACP is enabled', async () => {
    const { app: acpApp } = buildApp({ acpEnabled: true, sendInitialPromptDelivered: false });
    // When ACP is enabled, the ACP backend handles delivery — we skip the 422 check
    // (the ACP path is separate and handled by acpBackend.sendPrompt)
    await acpApp.ready();

    const response = await acpApp.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: {
        workDir: '/tmp/test-project',
        prompt: 'Hello with ACP',
      },
    });

    // With ACP enabled but no acpBackend, it goes to createSession (non-ACP else branch)
    // then sendInitialPrompt returns false — but since acpEnabled is true, it should NOT 422
    // Actually: acpEnabled=true but acpBackend=null means it goes to the else branch (no ACP backend)
    // and sendInitialPrompt returns false. The check is !ctx.config.acpEnabled — since it's true,
    // the 422 should NOT trigger. The session will be created with delivered=false but no 422.
    expect(response.statusCode).toBe(201);
    await acpApp.close();
  });
});
