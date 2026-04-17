/**
 * routes/audit.ts — Audit log, diagnostics, global metrics.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AuditAction, AuditRecord } from '../audit.js';
import { diagnosticsBus } from '../diagnostics.js';
import { type RouteContext, requireRole, registerWithLegacy } from './context.js';

const CSV_COLUMNS: ReadonlyArray<keyof AuditRecord> = [
  'ts', 'actor', 'action', 'sessionId', 'detail', 'prevHash', 'hash',
];

/** Escape a CSV field — wrap in double-quotes if it contains commas, quotes, or newlines. */
function csvEscape(value: string | undefined): string {
  if (value === undefined) return '';
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function recordsToCsv(records: AuditRecord[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = records.map(r =>
    CSV_COLUMNS.map(col => csvEscape(r[col] as string | undefined)).join(','),
  );
  return header + '\n' + rows.join('\n') + '\n';
}

export function registerAuditRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, metrics, auth, getAuditLogger } = ctx;

  const auditQuerySchema = z.object({
    actor: z.string().optional(),
    action: z.string().optional(),
    sessionId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    reverse: z.coerce.boolean().optional(),
    verify: z.coerce.boolean().optional(),
    format: z.enum(['json', 'csv']).optional(),
  });

  const diagnosticsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  // #1419: Audit log endpoint — admin only
  registerWithLegacy(app, 'get', '/v1/audit', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin')) return;
      const auditLogger = getAuditLogger();
      if (!auditLogger) return reply.status(503).send({ error: 'Audit logger is not enabled' });

      const parsed = auditQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
      }

      const { verify: verifyChain, format, action, ...rest } = parsed.data;
      const queryOpts = { ...rest, action: action as AuditAction | undefined };
      const asCsv = format === 'csv';

      if (verifyChain) {
        const result = await auditLogger.verify();
        const records = await auditLogger.query(queryOpts);
        if (asCsv) {
          void reply.header('Content-Type', 'text/csv; charset=utf-8');
          return recordsToCsv(records);
        }
        return { integrity: result, records };
      }

      const records = await auditLogger.query(queryOpts);
      if (asCsv) {
        void reply.header('Content-Type', 'text/csv; charset=utf-8');
        return recordsToCsv(records);
      }
      return { count: records.length, records };
    },
  });

  // Global metrics (Issue #40)
  // Note: cannot use registerWithLegacy because legacy path /metrics is used by Prometheus
  app.get('/v1/metrics', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
      return metrics.getGlobalMetrics(sessions.listSessions().length);
    },
  });

  // Bounded no-PII diagnostics channel (Issue #881)
  registerWithLegacy(app, 'get', '/v1/diagnostics', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
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
    },
  });
}
