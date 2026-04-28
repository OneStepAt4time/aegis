/**
 * mcp-integration-smoke-1898.test.ts — Integration smoke tests for MCP tool
 * invocation through the Aegis HTTP API.
 *
 * Tests exercise the FULL server stack: real Fastify routes, real auth
 * middleware, real Zod validation, real response serialization. Only the
 * infrastructure layer (tmux, SessionManager) is mocked so tests pass in CI
 * without tmux or Claude Code.
 *
 * Issue #1898
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';
import type { Config } from '../config.js';
import { AuthManager, type ApiKeyPermission } from '../services/auth/index.js';
import { SessionEventBus } from '../events.js';
import { MetricsCollector } from '../metrics.js';
import { ToolRegistry } from '../tool-registry.js';
import { SSEConnectionLimiter } from '../sse-limiter.js';
import { ChannelManager } from '../channels/index.js';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';
import { AlertManager } from '../alerting.js';
import { SwarmMonitor } from '../swarm-monitor.js';
import { PipelineManager } from '../pipeline.js';
import { JsonlWatcher } from '../jsonl-watcher.js';
import type { SessionInfo } from '../session.js';
import {
  registerHealthRoutes,
  registerSessionRoutes,
  registerSessionActionRoutes,
  registerSessionDataRoutes,
  type RouteContext,
} from '../routes/index.js';
import { requireRole, addActionHints } from '../routes/context.js';

// ── Test constants ──────────────────────────────────────────────────
const AUTH_TOKEN = 'aegis-master-token-2026';
const AUTH_HEADER = { authorization: `Bearer ${AUTH_TOKEN}` };

// ── Mock SessionManager ─────────────────────────────────────────────

function createMockSession(
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id: crypto.randomUUID(),
    windowId: '@1',
    windowName: 'cc-test',
    workDir: '/tmp/test-project',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 120_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

function createMockSessionManager() {
  const sessions = new Map<string, SessionInfo>();

  return {
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    listSessions: vi.fn(() => Array.from(sessions.values())),
    createSession: vi.fn(async (opts: Record<string, unknown>) => {
      const session = createMockSession({
        workDir: (opts.workDir as string) ?? '/tmp',
        windowName: (opts.name as string) ?? `cc-${Date.now().toString(36)}`,
        ownerKeyId: opts.ownerKeyId as string | undefined,
      });
      sessions.set(session.id, session);
      return session;
    }),
    sendMessage: vi.fn(async (_id: string, text: string) => ({
      delivered: true,
      attempts: 1,
    })),
    sendInitialPrompt: vi.fn(async (_id: string, _prompt: string) => ({
      delivered: true,
      attempts: 1,
    })),
    getSummary: vi.fn(async (id: string) => {
      const session = sessions.get(id);
      if (!session) throw new Error(`Session ${id} not found`);
      return {
        sessionId: session.id,
        windowName: session.windowName,
        status: session.status,
        totalMessages: 0,
        messages: [],
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        permissionMode: session.permissionMode,
      };
    }),
    killSession: vi.fn(async (id: string) => {
      sessions.delete(id);
    }),
    save: vi.fn(async () => {}),
    load: vi.fn(async () => {}),
    findIdleSessionByWorkDir: vi.fn(async () => null),
    releaseSessionClaim: vi.fn(),
    getPendingQuestionInfo: vi.fn(() => null),
    readMessages: vi.fn(async () => []),
    approve: vi.fn(async () => {}),
    reject: vi.fn(async () => {}),
    escape: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    getLatencyMetrics: vi.fn(() => null),
    setEncryptionKey: vi.fn(),

    // Internal store access for tests
    _store: sessions,
  };
}

// ── Mock Auth Middleware ─────────────────────────────────────────────
// The real setupAuth() lives inside server.ts and is not exported.
// We recreate the essential auth hook for integration testing.

function setupTestAuth(
  app: FastifyInstance,
  authManager: AuthManager,
): void {
  app.decorateRequest('authKeyId', null as unknown as string);
  app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);

  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    // Skip auth for health and dashboard
    if (urlPath === '/health' || urlPath === '/v1/health') return;
    if (urlPath === '/v1/auth/verify') return;
    if (urlPath === '/dashboard' || urlPath.startsWith('/dashboard/')) return;

    // Bearer token extraction
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }
    const token = authHeader.slice(7);

    const result = authManager.validate(token);
    if (!result.valid) {
      if (result.reason === 'expired') {
        return reply.status(401).send({ error: 'Unauthorized — API key has expired', code: 'KEY_EXPIRED' });
      }
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }
    if (result.rateLimited) {
      return reply.status(429).send({ error: 'Rate limit exceeded' });
    }
    req.authKeyId = result.keyId;
  });
}

// ── Helper: build a fully-wired test server ─────────────────────────

async function buildTestServer(): Promise<{
  app: FastifyInstance;
  sessions: ReturnType<typeof createMockSessionManager>;
  auth: AuthManager;
}> {
  const app = Fastify({ logger: false, bodyLimit: 1048576 });

  await app.register(fastifyRateLimit, {
    global: true,
    keyGenerator: (req) => req.ip ?? 'unknown',
    max: 600,
    timeWindow: '1 minute',
  });

  const mockSessions = createMockSessionManager();

  const config: Config = {
    port: 0,
    host: '127.0.0.1',
    authToken: AUTH_TOKEN,
    tmuxSession: 'test',
    stateDir: '/tmp/aegis-test-state',
    claudeProjectsDir: '/tmp/.claude/projects',
    maxSessionAgeMs: 2 * 60 * 60 * 1000,
    reaperIntervalMs: 5 * 60 * 1000,
    continuationPointerTtlMs: 24 * 60 * 60 * 1000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 24 * 60 * 60 * 1000,
    tgTopicAutoDelete: true,
    tgTopicTTLHours: 0,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default',
    stallThresholdMs: 120_000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    metricsToken: '',
    pipelineStageTimeoutMs: 0,
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 600_000 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: true,
    sseIdleMs: 60_000,
    sseClientTimeoutMs: 300_000,
    hookTimeoutMs: 10_000,
    shutdownGraceMs: 15_000,
      keyRotationGraceSeconds: 3600,
    shutdownHardMs: 20_000,
    rateLimit: { enabled: true, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 },
    stateStore: 'file',
    postgresUrl: '',
    defaultTenantId: 'default',
    tenantWorkdirs: {},
  };

  const auth = new AuthManager('/tmp/aegis-test-keys.json', AUTH_TOKEN);
  auth.setHost('127.0.0.1');
  await auth.load();

  setupTestAuth(app, auth);

  const eventBus = new SessionEventBus();
  const channels = new ChannelManager();
  const metrics = new MetricsCollector('/tmp/aegis-test-metrics.json');
  await metrics.load();
  const toolRegistry = new ToolRegistry();
  const sseLimiter = new SSEConnectionLimiter({ maxConnections: 100, maxPerIp: 10 });
  const monitor = new SessionMonitor(
    mockSessions as never,
    channels,
    { ...DEFAULT_MONITOR_CONFIG, pollIntervalMs: 60_000 },
  );
  monitor.setEventBus(eventBus);
  const alertManager = new AlertManager(config.alerting);
  const swarmMonitor = new SwarmMonitor(mockSessions as never);
  const jsonlWatcher = new JsonlWatcher();
  const pipelines = new PipelineManager(
    mockSessions as never,
    eventBus,
    undefined,
    config.pipelineStageTimeoutMs,
  );

  const { QuotaManager } = await import('../services/auth/QuotaManager.js');
  const routeCtx: RouteContext = {
    sessions: mockSessions as never,
    tmux: {
      ensureSession: vi.fn(),
      capturePane: vi.fn(async () => ''),
      isServerHealthy: vi.fn(async () => ({ healthy: true, error: null })),
      getWindowHealth: vi.fn(async () => ({
        windowExists: true,
        paneCommand: null,
        claudeRunning: false,
        paneDead: false,
      })),
      windowExists: vi.fn(async () => true),
    } as never,
    auth,
    quotas: new QuotaManager(),
    config,
    metrics,
    monitor,
    eventBus,
    channels,
    jsonlWatcher,
    pipelines,
    toolRegistry,
    getAuditLogger: () => undefined,
    alertManager,
    swarmMonitor,
    sseLimiter,
    memoryBridge: null,
    requestKeyMap: new Map(),
    serverState: { draining: false },
    validateWorkDir: async (wd: string) => wd,
    metering: {
      getUsageSummary: vi.fn(() => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, totalCostUsd: 0, recordCount: 0, sessions: 0 })),
      getUsageByKey: vi.fn(() => []),
      getSessionUsage: vi.fn(() => []),
      getRateTiers: vi.fn(() => []),
      recordTokenUsage: vi.fn(),
      recordToolCall: vi.fn(),
      setRateTiers: vi.fn(),
      onUsage: vi.fn(() => () => {}),
      cleanupSession: vi.fn(),
      pruneOlderThan: vi.fn(() => 0),
      start: vi.fn(),
      stop: vi.fn(),
      load: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      recordCount: 0,
    } as never,
    metricsCache: { getMetrics: vi.fn(() => ({ sessionVolume: [], tokenUsageByModel: [], costTrends: [], topApiKeys: [], durationTrends: [], errorRates: { totalSessions: 0, failedSessions: 0, failureRate: 0, permissionPrompts: 0, approvals: 0, autoApprovals: 0 }, generatedAt: new Date().toISOString() })), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), invalidate: vi.fn(), flush: vi.fn(async () => {}) } as never,
    rateLimiter: {
      checkIpRateLimit: vi.fn(() => false),
      checkAuthFailRateLimit: vi.fn(() => false),
      recordAuthFailure: vi.fn(),
      pruneAuthFailLimits: vi.fn(),
      pruneIpRateLimits: vi.fn(),
      getRateLimitConfig: vi.fn(() => ({ ipNormal: 120, ipMaster: 300, ipWindowMs: 60_000 })),
      getIpStats: vi.fn(() => ({ activeIps: 0, limitedIps: 0 })),
      getKeyStats: vi.fn(() => []),
      getThrottleHistory: vi.fn(() => []),
    } as never,
  };

  registerHealthRoutes(app, routeCtx);
  registerSessionRoutes(app, routeCtx);
  registerSessionActionRoutes(app, routeCtx);
  registerSessionDataRoutes(app, routeCtx);

  await app.ready();
  return { app, sessions: mockSessions, auth };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('MCP Integration Smoke Tests (#1898)', () => {
  let server: Awaited<ReturnType<typeof buildTestServer>>;

  beforeEach(async () => {
    server = await buildTestServer();
  });

  afterEach(async () => {
    await server.app.close();
  });

  // ── Auth gate ────────────────────────────────────────────────────

  describe('Auth middleware', () => {
    it('rejects unauthenticated requests to POST /v1/sessions', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        payload: { workDir: '/tmp' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/Unauthorized/i);
    });

    it('rejects wrong bearer token', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer wrong-token' },
        payload: { workDir: '/tmp' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('accepts valid master token', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp' },
      });
      // 201 = created, not 401
      expect(res.statusCode).not.toBe(401);
    });
  });

  // ── POST /v1/sessions ────────────────────────────────────────────

  describe('POST /v1/sessions — session creation', () => {
    it('creates a session with valid payload', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: {
          workDir: '/tmp/my-project',
          name: 'smoke-test-session',
          prompt: 'Say hello',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe('string');
      expect(body.workDir).toBe('/tmp/my-project');
      expect(body.windowName).toBe('smoke-test-session');
      expect(body.status).toBe('idle');
      expect(body).toHaveProperty('createdAt');
    });

    it('returns promptDelivery when prompt is provided', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp', prompt: 'hello' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.promptDelivery).toEqual({ delivered: true, attempts: 1 });
    });

    it('rejects missing workDir', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { name: 'no-workdir' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/Invalid request body/i);
    });

    it('rejects invalid permissionMode', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp', permissionMode: 'invalid_mode' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects unknown fields (strict schema)', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp', unknownField: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /v1/sessions ─────────────────────────────────────────────

  describe('GET /v1/sessions — session listing', () => {
    it('returns empty list when no sessions', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toEqual([]);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.total).toBe(0);
    });

    it('lists created sessions', async () => {
      // Create a session first
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp/project-a' },
      });
      expect(createRes.statusCode).toBe(201);
      const created = JSON.parse(createRes.body);

      // List sessions
      const listRes = await server.app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
      });
      expect(listRes.statusCode).toBe(200);
      const body = JSON.parse(listRes.body);
      expect(body.sessions.length).toBeGreaterThanOrEqual(1);
      const found = body.sessions.find((s: SessionInfo) => s.id === created.id);
      expect(found).toBeDefined();
      expect(found.workDir).toBe('/tmp/project-a');
    });

    it('supports pagination', async () => {
      // Create 3 sessions
      for (let i = 0; i < 3; i++) {
        await server.app.inject({
          method: 'POST',
          url: '/v1/sessions',
          headers: AUTH_HEADER,
          payload: { workDir: `/tmp/p-${i}` },
        });
      }

      const res = await server.app.inject({
        method: 'GET',
        url: '/v1/sessions?limit=2&page=1',
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions.length).toBe(2);
      expect(body.pagination.limit).toBe(2);
      expect(body.pagination.total).toBeGreaterThanOrEqual(3);
      expect(body.pagination.page).toBe(1);
    });

    it('requires authentication', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: '/v1/sessions',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /v1/sessions/:id/send ───────────────────────────────────

  describe('POST /v1/sessions/:id/send — message delivery', () => {
    it('sends a message to an existing session', async () => {
      // Create a session
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp' },
      });
      const { id } = JSON.parse(createRes.body);

      // Send a message
      const sendRes = await server.app.inject({
        method: 'POST',
        url: `/v1/sessions/${id}/send`,
        headers: AUTH_HEADER,
        payload: { text: 'Hello, Claude!' },
      });
      expect(sendRes.statusCode).toBe(200);
      const body = JSON.parse(sendRes.body);
      expect(body.ok).toBe(true);
      expect(body.delivered).toBe(true);
      expect(body.attempts).toBe(1);
    });

    it('rejects empty text', async () => {
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp' },
      });
      const { id } = JSON.parse(createRes.body);

      const sendRes = await server.app.inject({
        method: 'POST',
        url: `/v1/sessions/${id}/send`,
        headers: AUTH_HEADER,
        payload: { text: '' },
      });
      expect(sendRes.statusCode).toBe(400);
    });

    it('rejects missing text field', async () => {
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp' },
      });
      const { id } = JSON.parse(createRes.body);

      const sendRes = await server.app.inject({
        method: 'POST',
        url: `/v1/sessions/${id}/send`,
        headers: AUTH_HEADER,
        payload: {},
      });
      expect(sendRes.statusCode).toBe(400);
    });

    it('returns 404 for unknown session', async () => {
      const fakeId = crypto.randomUUID();
      const sendRes = await server.app.inject({
        method: 'POST',
        url: `/v1/sessions/${fakeId}/send`,
        headers: AUTH_HEADER,
        payload: { text: 'test' },
      });
      expect(sendRes.statusCode).toBe(404);
    });

    it('requires authentication', async () => {
      const res = await server.app.inject({
        method: 'POST',
        url: `/v1/sessions/${crypto.randomUUID()}/send`,
        payload: { text: 'test' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /v1/sessions/:id/summary ─────────────────────────────────

  describe('GET /v1/sessions/:id/summary — transcript retrieval', () => {
    it('returns summary for an existing session', async () => {
      // Create a session
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: { workDir: '/tmp/summary-test' },
      });
      const { id } = JSON.parse(createRes.body);

      // Get summary
      const summaryRes = await server.app.inject({
        method: 'GET',
        url: `/v1/sessions/${id}/summary`,
        headers: AUTH_HEADER,
      });
      expect(summaryRes.statusCode).toBe(200);
      const body = JSON.parse(summaryRes.body);
      expect(body.sessionId).toBe(id);
      expect(body.status).toBe('idle');
      expect(body).toHaveProperty('totalMessages');
      expect(body).toHaveProperty('messages');
      expect(body).toHaveProperty('createdAt');
      expect(body).toHaveProperty('lastActivity');
      expect(body).toHaveProperty('permissionMode');
    });

    it('returns 404 for unknown session', async () => {
      const fakeId = crypto.randomUUID();
      const res = await server.app.inject({
        method: 'GET',
        url: `/v1/sessions/${fakeId}/summary`,
        headers: AUTH_HEADER,
      });
      expect(res.statusCode).toBe(404);
    });

    it('requires authentication', async () => {
      const res = await server.app.inject({
        method: 'GET',
        url: `/v1/sessions/${crypto.randomUUID()}/summary`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Full lifecycle ───────────────────────────────────────────────

  describe('Full session lifecycle', () => {
    it('create → list → send → summary → kill', async () => {
      // 1. Create
      const createRes = await server.app.inject({
        method: 'POST',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
        payload: {
          workDir: '/tmp/lifecycle-test',
          name: 'lifecycle-session',
          prompt: 'Initial prompt',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const { id } = JSON.parse(createRes.body);
      expect(id).toBeDefined();

      // 2. List — session should appear
      const listRes = await server.app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
      });
      expect(listRes.statusCode).toBe(200);
      const listed = JSON.parse(listRes.body);
      const found = listed.sessions.find((s: SessionInfo) => s.id === id);
      expect(found).toBeDefined();
      expect(found.workDir).toBe('/tmp/lifecycle-test');

      // 3. Send message
      const sendRes = await server.app.inject({
        method: 'POST',
        url: `/v1/sessions/${id}/send`,
        headers: AUTH_HEADER,
        payload: { text: 'Follow-up message' },
      });
      expect(sendRes.statusCode).toBe(200);
      expect(JSON.parse(sendRes.body).ok).toBe(true);

      // 4. Summary
      const summaryRes = await server.app.inject({
        method: 'GET',
        url: `/v1/sessions/${id}/summary`,
        headers: AUTH_HEADER,
      });
      expect(summaryRes.statusCode).toBe(200);
      const summary = JSON.parse(summaryRes.body);
      expect(summary.sessionId).toBe(id);

      // 5. Kill
      const killRes = await server.app.inject({
        method: 'DELETE',
        url: `/v1/sessions/${id}`,
        headers: AUTH_HEADER,
      });
      expect(killRes.statusCode).toBe(200);
      expect(JSON.parse(killRes.body).ok).toBe(true);

      // 6. Verify gone from listing
      const listAfterRes = await server.app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: AUTH_HEADER,
      });
      const listedAfter = JSON.parse(listAfterRes.body);
      const foundAfter = listedAfter.sessions.find((s: SessionInfo) => s.id === id);
      expect(foundAfter).toBeUndefined();
    });
  });
});
