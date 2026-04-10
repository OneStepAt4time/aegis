/**
 * health.ts — Health, metrics, alerts, swarm, handshake, and audit routes.
 *
 * Registers the following endpoints:
 * - GET /v1/health, GET /health       — server health with tmux status
 * - GET /metrics                      — Prometheus metrics scrape
 * - POST /v1/alerts/test              — test alert webhook delivery
 * - GET /v1/alerts/stats              — alert statistics
 * - POST /v1/handshake                — client compatibility handshake
 * - GET /v1/swarm                     — swarm awareness
 * - GET /v1/audit                     — audit log query (admin only)
 */

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './route-deps.js';
import { promRegistry, METRICS_CONTENT_TYPE } from '../prometheus.js';
import { negotiate, type HandshakeRequest } from '../handshake.js';
import type { AuditAction } from '../audit.js';
import { z } from 'zod';
import { handshakeRequestSchema } from '../validation.js';

export function registerHealthRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // ── Health check (Issue #397) ──────────────────────────────────────────

  async function healthHandler(): Promise<Record<string, unknown>> {
    const pkg = await import('../../package.json', { with: { type: 'json' } });
    const activeCount = deps.sessions.listSessions().length;
    const totalCount = deps.metrics.getTotalSessionsCreated();
    const tmuxHealth = await deps.tmux.isServerHealthy();
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

  app.get('/v1/health', healthHandler);
  app.get('/health', healthHandler);

  // ── Prometheus metrics (Issue #1412) ───────────────────────────────────

  app.get('/metrics', async (req, reply) => {
    try {
      const metrics = await promRegistry.metrics();
      return reply
        .header('Content-Type', METRICS_CONTENT_TYPE)
        .send(metrics);
    } catch (err) {
      req.log.error({ err }, 'Prometheus /metrics endpoint error');
      return reply.status(500).send({ error: 'Failed to collect metrics' });
    }
  });

  // ── Alerting (Issue #1418) ────────────────────────────────────────────

  app.post('/v1/alerts/test', async (req, reply) => {
    if (!deps.requireRole(req, reply, 'admin', 'operator')) return;
    try {
      const result = await deps.alertManager.fireTestAlert();
      if (!result.sent) {
        return reply.status(200).send({ sent: false, message: 'No alert webhooks configured (set AEGIS_ALERT_WEBHOOKS)' });
      }
      return reply.status(200).send(result);
    } catch (e: unknown) {
      return reply.status(502).send({ error: `Alert delivery failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  });

  app.get('/v1/alerts/stats', async () => deps.alertManager.getStats());

  // ── Compatibility handshake ────────────────────────────────────────────

  app.post<{ Body: HandshakeRequest }>('/v1/handshake', async (req, reply) => {
    const parsed = handshakeRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid handshake request', details: parsed.error.issues });
    }
    const result = negotiate(parsed.data);
    return reply.status(result.compatible ? 200 : 409).send(result);
  });

  // ── Swarm awareness (Issue #81) ────────────────────────────────────────

  app.get('/v1/swarm', async () => {
    const result = await deps.swarmMonitor.scan();
    return result;
  });

  // ── Audit log (Issue #1419) ────────────────────────────────────────────

  const auditQuerySchema = z.object({
    actor: z.string().optional(),
    action: z.string().optional(),
    sessionId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    reverse: z.coerce.boolean().optional(),
    verify: z.coerce.boolean().optional(),
  });

  app.get('/v1/audit', async (req, reply) => {
    if (!deps.requireRole(req, reply, 'admin')) return;

    const parsed = auditQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }

    const { verify: verifyChain, action, ...rest } = parsed.data;
    const queryOpts = { ...rest, action: action as AuditAction | undefined };

    if (verifyChain) {
      const result = await deps.auditLogger!.verify();
      return { integrity: result, records: await deps.auditLogger!.query(queryOpts) };
    }

    const records = await deps.auditLogger!.query(queryOpts);
    return { count: records.length, records };
  });
}
