/**
 * routes/audit.ts — Audit log, diagnostics, global metrics.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type AuditChainMetadata,
  auditRecordsToCsv,
  auditRecordsToNdjson,
  buildAuditChainMetadata,
} from '../audit.js';
import { diagnosticsBus } from '../diagnostics.js';
import { type RouteContext, requireRole, registerWithLegacy } from './context.js';

const AUDIT_FORMATS = ['json', 'csv', 'ndjson'] as const;
type AuditOutputFormat = (typeof AUDIT_FORMATS)[number];

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function resolveAuditFormat(
  req: FastifyRequest,
  explicitFormat?: AuditOutputFormat,
): AuditOutputFormat {
  if (explicitFormat) return explicitFormat;

  const accept = req.headers.accept?.toLowerCase() ?? '';
  if (accept.includes('text/csv')) return 'csv';
  if (accept.includes('application/x-ndjson') || accept.includes('application/ndjson')) {
    return 'ndjson';
  }
  return 'json';
}

function setAuditExportHeaders(
  reply: FastifyReply,
  format: Exclude<AuditOutputFormat, 'json'>,
  metadata: AuditChainMetadata,
  integrity?: { valid: boolean; brokenAt?: number; file?: string },
): void {
  const timestamp = new Date().toISOString().replace(/[:]/g, '-');
  const extension = format === 'csv' ? 'csv' : 'ndjson';

  reply.header('Content-Disposition', `attachment; filename="audit-export-${timestamp}.${extension}"`);
  reply.header('X-Aegis-Audit-Record-Count', String(metadata.count));

  if (metadata.firstHash) reply.header('X-Aegis-Audit-First-Hash', metadata.firstHash);
  if (metadata.lastHash) reply.header('X-Aegis-Audit-Last-Hash', metadata.lastHash);
  if (metadata.badgeHash) reply.header('X-Aegis-Audit-Chain-Badge', metadata.badgeHash);
  if (metadata.firstTs) reply.header('X-Aegis-Audit-First-Ts', metadata.firstTs);
  if (metadata.lastTs) reply.header('X-Aegis-Audit-Last-Ts', metadata.lastTs);

  if (integrity) {
    reply.header('X-Aegis-Audit-Integrity-Valid', String(integrity.valid));
    if (integrity.brokenAt !== undefined) {
      reply.header('X-Aegis-Audit-Integrity-Broken-At', String(integrity.brokenAt));
    }
    if (integrity.file) {
      reply.header('X-Aegis-Audit-Integrity-File', integrity.file);
    }
  }
}

export function registerAuditRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, metrics, auth, getAuditLogger } = ctx;

  const auditQuerySchema = z.object({
    actor: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    sessionId: z.string().min(1).max(200).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    cursor: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    reverse: z.coerce.boolean().optional(),
    verify: z.coerce.boolean().optional(),
    format: z.enum(AUDIT_FORMATS).optional(),
  }).superRefine((data, validationCtx) => {
    if (data.from && !isIsoTimestamp(data.from)) {
      validationCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be a valid ISO 8601 timestamp',
        path: ['from'],
      });
    }

    if (data.to && !isIsoTimestamp(data.to)) {
      validationCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'to must be a valid ISO 8601 timestamp',
        path: ['to'],
      });
    }

    if (data.from && data.to) {
      const fromMs = Date.parse(data.from);
      const toMs = Date.parse(data.to);
      if (Number.isFinite(fromMs) && Number.isFinite(toMs) && fromMs > toMs) {
        validationCtx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'from must be earlier than or equal to to',
          path: ['from'],
        });
      }
    }
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

      const format = resolveAuditFormat(req, parsed.data.format);
      const reverse = parsed.data.reverse ?? false;
      const from = parsed.data.from ? new Date(parsed.data.from).toISOString() : undefined;
      const to = parsed.data.to ? new Date(parsed.data.to).toISOString() : undefined;
      const verifyChain = parsed.data.verify ?? false;
      const queryOpts = {
        actor: parsed.data.actor,
        action: parsed.data.action,
        sessionId: parsed.data.sessionId,
        from,
        to,
        reverse,
      };
      const integrity = verifyChain ? await auditLogger.verify() : undefined;

      if (format !== 'json') {
        const records = await auditLogger.queryAll(queryOpts);
        const chain = buildAuditChainMetadata(records);
        setAuditExportHeaders(reply, format, chain, integrity);

        if (format === 'csv') {
          reply.header('Content-Type', 'text/csv; charset=utf-8');
          return auditRecordsToCsv(records);
        }

        reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
        return auditRecordsToNdjson(records);
      }

      try {
        const page = await auditLogger.queryPage({
          ...queryOpts,
          limit: parsed.data.limit ?? 100,
          cursor: parsed.data.cursor,
        });
        const chain = buildAuditChainMetadata(page.records);

        return {
          count: page.records.length,
          total: page.total,
          records: page.records,
          filters: {
            actor: parsed.data.actor,
            action: parsed.data.action,
            sessionId: parsed.data.sessionId,
            from,
            to,
          },
          pagination: {
            limit: page.limit,
            hasMore: page.hasMore,
            nextCursor: page.nextCursor,
            reverse,
          },
          chain,
          ...(integrity ? { integrity } : {}),
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid audit cursor') {
          return reply.status(400).send({ error: error.message });
        }
        throw error;
      }
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
