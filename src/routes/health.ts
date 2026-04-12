/**
 * routes/health.ts — Health, prometheus, handshake, swarm, channels, alerts.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { negotiate, type HandshakeRequest } from '../handshake.js';
import { promRegistry, METRICS_CONTENT_TYPE } from '../prometheus.js';
import { handshakeRequestSchema } from '../validation.js';
import { type RouteContext, requireRole } from './context.js';

export function registerHealthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, tmux, metrics, channels, alertManager, swarmMonitor, auth } = ctx;

  const healthRateLimitConfig = {
    max: 60,
    timeWindow: '1 minute',
  } as const;
  const HEALTH_WINDOW_MS = 60_000;
  const healthHits = new Map<string, { count: number; windowStart: number }>();

  function isRateLimited(req: FastifyRequest, keyPrefix: string, max: number, windowMs: number): boolean {
    const clientIp = req.ip ?? 'unknown';
    const key = `${keyPrefix}:${clientIp}`;
    const now = Date.now();
    const current = healthHits.get(key);

    if (!current || now - current.windowStart >= windowMs) {
      healthHits.set(key, { count: 1, windowStart: now });
      return false;
    }

    if (current.count >= max) return true;
    current.count += 1;
    return false;
  }

  // Health — Issue #397: includes tmux server health check
  async function healthHandler(): Promise<Record<string, unknown>> {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    const activeCount = sessions.listSessions().length;
    const totalCount = metrics.getTotalSessionsCreated();
    const tmuxHealth = await tmux.isServerHealthy();
    const status = tmuxHealth.healthy ? 'ok' : 'degraded';
    return {
      status,
      version: pkg.default.version,
      platform: process.platform,
      uptime: process.uptime(),
      sessions: { active: activeCount, total: totalCount },
      tmux: tmuxHealth,
      timestamp: new Date().toISOString(),
    };
  }

  async function healthRouteHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isRateLimited(req, 'health', healthRateLimitConfig.max, HEALTH_WINDOW_MS)) {
      reply.status(429).send({ error: 'Too Many Requests' });
      return;
    }
    const payload = await healthHandler();
    reply.send(payload);
  }

  app.get('/v1/health', { config: { rateLimit: healthRateLimitConfig } }, healthRouteHandler);
  app.get('/health', { config: { rateLimit: healthRateLimitConfig } }, healthRouteHandler);

  // Issue #1412: Prometheus metrics scrape endpoint
  app.get('/metrics', async (req, reply) => {
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
  app.post('/v1/alerts/test', async (req, reply) => {
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

  app.get('/v1/alerts/stats', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    return alertManager.getStats();
  });

  // Handshake
  app.post<{ Body: HandshakeRequest }>('/v1/handshake', async (req, reply) => {
    const parsed = handshakeRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid handshake request', details: parsed.error.issues });
    }
    const result = negotiate(parsed.data);
    return reply.status(result.compatible ? 200 : 409).send(result);
  });

  // Issue #81: Swarm awareness
  app.get('/v1/swarm', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    return await swarmMonitor.scan();
  });

  // Issue #89 L14: Webhook dead letter queue
  app.get('/v1/webhooks/dead-letter', async () => {
    for (const ch of channels.getChannels()) {
      if (ch.name === 'webhook' && typeof ch.getDeadLetterQueue === 'function') {
        return ch.getDeadLetterQueue();
      }
    }
    return [];
  });

  // Issue #89 L15: Per-channel health reporting
  app.get('/v1/channels/health', async () => {
    return channels.getChannels().map(ch => {
      const health = ch.getHealth?.();
      if (health) return health;
      return { channel: ch.name, healthy: true, lastSuccess: null, lastError: null, pendingCount: 0 };
    });
  });
}
