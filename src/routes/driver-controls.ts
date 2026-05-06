/**
 * routes/driver-controls.ts — Driver/observer control endpoints (Issue #2615 / ACP-084).
 *
 * Provides REST endpoints for driver claim/release/transfer and participant listing:
 *   POST /v1/sessions/:id/driver/claim
 *   POST /v1/sessions/:id/driver/release
 *   POST /v1/sessions/:id/driver/transfer
 *   GET  /v1/sessions/:id/participants
 */

import { claimDriverSchema, releaseDriverSchema, transferDriverSchema } from '../validation.js';
import {
  type RouteContext,
  registerWithLegacy,
  withSessionOwnership,
  requirePermission,
  resolveRequestAuditActor,
} from './context.js';

export function registerDriverRoutes(app: Parameters<typeof registerWithLegacy>[0], ctx: RouteContext): void {
  const { auth, getAuditLogger } = ctx;

  // POST /v1/sessions/:id/driver/claim
  registerWithLegacy(app, 'post', '/v1/sessions/:id/driver/claim', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return reply.status(501).send({ error: 'ACP backend is not configured' });

    const parsed = claimDriverSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      const result = await acpBackend.claimDriver({
        sessionId: session.id,
        holderId: parsed.data.holderId ?? req.authKeyId ?? 'unknown',
        ttlMs: parsed.data.ttlMs,
        ...scope,
      });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'driver.claimed', `Driver claimed: ${session.id}`, session.id, scope.tenantId);
      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('already claimed')) {
        return reply.status(409).send({ error: 'Driver already claimed', code: 'DRIVER_CLAIMED' });
      }
      return reply.status(500).send({ error: message });
    }
  }, 'send'));

  // POST /v1/sessions/:id/driver/release
  registerWithLegacy(app, 'post', '/v1/sessions/:id/driver/release', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return reply.status(501).send({ error: 'ACP backend is not configured' });

    const parsed = releaseDriverSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      const result = await acpBackend.releaseDriver({
        sessionId: session.id,
        holderId: parsed.data.holderId ?? req.authKeyId ?? 'unknown',
        ...scope,
      });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'driver.released', `Driver released: ${session.id}`, session.id, scope.tenantId);
      return result;
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // POST /v1/sessions/:id/driver/transfer
  registerWithLegacy(app, 'post', '/v1/sessions/:id/driver/transfer', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return reply.status(501).send({ error: 'ACP backend is not configured' });

    const parsed = transferDriverSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      const result = await acpBackend.transferDriver({
        sessionId: session.id,
        targetSubscriberId: parsed.data.targetSubscriberId,
        reason: parsed.data.reason,
        ...scope,
      });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'driver.transferred', `Driver transferred: ${session.id}`, session.id, scope.tenantId);
      return result;
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // GET /v1/sessions/:id/participants
  registerWithLegacy(app, 'get', '/v1/sessions/:id/participants', withSessionOwnership(ctx, async (_req, _reply, session) => {
    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return { driver: null, observers: [], activeCount: 0 };
    const scope = { tenantId: _req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: _req.authKeyId ?? session.ownerKeyId ?? 'master' };
    return acpBackend.getParticipants(session.id, scope);
  }));
}
