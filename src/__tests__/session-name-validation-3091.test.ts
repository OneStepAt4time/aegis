/**
 * session-name-validation-3091.test.ts — Tests for Issue #3091.
 * Verifies that POST /v1/sessions rejects special characters in name/label
 * that could cause injection or 500 errors.
 */

import Fastify from 'fastify';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

import { SessionManager } from '../session.js';
import { AuthManager, DashboardSessionStore, QuotaManager, type ApiKeyPermission } from '../services/auth/index.js';
import { MetricsCollector } from '../metrics.js';
import { SessionMonitor } from '../monitor.js';
import { SessionEventBus } from '../events.js';
import { ChannelManager } from '../channels/index.js';
import { JsonlWatcher } from '../jsonl-watcher.js';
import { PipelineManager } from '../pipeline.js';
import { ToolRegistry } from '../tool-registry.js';
import { AlertManager } from '../alerting.js';
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

import { type Config } from '../config.js';

function createMockBackend() {
  return {
    ensureSession: vi.fn().mockResolvedValue(undefined),
    listWindows: vi.fn().mockResolvedValue([]),
    createWindow: vi.fn().mockResolvedValue({ windowId: '@1', displayName: 'mock', freshSessionId: 'mock-session' }),
    capturePane: vi.fn().mockResolvedValue(''),
    capturePaneDirect: vi.fn().mockResolvedValue(''),
    listPanePid: vi.fn().mockResolvedValue(12345),
    isPidAlive: vi.fn().mockResolvedValue(true),
    getWindowHealth: vi.fn().mockResolvedValue({ windowExists: true, paneCommand: null, claudeRunning: false, paneDead: false }),
    windowExists: vi.fn().mockResolvedValue(true),
    sendKeys: vi.fn().mockResolvedValue({ success: true }),
    sendKeysVerified: vi.fn().mockResolvedValue({ delivered: true, attempts: 1 }),
    sendSpecialKey: vi.fn().mockResolvedValue({ success: true }),
    killWindow: vi.fn().mockResolvedValue({ success: true }),
    killSession: vi.fn().mockResolvedValue({ success: true }),
    isServerHealthy: vi.fn().mockResolvedValue({ healthy: true, error: null }),
    isTmuxServerError: vi.fn().mockReturnValue(false),
  };
}

const MASTER_TOKEN = 'aegis-master-token-3091';

async function buildRouteContext(tmpDir: string) {
  const mockTmux = createMockBackend();

  const config = {
    port: 0, host: '127.0.0.1', authToken: MASTER_TOKEN,
    stateDir: tmpDir,
    claudeProjectsDir: join(tmpDir, 'projects'),
    maxSessionAgeMs: 2 * 60 * 60 * 1000, reaperIntervalMs: 60 * 60 * 1000,
    continuationPointerTtlMs: 24 * 60 * 60 * 1000,
    tgBotToken: '', tgGroupId: '', tgAllowedUsers: [], tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgVerbose: false, tgTopicTTLHours: 0,
    stallThresholdMs: 5 * 60 * 1000, defaultPermissionMode: 'default',
    allowedWorkDirs: [], defaultSessionEnv: {}, metricsToken: '',
    hookSecretHeaderOnly: false, pipelineStageTimeoutMs: 30_000,
    webhooks: [], sseMaxConnections: 100, sseMaxPerIp: 10,
    memoryBridge: { enabled: false }, worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 600_000 },
    envDenylist: [], envAdminAllowlist: [], enforceSessionOwnership: true,
      strictRBAC: false,
    sseIdleMs: 60_000, sseClientTimeoutMs: 300_000, hookTimeoutMs: 10_000,
    shutdownGraceMs: 15_000, keyRotationGraceSeconds: 3600, shutdownHardMs: 20_000,
      acpPromptTimeoutMs: 120_000,
    rateLimit: { enabled: true, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 },
    stateStore: 'file', postgresUrl: '', defaultTenantId: 'default', acpEnabled: false,
    tenantWorkdirs: {},
  } satisfies Config;

  const sessions = new SessionManager(config);
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
  const swarmMonitor = { start: vi.fn(), stop: vi.fn(), getStats: vi.fn() };
  const sseLimiter = new SSEConnectionLimiter();
  const pipelines = new PipelineManager(sessions, eventBus, undefined, config.pipelineStageTimeoutMs);
  const requestKeyMap = new Map<string, string>();
  const dashboardTokenSessions = new DashboardSessionStore();

  const ctx: RouteContext = {
    sessions,
    auth, quotas: new QuotaManager(), config, metrics, monitor, eventBus, channels,
    jsonlWatcher, pipelines, toolRegistry,
    getAuditLogger: () => undefined, alertManager, sseLimiter,
    memoryBridge: null, requestKeyMap, serverState: { draining: false },
    validateWorkDir: async (wd: string) => wd,
    metering: {
      getUsageSummary: () => ({ totalInputTokens: 0, totalOutputTokens: 0, totalCacheCreationTokens: 0, totalCacheReadTokens: 0, totalCostUsd: 0, recordCount: 0, sessions: 0 }),
      getUsageByKey: () => [], getSessionUsage: () => [], getRateTiers: () => [],
      recordTokenUsage: () => {}, recordToolCall: () => {}, setRateTiers: () => {},
      onUsage: () => () => {}, cleanupSession: () => {}, pruneOlderThan: () => 0,
      start: () => {}, stop: () => {}, load: async () => {}, save: async () => {},
      recordCount: 0,
    } as unknown as import('../metering.js').MeteringService,
    metricsCache: { getMetrics: vi.fn(() => ({ sessionVolume: [], tokenUsageByModel: [], costTrends: [], topApiKeys: [], durationTrends: [], errorRates: { totalSessions: 0, failedSessions: 0, failureRate: 0, permissionPrompts: 0, approvals: 0, autoApprovals: 0 }, generatedAt: new Date().toISOString() })), start: vi.fn(async () => {}), stop: vi.fn(async () => {}), invalidate: vi.fn(), flush: vi.fn(async () => {}) } as unknown as RouteContext['metricsCache'],
    dashboardTokenSessions,
  };

  return { ctx, mockTmux, sessions, auth };
}

describe('POST /v1/sessions — name/label validation (Issue #3091)', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;
  let routeContext: Awaited<ReturnType<typeof buildRouteContext>>;
  let port: number;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-name-3091-'));
    routeContext = await buildRouteContext(tmpDir);
    app = Fastify({ logger: false });

    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('tenantId', undefined as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
    app.decorateRequest('authRole', null);
    app.decorateRequest('authPermissions', null);
    app.decorateRequest('authActor', null);

    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const urlPath = req.url?.split('?')[0] ?? '';
      if (urlPath === '/health' || urlPath === '/v1/health') return;
      if (urlPath === '/v1/auth/verify') return;
      if (urlPath === '/dashboard' || urlPath.startsWith('/dashboard/')) return;
      if (/^\/v1\/hooks\/[A-Za-z]+$/.test(urlPath)) return;
      if (/^\/v1\/sessions\/[^/]+\/terminal$/.test(urlPath)) return;

      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      if (!token) return reply.status(401).send({ error: 'Unauthorized' });
      const result = routeContext.auth.validate(token);
      if (!result.valid) return reply.status(401).send({ error: 'Unauthorized' });
      req.authKeyId = result.keyId;
      req.tenantId = result.keyId === 'master' ? '_system' : undefined;
    });

    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      const id = (req.params as Record<string, string | undefined>).id;
      if (id !== undefined) {
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRe.test(id)) return reply.status(400).send({ error: 'Invalid session ID' });
      }
    });

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

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(address.split(':').pop()!, 10);
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = (token = MASTER_TOKEN) => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  it('rejects semicolons in name (SQL injection attempt)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'test; DROP TABLE sessions;--' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects semicolons in label', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, label: 'test; DROP TABLE sessions;--' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects pipe in name (command injection)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'test | rm -rf /' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects backticks in name', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'test `whoami`' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects dollar sign in name (variable expansion)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'test $HOME' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects ampersand in name', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'test && whoami' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects newline in name', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'test\ninjection' }),
    });

    expect(res.status).toBe(400);
  });

  it('accepts valid alphanumeric name with hyphens', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'my-valid-session-123' }),
    });

    expect(res.status).toBe(201);
  });

  it('accepts name with underscores and spaces', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'my session_name' }),
    });

    expect(res.status).toBe(201);
  });

  it('accepts name with dots and @ (email-like)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'user@example.com' }),
    });

    expect(res.status).toBe(201);
  });
});
