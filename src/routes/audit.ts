/**
 * routes/audit.ts — Audit log, diagnostics, global metrics.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditAction } from '../audit.js';
import { diagnosticsBus } from '../diagnostics.js';
import { type RouteContext, requireRole } from './context.js';

export function registerAuditRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, metrics, auth, getAuditLogger } = ctx;

  const auditQuerySchema = z.object({
    actor: z.string().optional(),
    action: z.string().optional(),
    sessionId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    reverse: z.coerce.boolean().optional(),
    verify: z.coerce.boolean().optional(),
  });

  const diagnosticsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  // #1419: Audit log endpoint — admin only
  app.get('/v1/audit', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;
    const auditLogger = getAuditLogger();
    if (!auditLogger) return reply.status(503).send({ error: 'Audit logger is not enabled' });

    const parsed = auditQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }

    const { verify: verifyChain, action, ...rest } = parsed.data;
    const queryOpts = { ...rest, action: action as AuditAction | undefined };

    if (verifyChain) {
      const result = await auditLogger.verify();
      return { integrity: result, records: await auditLogger.query(queryOpts) };
    }

    const records = await auditLogger.query(queryOpts);
    return { count: records.length, records };
  });

  // Global metrics (Issue #40)
  app.get('/v1/metrics', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    return metrics.getGlobalMetrics(sessions.listSessions().length);
  });

  // Bounded no-PII diagnostics channel (Issue #881)
  app.get('/v1/diagnostics', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const parsed = diagnosticsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid diagnostics query params',
        details: parsed.error.issues,
      });
    }

    const limit = parsed.data.limit ?? 50;
    const events = diagnosticsBus.getRecent(limit);
    return { count: events.length, events };
  });
}
