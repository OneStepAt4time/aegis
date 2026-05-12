/**
 * async-session-create-3243.test.ts — Tests for Issue #3243.
 *
 * POST /v1/sessions with ACP enabled + prompt must return 201 immediately
 * with promptDelivery: { delivered: false, attempts: 0, status: 'pending' }.
 * Prompt delivery runs asynchronously and updates session.promptDelivery
 * once complete.
 */

import Fastify from 'fastify';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
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
import type { SessionInfo } from '../session.js';

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

const MASTER_TOKEN = 'aegis-master-3243';

/** Wait for async microtasks/timers to settle. */
async function flushAsync(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function buildMockAcpBackend(sendPromptImpl?: () => Promise<{ delivered: boolean; attempts: number }>) {
  const sessionId = crypto.randomUUID();
  const mockAcpSession = {
    id: sessionId,
    tenantId: '_system',
    ownerKeyId: 'master',
    conversationId: 'conv-1',
    transcriptId: 'trans-1',
    status: 'idle' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  return {
    _mockSessionId: sessionId,
    createSession: vi.fn().mockResolvedValue({
      session: mockAcpSession,
      initializeResult: {},
      backendRunId: 'run-1',
    }),
    sendPrompt: vi.fn(sendPromptImpl ?? (() => Promise.resolve({ delivered: true, attempts: 1 }))),
    shutdownSession: vi.fn().mockResolvedValue({}),
  };
}

async function buildRouteContext(tmpDir: string, acpBackend?: ReturnType<typeof buildMockAcpBackend>) {
  const config = {
    port: 0, host: '127.0.0.1', authToken: MASTER_TOKEN,
    stateDir: tmpDir,
    claudeProjectsDir: join(tmpDir, 'projects'),
    maxSessionAgeMs: 2 * 60 * 60 * 1000, reaperIntervalMs: 60 * 60 * 1000,
    continuationPointerTtlMs: 24 * 60 * 60 * 1000,
    tgBotToken: '', tgGroupId: '', tgAllowedUsers: [], tgTopicTtlMs: 0,
    tgTopicAutoDelete: true, tgVerbose: false, tgTopicTTLHours: 0,
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
    stateStore: 'file', postgresUrl: '', defaultTenantId: 'default',
    acpEnabled: acpBackend !== undefined,
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
    acpBackend: acpBackend as unknown as RouteContext['acpBackend'],
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

  return { ctx, sessions, auth };
}

async function buildApp(ctx: RouteContext) {
  const app = Fastify({ logger: false });

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

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) return reply.status(401).send({ error: 'Unauthorized' });
    const result = ctx.auth.validate(token);
    if (!result.valid) return reply.status(401).send({ error: 'Unauthorized' });
    req.authKeyId = result.keyId;
    req.tenantId = result.keyId === 'master' ? '_system' : undefined;
  });

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
  const port = parseInt(address.split(':').pop()!, 10);
  return { app, port };
}

const authHeaders = (token = MASTER_TOKEN) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Issue #3243 — async session create (ACP + prompt)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-async-create-3243-'));
  });

  describe('POST /v1/sessions — fire-and-forget sendPrompt', () => {
    it('returns 201 immediately with promptDelivery.status: pending', async () => {
      // sendPrompt resolves instantly — check that response has status: 'pending' regardless
      const acpBackend = buildMockAcpBackend(() => Promise.resolve({ delivered: true, attempts: 1 }));
      const { ctx, sessions } = await buildRouteContext(tmpDir, acpBackend);
      const { app, port } = await buildApp(ctx);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ workDir: tmpDir, prompt: 'Build a REST API' }),
        });

        expect(res.status).toBe(201);
        const body = await res.json() as Record<string, unknown>;
        expect(body.id).toBeDefined();

        const pd = body.promptDelivery as { delivered: boolean; attempts: number; status: string } | undefined;
        expect(pd).toBeDefined();
        expect(pd?.status).toBe('pending');
        expect(pd?.delivered).toBe(false);
        expect(pd?.attempts).toBe(0);
      } finally {
        await app.close();
      }
    });

    it('updates session.promptDelivery.status to delivered after sendPrompt resolves', async () => {
      let resolvePrompt!: (val: { delivered: boolean; attempts: number }) => void;
      const deferredPrompt = new Promise<{ delivered: boolean; attempts: number }>((r) => {
        resolvePrompt = r;
      });

      const acpBackend = buildMockAcpBackend(() => deferredPrompt);
      const subTmpDir = mkdtempSync(join(tmpdir(), 'aegis-async-3243b-'));
      const { ctx, sessions } = await buildRouteContext(subTmpDir, acpBackend);
      const { app, port } = await buildApp(ctx);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ workDir: subTmpDir, prompt: 'Do the thing' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json() as Record<string, unknown>;
        const sessionId = body.id as string;

        // At this point promptDelivery.status must be 'pending'
        expect((body.promptDelivery as Record<string, unknown>)?.status).toBe('pending');

        // Resolve sendPrompt — simulating successful prompt delivery
        resolvePrompt({ delivered: true, attempts: 1 });

        // Wait for the fire-and-forget callback to update session state
        await flushAsync(100);

        // GET the session and verify promptDelivery was updated
        const getRes = await fetch(`http://127.0.0.1:${port}/v1/sessions/${sessionId}`, {
          headers: authHeaders(),
        });
        expect(getRes.status).toBe(200);
        const session = await getRes.json() as Record<string, unknown>;
        const pd = session.promptDelivery as { delivered: boolean; attempts: number; status: string };
        expect(pd.status).toBe('delivered');
        expect(pd.delivered).toBe(true);
        expect(pd.attempts).toBe(1);
      } finally {
        await app.close();
      }
    });

    it('updates session.promptDelivery.status to failed after sendPrompt rejects', async () => {
      let rejectPrompt!: (err: Error) => void;
      const deferredPrompt = new Promise<{ delivered: boolean; attempts: number }>((_, r) => {
        rejectPrompt = r;
      });

      const acpBackend = buildMockAcpBackend(() => deferredPrompt);
      const subTmpDir = mkdtempSync(join(tmpdir(), 'aegis-async-3243c-'));
      const { ctx, sessions } = await buildRouteContext(subTmpDir, acpBackend);
      const { app, port } = await buildApp(ctx);

      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/sessions`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ workDir: subTmpDir, prompt: 'Fail me' }),
        });
        expect(res.status).toBe(201);
        const body = await res.json() as Record<string, unknown>;
        const sessionId = body.id as string;

        expect((body.promptDelivery as Record<string, unknown>)?.status).toBe('pending');

        // Reject sendPrompt — simulating delivery failure
        rejectPrompt(new Error('timeout'));

        await flushAsync(100);

        const getRes = await fetch(`http://127.0.0.1:${port}/v1/sessions/${sessionId}`, {
          headers: authHeaders(),
        });
        const session = await getRes.json() as Record<string, unknown>;
        const pd = session.promptDelivery as { delivered: boolean; attempts: number; status: string };
        expect(pd.status).toBe('failed');
        expect(pd.delivered).toBe(false);
      } finally {
        await app.close();
      }
    });
  });

  describe('SessionInfo.promptDelivery — status field', () => {
    it('accepts status: pending on promptDelivery', () => {
      const session: SessionInfo = {
        id: 'test', windowId: '', displayName: 'test', workDir: '/tmp',
        byteOffset: 0, monitorOffset: 0, status: 'pending',
        createdAt: Date.now(), lastActivity: Date.now(),
        stallThresholdMs: 300_000, permissionStallMs: 300_000,
        permissionMode: 'default',
        promptDelivery: { delivered: false, attempts: 0, status: 'pending' },
      };
      expect(session.promptDelivery?.status).toBe('pending');
    });

    it('accepts status: delivered on promptDelivery', () => {
      const session: SessionInfo = {
        id: 'test', windowId: '', displayName: 'test', workDir: '/tmp',
        byteOffset: 0, monitorOffset: 0, status: 'idle',
        createdAt: Date.now(), lastActivity: Date.now(),
        stallThresholdMs: 300_000, permissionStallMs: 300_000,
        permissionMode: 'default',
        promptDelivery: { delivered: true, attempts: 1, status: 'delivered' },
      };
      expect(session.promptDelivery?.status).toBe('delivered');
    });

    it('accepts status: failed on promptDelivery', () => {
      const session: SessionInfo = {
        id: 'test', windowId: '', displayName: 'test', workDir: '/tmp',
        byteOffset: 0, monitorOffset: 0, status: 'error',
        createdAt: Date.now(), lastActivity: Date.now(),
        stallThresholdMs: 300_000, permissionStallMs: 300_000,
        permissionMode: 'default',
        promptDelivery: { delivered: false, attempts: 1, status: 'failed' },
      };
      expect(session.promptDelivery?.status).toBe('failed');
    });

    it('accepts status: timeout on promptDelivery', () => {
      const session: SessionInfo = {
        id: 'test', windowId: '', displayName: 'test', workDir: '/tmp',
        byteOffset: 0, monitorOffset: 0, status: 'idle',
        createdAt: Date.now(), lastActivity: Date.now(),
        stallThresholdMs: 300_000, permissionStallMs: 300_000,
        permissionMode: 'default',
        promptDelivery: { delivered: false, attempts: 1, status: 'timeout' },
      };
      expect(session.promptDelivery?.status).toBe('timeout');
    });
  });
});
