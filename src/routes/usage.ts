/**
 * routes/usage.ts — Usage/metering API endpoints.
 *
 * Issue #1954: Exposes billing and metering data via REST endpoints.
 * Provides aggregation for total usage, per-key breakdown, and
 * per-session detail queries with time-range filtering.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  type RouteContext,
  registerWithLegacy, requireRole,
} from './context.js';

export function registerUsageRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { auth, metering } = ctx;

  /**
   * GET /v1/usage — Total usage summary with optional filters.
   *
   * Query params:
   *   from    — ISO timestamp lower bound (inclusive)
   *   to      — ISO timestamp upper bound (inclusive)
   *   keyId   — Filter to a specific API key
   */
  registerWithLegacy(app, 'get', '/v1/usage', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;

    const query = req.query as { from?: string; to?: string; keyId?: string };
    const summary = metering.getUsageSummary({
      from: query.from,
      to: query.to,
      keyId: query.keyId,
    });

    return {
      schema_version: 1,
      ...summary,
      rate_tiers: metering.getRateTiers(),
    };
  });

  /**
   * GET /v1/usage/by-key — Per-key usage breakdown.
   *
   * Query params:
   *   from — ISO timestamp lower bound (inclusive)
   *   to   — ISO timestamp upper bound (inclusive)
   */
  registerWithLegacy(app, 'get', '/v1/usage/by-key', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;

    const query = req.query as { from?: string; to?: string };
    const breakdown = metering.getUsageByKey({
      from: query.from,
      to: query.to,
    });

    return {
      schema_version: 1,
      keys: breakdown,
      total_keys: breakdown.length,
    };
  });

  /**
   * GET /v1/usage/sessions/:id — Per-session usage records.
   *
   * Query params:
   *   from — ISO timestamp lower bound (inclusive)
   *   to   — ISO timestamp upper bound (inclusive)
   */
  registerWithLegacy(app, 'get', '/v1/usage/sessions/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;

    const sessionId = (req.params as { id: string }).id;
    const query = req.query as { from?: string; to?: string };
    const records = metering.getSessionUsage(sessionId, {
      from: query.from,
      to: query.to,
    });

    return {
      schema_version: 1,
      sessionId,
      records,
      total_records: records.length,
    };
  });

  /**
   * GET /v1/usage/tiers — Current rate tier configuration.
   */
  registerWithLegacy(app, 'get', '/v1/usage/tiers', async (_req: FastifyRequest, _reply: FastifyReply) => {
    return {
      schema_version: 1,
      tiers: metering.getRateTiers(),
    };
  });
}
