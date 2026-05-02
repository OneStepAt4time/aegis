/**
 * health-auth-2458.test.ts — Issue #2458: GET /v1/health info leak for unauthenticated callers.
 *
 * Verifies:
 *   - Unauthenticated request → only { status } (no version, uptime, sessions, tmux, claude)
 *   - Authenticated request   → full system info (version, uptime, sessions, tmux, claude)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiKeyPermission } from '../services/auth/index.js';

// Mock child_process so getClaudeCliStatus() doesn't exec a real 'claude' binary
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    execFile: (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      cb(null, { stdout: 'Claude Code 1.0.0\n', stderr: '' });
    },
  };
});

import { AuthManager } from '../services/auth/index.js';
import { MetricsCollector } from '../metrics.js';
import { SessionManager } from '../session.js';
import { SessionMonitor } from '../monitor.js';
import { SessionEventBus } from '../events.js';
import { ChannelManager } from '../channels/index.js';
import { JsonlWatcher } from '../jsonl-watcher.js';
import { PipelineManager } from '../pipeline.js';
import { ToolRegistry } from '../tool-registry.js';
import { AlertManager } from '../alerting.js';
import { SwarmMonitor } from '../swarm-monitor.js';
import { SSEConnectionLimiter } from '../sse-limiter.js';
import { QuotaManager, DashboardSessionStore } from '../services/auth/index.js';
import { registerHealthRoutes, type RouteContext } from '../routes/index.js';
import { createMockTmuxManager } from './helpers/mock-tmux.js';
import type { Config } from '../config.js';

const MASTER_TOKEN = 'aegis-test-master-token-2458';

async function buildApp(tmpDir: string): Promise<{ app: FastifyInstance; auth: AuthManager }> {
  const mockTmux = createMockTmuxManager();
  // Make tmux report as healthy
  (mockTmux as unknown as Record<string, unknown>).isServerHealthy = vi.fn().mockResolvedValue({ healthy: true, error: null });

  const config = {
    port: 0,
    host: '127.0.0.1',
    authToken: MASTER_TOKEN,
    tmuxSession: 'test-aegis',
    stateDir: tmpDir,
    claudeProjectsDir: join(tmpDir, 'projects'),
    maxSessionAgeMs: 7200000,
    reaperIntervalMs: 3600000,
    continuationPointerTtlMs: 86400000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgTopicTTLHours: 0,
    stallThresholdMs: 300000,
    defaultPermissionMode: 'default',
    allowedWorkDirs: [],
    defaultSessionEnv: {},
    metricsToken: '',
    hookSecretHeaderOnly: false,
    pipelineStageTimeoutMs: 30000,
    webhooks: [],
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 600000 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: true,
    sseIdleMs: 60000,
    sseClientTimeoutMs: 300000,
    hookTimeoutMs: 10000,
    shutdownGraceMs: 15000,
    keyRotationGraceSeconds: 3600,
    shutdownHardMs: 20000,
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
  const pipelines = new PipelineManager(sessions, eventBus, undefined, config.pipelineStageTimeoutMs);
  const dashboardTokenSessions = new DashboardSessionStore();

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
    requestKeyMap: new Map(),
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
    metricsCache: {
      getMetrics: vi.fn(() => ({ sessionVolume: [], tokenUsageByModel: [], costTrends: [], topApiKeys: [], durationTrends: [], errorRates: { totalSessions: 0, failedSessions: 0, failureRate: 0, permissionPrompts: 0, approvals: 0, autoApprovals: 0 }, generatedAt: new Date().toISOString() })),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      invalidate: vi.fn(),
      flush: vi.fn(async () => {}),
    } as unknown as RouteContext['metricsCache'],
    dashboardTokenSessions,
  };

  const app = Fastify({ logger: false });
  app.decorateRequest('authKeyId', null as unknown as string);
  app.decorateRequest('tenantId', undefined as unknown as string);
  app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
  app.decorateRequest('authRole', null);
  app.decorateRequest('authPermissions', null);
  app.decorateRequest('authActor', null);

  // Auth middleware — health bypass mirrors server.ts setupAuth()
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath === '/health' || urlPath === '/v1/health') return; // public bypass
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) return reply.status(401).send({ error: 'Unauthorized' });
    const result = auth.validate(token);
    if (!result.valid) return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    req.authKeyId = result.keyId;
    req.tenantId = result.keyId === 'master' ? '_system' : undefined;
  });

  registerHealthRoutes(app, ctx);
  await app.ready();

  return { app, auth };
}

describe('Issue #2458: GET /v1/health auth-gated info', () => {
  let app: FastifyInstance;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-health-2458-'));
    ({ app } = await buildApp(tmpDir));
  });

  afterAll(async () => {
    await app.close();
  });

  it('unauthenticated request returns only { status }', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    // Must contain no additional fields
    expect(Object.keys(body)).toEqual(['status']);
  });

  it('unauthenticated request does not leak version, uptime, sessions, tmux, or claude', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = res.json() as Record<string, unknown>;

    expect(body.version).toBeUndefined();
    expect(body.uptime).toBeUndefined();
    expect(body.platform).toBeUndefined();
    expect(body.sessions).toBeUndefined();
    expect(body.tmux).toBeUndefined();
    expect(body.claude).toBeUndefined();
    expect(body.timestamp).toBeUndefined();
  });

  it('authenticated request returns full system info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { Authorization: `Bearer ${MASTER_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
    expect(typeof body.uptime).toBe('number');
    expect(body.platform).toBe(process.platform);
    expect(body.sessions).toBeDefined();
    expect((body.sessions as Record<string, unknown>).active).toBeDefined();
    expect((body.sessions as Record<string, unknown>).total).toBeDefined();
    expect(body.tmux).toBeDefined();
    expect(body.claude).toBeDefined();
  });

  it('legacy GET /health also returns only { status } for unauthenticated callers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('ok');
    expect(Object.keys(body)).toEqual(['status']);
  });
});
