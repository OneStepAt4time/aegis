/**
 * routes/health.ts — Health, prometheus, handshake, swarm, channels, alerts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { negotiate, type HandshakeRequest } from '../handshake.js';
import { promRegistry, METRICS_CONTENT_TYPE } from '../prometheus.js';
import { MIN_CC_VERSION, compareSemver, extractCCVersion } from '../validation.js';
import { handshakeRequestSchema } from '../validation.js';
import { authenticateDashboardSessionCookie } from '../dashboard-session-auth.js';
import { type RouteContext, requireRole, registerWithLegacy, withValidation } from './context.js';

const execFileAsync = promisify(execFile);
const CLAUDE_STATUS_CACHE_TTL_MS = 30_000;

interface ClaudeCliStatus {
  available: boolean;
  healthy: boolean;
  version: string | null;
  minimumVersion: string;
  error: string | null;
}

let cachedClaudeStatus: { expiresAt: number; value: ClaudeCliStatus } | null = null;

async function getClaudeCliStatus(): Promise<ClaudeCliStatus> {
  const now = Date.now();
  if (cachedClaudeStatus && cachedClaudeStatus.expiresAt > now) {
    return cachedClaudeStatus.value;
  }

  let value: ClaudeCliStatus;
  try {
    const { stdout } = await execFileAsync('claude', ['--version'], {
      encoding: 'utf-8',
      timeout: 5_000,
    });
    const version = extractCCVersion(stdout);
    const healthy = version === null || compareSemver(version, MIN_CC_VERSION) >= 0;

    value = {
      available: true,
      healthy,
      version,
      minimumVersion: MIN_CC_VERSION,
      error: healthy
        ? null
        : `Installed version ${version ?? 'unknown'} is below the minimum supported version ${MIN_CC_VERSION}.`,
    };
  } catch (error) {
    value = {
      available: false,
      healthy: false,
      version: null,
      minimumVersion: MIN_CC_VERSION,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  cachedClaudeStatus = {
    expiresAt: now + CLAUDE_STATUS_CACHE_TTL_MS,
    value,
  };
  return value;
}

export function registerHealthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, tmux, metrics, channels, alertManager, swarmMonitor, auth } = ctx;

  const healthRateLimitConfig = {
    max: 60,
    timeWindow: '1 minute',
  } as const;

  // Health — Issue #397: includes tmux server health check
  // Issue #1911: returns 'draining' when server is shutting down
  // Issue #2066: strip sensitive fields (version, uptime, tmux, claude) for unauthenticated requests
  async function healthHandler(req: FastifyRequest): Promise<Record<string, unknown>> {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    const activeCount = sessions.listSessions().length;
    const totalCount = metrics.getTotalSessionsCreated();
    const [tmuxHealth, claudeStatus] = await Promise.all([
      tmux.isServerHealthy(),
      getClaudeCliStatus(),
    ]);
    const status = ctx.serverState.draining
      ? 'draining'
      : tmuxHealth.healthy
        ? 'ok'
        : 'degraded';

    // Check if request is authenticated.
    // When no auth is configured (localhost, no tokens), validate returns valid:true
    // for any input — including an empty string — so unauthenticated CI smoke-health
    // checks still receive the full response (Issue #2066 intent preserved: only strip
    // fields when auth IS configured and the caller provides no valid token).
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const isBearerAuthenticated = ctx.auth.validate(token ?? '').valid;
    const isAuthenticated = isBearerAuthenticated || (!token && authenticateDashboardSessionCookie(req, {
      getSession: (sessionId: string | undefined) =>
        ctx.dashboardTokenSessions?.get(sessionId) ?? ctx.dashboardOidc?.getSession(sessionId) ?? null,
    }) !== null);

    const base = { status, timestamp: new Date().toISOString() };

    // Unauthenticated: return only status (Issue #2458 — prevent info leak)
    if (!isAuthenticated) {
      return { status };
    }

    // Authenticated: return full health details
    return {
      ...base,
      version: pkg.default.version,
      platform: process.platform,
      uptime: process.uptime(),
      sessions: { active: activeCount, total: totalCount },
      tmux: tmuxHealth,
      claude: claudeStatus,
    };
  }

  registerWithLegacy(app, 'get', '/v1/health', { config: { rateLimit: healthRateLimitConfig }, handler: healthHandler });

  // Issue #1412: Prometheus metrics scrape endpoint
  // Note: /metrics is a standard Prometheus path, not a v1 API path, so no legacy alias
  app.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const promMetrics = await promRegistry.metrics();
      return reply
        .header('Content-Type', METRICS_CONTENT_TYPE)
        .send(promMetrics);
    } catch (err) {
      req.log.error({ err }, 'Prometheus /metrics endpoint error');
      return reply.status(500).send({ error: 'Failed to collect metrics' });
    }
  });

  // Issue #1418: Alert webhook validation and stats
  registerWithLegacy(app, 'post', '/v1/alerts/test', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    try {
      const result = await alertManager.fireTestAlert();
      if (!result.sent) {
        return reply.status(200).send({ sent: false, message: 'No alert webhooks configured (set AEGIS_ALERT_WEBHOOKS)' });
      }
      return reply.status(200).send(result);
    } catch (e: unknown) {
      return reply.status(502).send({ error: `Alert delivery failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  registerWithLegacy(app, 'get', '/v1/alerts/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    return alertManager.getStats();
  });

  // Handshake
  registerWithLegacy(app, 'post', '/v1/handshake', withValidation(handshakeRequestSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    const result = negotiate(data);
    return reply.status(result.compatible ? 200 : 409).send(result);
  }));

  // Issue #81: Swarm awareness
  registerWithLegacy(app, 'get', '/v1/swarm', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    return await swarmMonitor.scan();
  });

  // Issue #89 L14: Webhook dead letter queue
  registerWithLegacy(app, 'get', '/v1/webhooks/dead-letter', async (_req: FastifyRequest, _reply: FastifyReply) => {
    for (const ch of channels.getChannels()) {
      if (ch.name === 'webhook' && typeof ch.getDeadLetterQueue === 'function') {
        return ch.getDeadLetterQueue();
      }
    }
    return [];
  });

  // Issue #89 L15: Per-channel health reporting
  registerWithLegacy(app, 'get', '/v1/channels/health', async (_req: FastifyRequest, _reply: FastifyReply) => {
    return channels.getChannels().map(ch => {
      const health = ch.getHealth?.();
      if (health) return health;
      return { channel: ch.name, healthy: true, lastSuccess: null, lastError: null, pendingCount: 0 };
    });
  });

  // Issue #1956: /v2/ migration stub — returns versioning info until real v2 routes exist
  app.get('/v2/', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.header('X-Aegis-API-Version', '2').send({
      version: 2,
      status: 'planned',
      message: 'API v2 is not yet available. Continue using /v1/ endpoints.',
      migration_guide: '/v1/openapi.json',
      v1_base: '/v1/',
    });
  });
}
