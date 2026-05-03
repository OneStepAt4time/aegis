/**
 * session-label-2530.test.ts — Tests for Issue #2530.
 * Verifies that POST /v1/sessions accepts `label` as an alias for `name`.
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

import { createMockTmuxManager } from './helpers/mock-tmux.js';
import { type Config } from '../config.js';

const MASTER_TOKEN = 'aegis-master-token-2026';

async function buildRouteContext(tmpDir: string) {
  const mockTmux = createMockTmuxManager();

  const config = {
    port: 0, host: '127.0.0.1', authToken: MASTER_TOKEN,
    tmuxSession: 'test-aegis', stateDir: tmpDir,
    claudeProjectsDir: join(tmpDir, 'projects'),
    maxSessionAgeMs: 2 * 60 * 60 * 1000, reaperIntervalMs: 60 * 60 * 1000,
    continuationPointerTtlMs: 24 * 60 * 60 * 1000,
    tgBotToken: '', tgGroupId: '', tgAllowedUsers: [], tgTopicTtlMs: 0,
    tgTopicAutoDelete: true, tgTopicTTLHours: 0,
    stallThresholdMs: 5 * 60 * 1000, defaultPermissionMode: 'default',
    allowedWorkDirs: [], defaultSessionEnv: {}, metricsToken: '',
    hookSecretHeaderOnly: false, pipelineStageTimeoutMs: 30_000,
    webhooks: [], sseMaxConnections: 100, sseMaxPerIp: 10,
    memoryBridge: { enabled: false }, worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 600_000 },
    envDenylist: [], envAdminAllowlist: [], enforceSessionOwnership: true,
    sseIdleMs: 60_000, sseClientTimeoutMs: 300_000, hookTimeoutMs: 10_000,
    shutdownGraceMs: 15_000, keyRotationGraceSeconds: 3600, shutdownHardMs: 20_000,
    rateLimit: { enabled: true, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 },
    stateStore: 'file', postgresUrl: '', defaultTenantId: 'default', tenantWorkdirs: {},
  } satisfies Config;

  const sessions = new SessionManager(mockTmux as unknown as import('../tmux.js').TmuxManager, config);
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
  const pipelines = new PipelineManager(sessions, eventBus, undefined, config.pipelineStageTimeoutMs);
  const requestKeyMap = new Map<string, string>();
  const dashboardTokenSessions = new DashboardSessionStore();

  const ctx: RouteContext = {
    sessions, tmux: mockTmux as unknown as import('../tmux.js').TmuxManager,
    auth, quotas: new QuotaManager(), config, metrics, monitor, eventBus, channels,
    jsonlWatcher, pipelines, toolRegistry,
    getAuditLogger: () => undefined, alertManager, swarmMonitor, sseLimiter,
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

describe('POST /v1/sessions — label field (Issue #2530)', () => {
  let app: ReturnType<typeof Fastify>;
  let tmpDir: string;
  let routeContext: Awaited<ReturnType<typeof buildRouteContext>>;
  let port: number;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-label-2530-'));
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

  it('accepts label as an alias for name (201, no validation error)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, label: 'my-labeled-session' }),
    });

    // The fix: previously this returned 400 VALIDATION_ERROR with "Unrecognized key: label"
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
  });

  it('accepts name as before (no regression)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'my-named-session' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
  });

  it('prefers name over label when both are provided', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, name: 'name-wins', label: 'label-loses' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBeDefined();
    // Verify createWindow was called with the name value (not label)
    const calls = routeContext.mockTmux.createWindow.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0].windowName).toContain('name-wins');
  });

  it('rejects label that exceeds 200 characters', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ workDir: tmpDir, label: 'x'.repeat(201) }),
    });

    expect(res.status).toBe(400);
  });
});
