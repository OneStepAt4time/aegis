/**
 * server-smoke.test.ts — Full server smoke test (Issue #1899).
 *
 * Spins up the Aegis Fastify server with real route modules and mocked
 * infrastructure (tmux, filesystem), then exercises the core flow:
 *   1. GET  /v1/health
 *   2. POST /v1/sessions         — create session
 *   3. POST /v1/sessions/:id/send — send message
 *   4. GET  /v1/sessions/:id/summary — verify response
 */

import Fastify from 'fastify';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

import { SessionManager } from '../session.js';
import { AuthManager, QuotaManager, type ApiKeyPermission } from '../services/auth/index.js';
import { MetricsCollector } from '../metrics.js';
import { SessionMonitor } from '../monitor.js';
import { SessionEventBus } from '../events.js';
import { ChannelManager } from '../channels/index.js';
import { JsonlWatcher } from '../jsonl-watcher.js';
import { PipelineManager } from '../pipeline.js';
import { ToolRegistry } from '../tool-registry.js';
import { AlertManager } from '../alerting.js';
import { SwarmMonitor } from '../swarm-monitor.js';
import { SSEConnectionLimiter } from '../sse-limiter.js';

import {
  registerHealthRoutes,
  registerSessionRoutes,
  registerSessionActionRoutes,
  registerSessionDataRoutes,
  registerAuthRoutes,
  registerAuditRoutes,
  registerEventRoutes,
  registerTemplateRoutes,
  registerPipelineRoutes,
  type RouteContext,
} from '../routes/index.js';

import { createMockTmuxManager, type MockTmuxManager } from './helpers/mock-tmux.js';
import type { Config } from '../config.js';

const MASTER_TOKEN = 'aegis-master-token-2026';

/** Build a lightweight RouteContext with all mocked dependencies. */
async function buildRouteContext(tmpDir: string): Promise<{
  ctx: RouteContext;
  mockTmux: MockTmuxManager;
  sessions: SessionManager;
  auth: AuthManager;
}> {
  const mockTmux = createMockTmuxManager();

  const config = {
    port: 0,
    host: '127.0.0.1',
    authToken: MASTER_TOKEN,
    tmuxSession: 'test-aegis',
    stateDir: tmpDir,
    claudeProjectsDir: join(tmpDir, 'projects'),
    maxSessionAgeMs: 2 * 60 * 60 * 1000,
    reaperIntervalMs: 60 * 60 * 1000,
    continuationPointerTtlMs: 24 * 60 * 60 * 1000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgTopicTTLHours: 0,
    stallThresholdMs: 5 * 60 * 1000,
    defaultPermissionMode: 'default',
    allowedWorkDirs: [],
    defaultSessionEnv: {},
    metricsToken: '',
    hookSecretHeaderOnly: false,
    pipelineStageTimeoutMs: 30_000,
    webhooks: [],
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
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
  } satisfies Config;

  const sessions = new SessionManager(
    mockTmux as unknown as import('../tmux.js').TmuxManager,
    config,
  );
  await sessions.load();

  const auth = new AuthManager(join(tmpDir, 'keys.json'), MASTER_TOKEN);
  auth.setHost('127.0.0.1');

  const metrics = new MetricsCollector(join(tmpDir, 'metrics.json'));
  await metrics.load();

  const eventBus = new SessionEventBus();
  const channels = new ChannelManager();
  const monitor = new SessionMonitor(sessions, channels);

  const jsonlWatcher = new JsonlWatcher();
  const toolRegistry = new ToolRegistry();
  const alertManager = new AlertManager({ webhooks: [] });
  const swarmMonitor = new SwarmMonitor(sessions);
  const sseLimiter = new SSEConnectionLimiter();

  const pipelines = new PipelineManager(
    sessions,
    eventBus,
    undefined,
    config.pipelineStageTimeoutMs,
  );

  const requestKeyMap = new Map<string, string>();

  const ctx: RouteContext = {
    sessions,
    tmux: mockTmux as unknown as import('../tmux.js').TmuxManager,
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
    requestKeyMap,
    serverState: { draining: false },
    validateWorkDir: async (wd: string) => wd,
    metering: {
      getUsageSummary: () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, totalCostUsd: 0, recordCount: 0, sessions: 0 }),
      getUsageByKey: () => [],
      getSessionUsage: () => [],
      getRateTiers: () => [],
      recordTokenUsage: () => {},
      recordToolCall: () => {},
      setRateTiers: () => {},
      onUsage: () => () => {},
      cleanupSession: () => {},
      pruneOlderThan: () => 0,
      start: () => {},
      stop: () => {},
      load: async () => {},
      save: async () => {},
      recordCount: 0,
    } as unknown as import('../metering.js').MeteringService,
  };

  return { ctx, mockTmux, sessions, auth };
}

describe('Server smoke test — full HTTP flow (Issue #1899)', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;
  let routeContext: Awaited<ReturnType<typeof buildRouteContext>>;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-smoke-'));
    routeContext = await buildRouteContext(tmpDir);

    app = Fastify({ logger: false });

    // #1108: Decorate request with authKeyId (required by route guards)
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('tenantId', undefined as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);

    // Auth middleware — mirrors server.ts setupAuth() in simplified form.
    // For the smoke test, validate against the master token only.
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const urlPath = req.url?.split('?')[0] ?? '';

      // Public routes — skip auth
      if (urlPath === '/health' || urlPath === '/v1/health') return;
      if (urlPath === '/v1/auth/verify') return;
      if (urlPath === '/dashboard' || urlPath.startsWith('/dashboard/')) return;

      // Hook routes — not under test
      if (/^\/v1\/hooks\/[A-Za-z]+$/.test(urlPath)) return;

      // WS terminal — not under test
      if (/^\/v1\/sessions\/[^/]+\/terminal$/.test(urlPath)) return;

      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

      if (!token) {
        return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
      }

      const result = routeContext.auth.validate(token);
      if (!result.valid) {
        return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
      }

      req.authKeyId = result.keyId;
      req.tenantId = result.keyId === 'master' ? '_system' : undefined;
    });

    // UUID validation hook — mirrors server.ts
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const id = (req.params as Record<string, string | undefined>).id;
      if (id !== undefined) {
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(id)) {
          return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
        }
      }
    });

    // Register all route modules
    const { ctx } = routeContext;
    registerHealthRoutes(app, ctx);
    registerAuthRoutes(app, ctx);
    registerAuditRoutes(app, ctx);
    registerSessionRoutes(app, ctx);
    registerSessionActionRoutes(app, ctx);
    registerSessionDataRoutes(app, ctx);
    registerEventRoutes(app, ctx);
    registerTemplateRoutes(app, ctx);
    registerPipelineRoutes(app, ctx);

    // Listen on random free port
    await app.listen({ port: 0, host: '127.0.0.1' });
  });

  afterEach(async () => {
    // Kill any sessions created during each test to avoid cross-contamination
    const all = routeContext.sessions.listSessions();
    for (const s of all) {
      try { await routeContext.sessions.killSession(s.id); } catch { /* best effort */ }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  /** Helper to inject authenticated requests. */
  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${MASTER_TOKEN}` };
  }

  // ── Step 1: Health check ──────────────────────────────────────────
  it('GET /v1/health returns ok (authenticated, full data)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(body.sessions).toBeDefined();
  });

  it('GET /v1/health unauthenticated returns minimal data (Issue #2066)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeUndefined(); // stripped for unauthenticated
    expect(body.sessions).toBeDefined();
    expect(body.sessions.active).toBeDefined();
    expect(body.sessions.total).toBeUndefined(); // stripped for unauthenticated
  });

  // ── Step 2: Create session ────────────────────────────────────────
  it('POST /v1/sessions creates a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      payload: { workDir: tmpDir },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.workDir).toBe(tmpDir);
    expect(body.windowId).toBeDefined();
    expect(body.windowName).toBeDefined();
    expect(typeof body.createdAt).toBe('number');

    // Verify session appears in listing
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: authHeaders(),
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(list.sessions.length).toBeGreaterThanOrEqual(1);
    expect(list.sessions.some((s: { id: string }) => s.id === body.id)).toBe(true);
  });

  // ── Step 3: Send message ──────────────────────────────────────────
  it('POST /v1/sessions/:id/send delivers a message', async () => {
    // Create session first
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      payload: { workDir: tmpDir },
    });
    expect(createRes.statusCode).toBe(201);
    const { id } = createRes.json();

    // Send message
    const sendRes = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${id}/send`,
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      payload: { text: 'Hello from smoke test' },
    });

    expect(sendRes.statusCode).toBe(200);
    const sendBody = sendRes.json();
    expect(sendBody.ok).toBe(true);
    expect(typeof sendBody.delivered).toBe('boolean');
    expect(typeof sendBody.attempts).toBe('number');
  });

  // ── Step 4: Get summary ───────────────────────────────────────────
  it('GET /v1/sessions/:id/summary returns session summary', async () => {
    // Create session
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      payload: { workDir: tmpDir },
    });
    expect(createRes.statusCode).toBe(201);
    const { id } = createRes.json();

    // Get summary
    const summaryRes = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${id}/summary`,
      headers: authHeaders(),
    });

    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json();
    expect(summary.sessionId).toBe(id);
    expect(summary.windowName).toBeDefined();
    expect(summary.status).toBeDefined();
    expect(typeof summary.totalMessages).toBe('number');
    expect(Array.isArray(summary.messages)).toBe(true);
    expect(typeof summary.createdAt).toBe('number');
    expect(typeof summary.lastActivity).toBe('number');
  });

  // ── Auth enforcement ──────────────────────────────────────────────
  it('rejects unauthenticated requests to protected routes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'Content-Type': 'application/json' },
      payload: { workDir: tmpDir },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid bearer tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: {
        Authorization: 'Bearer wrong-token',
        'Content-Type': 'application/json',
      },
      payload: { workDir: tmpDir },
    });
    expect(res.statusCode).toBe(401);
  });
});
