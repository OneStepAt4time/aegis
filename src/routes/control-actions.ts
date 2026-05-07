/**
 * routes/control-actions.ts — ACP control action endpoints (Issue #2607 / ACP-064).
 *
 * Provides REST endpoints for session pause/resume/intervention control:
 *   POST /v1/sessions/:id/pause
 *   POST /v1/sessions/:id/intervention/start
 *   POST /v1/sessions/:id/intervention/complete
 *   POST /v1/sessions/:id/resume
 *   GET  /v1/sessions/:id/intervention
 *   POST /v1/sessions/:id/approval/approve
 *   POST /v1/sessions/:id/approval/reject
 *   GET  /v1/sessions/:id/approval/pending
 */

import type { FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import {
  pauseSessionSchema,
  startInterventionSchema,
  completeInterventionSchema,
  resumeSessionSchema,
  cancelSessionSchema,
  approveToolSchema,
  rejectToolSchema,
} from '../validation.js';
import {
  type RouteContext,
  registerWithLegacy,
  withSessionOwnership,
  requirePermission,
  resolveRequestAuditActor,
} from './context.js';
import { SYSTEM_TENANT } from '../config.js';
import type { AcpPauseInterventionRecord } from '../services/acp/pause-intervention.js';

/** Serialize an AcpPauseInterventionRecord for JSON response (dates → ISO strings). */
function serializeRecord(record: AcpPauseInterventionRecord): Record<string, unknown> {
  return {
    pauseId: record.pauseId,
    sessionId: record.sessionId,
    status: record.status,
    idempotencyKey: record.idempotencyKey,
    reason: record.reason,
    requestedBy: record.requestedBy,
    requestedAt: record.requestedAt instanceof Date ? record.requestedAt.toISOString() : record.requestedAt,
    metadata: record.metadata,
    interventionId: record.interventionId,
    interventionBy: record.interventionBy,
    interventionStartedAt: record.interventionStartedAt instanceof Date ? record.interventionStartedAt.toISOString() : record.interventionStartedAt,
    interventionCompletedBy: record.interventionCompletedBy,
    interventionCompletedAt: record.interventionCompletedAt instanceof Date ? record.interventionCompletedAt.toISOString() : record.interventionCompletedAt,
    guidance: record.guidance,
    resumeId: record.resumeId,
    resumedBy: record.resumedBy,
    resumedAt: record.resumedAt instanceof Date ? record.resumedAt.toISOString() : record.resumedAt,
    resumeMetadata: record.resumeMetadata,
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
  };
}

/** Build the standard policy result shape expected by the dashboard. */
function buildResult(
  sessionId: string,
  sessionStatus: string,
  sessionUpdatedAt: number,
  pauseRecord: AcpPauseInterventionRecord,
): Record<string, unknown> {
  return {
    session: {
      id: sessionId,
      status: sessionStatus,
      updatedAt: new Date(sessionUpdatedAt).toISOString(),
    },
    pause: serializeRecord(pauseRecord),
  };
}

/** Resolve tenant ID and owner key ID from the request context and session. */
function resolveScope(
  ctx: RouteContext,
  sessionId: string,
  req: { authKeyId?: string | null; tenantId?: string },
): { tenantId: string; ownerKeyId: string } {
  const session = ctx.sessions.getSession(sessionId);
  const tenantId = req.tenantId ?? session?.tenantId ?? SYSTEM_TENANT;
  const ownerKeyId = req.authKeyId ?? session?.ownerKeyId ?? 'master';
  return { tenantId, ownerKeyId };
}

export function registerControlActionRoutes(app: Parameters<typeof registerWithLegacy>[0], ctx: RouteContext): void {
  const { auth, getAuditLogger } = ctx;

  // POST /v1/sessions/:id/pause
  registerWithLegacy(app, 'post', '/v1/sessions/:id/pause', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const store = ctx.pauseInterventionStore;
    if (!store) return reply.status(501).send({ error: 'Pause/intervention store is not configured' });

    const parsed = pauseSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const { reason, requestedBy, idempotencyKey, metadata } = parsed.data;
    const scope = resolveScope(ctx, session.id, req);

    try {
      const pauseId = crypto.randomUUID();
      const record = await store.pause({
        pauseId,
        sessionId: session.id,
        reason,
        requestedBy: requestedBy ?? req.authKeyId ?? 'unknown',
        requestedAt: new Date(),
        idempotencyKey,
        metadata,
        ...scope,
      });

      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'session.pause', `Session paused: ${session.id}`, session.id, scope.tenantId);

      return buildResult(session.id, session.status, session.lastActivity, record);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('already exists') || message.includes('already active')) {
        return reply.status(409).send({ error: 'Session is already paused', code: 'ALREADY_PAUSED' });
      }
      return reply.status(500).send({ error: message });
    }
  }, 'send'));

  // POST /v1/sessions/:id/intervention/start
  registerWithLegacy(app, 'post', '/v1/sessions/:id/intervention/start', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const store = ctx.pauseInterventionStore;
    if (!store) return reply.status(501).send({ error: 'Pause/intervention store is not configured' });

    const parsed = startInterventionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const { interventionBy } = parsed.data;
    const scope = resolveScope(ctx, session.id, req);

    try {
      const interventionId = crypto.randomUUID();
      const record = await store.startIntervention({
        sessionId: session.id,
        interventionId,
        interventionBy: interventionBy ?? req.authKeyId ?? 'unknown',
        startedAt: new Date(),
        ...scope,
      });

      if (!record) {
        return reply.status(409).send({ error: 'No active pause found to start intervention', code: 'NO_ACTIVE_PAUSE' });
      }

      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'session.intervention.start', `Intervention started: ${session.id}`, session.id, scope.tenantId);

      return buildResult(session.id, session.status, session.lastActivity, record);
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // POST /v1/sessions/:id/intervention/complete
  registerWithLegacy(app, 'post', '/v1/sessions/:id/intervention/complete', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const store = ctx.pauseInterventionStore;
    if (!store) return reply.status(501).send({ error: 'Pause/intervention store is not configured' });

    const parsed = completeInterventionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const { completedBy, guidance } = parsed.data;
    const scope = resolveScope(ctx, session.id, req);

    // Get the active intervention to find its ID
    const activeRecord = await store.getActive(session.id, scope);
    if (!activeRecord?.interventionId) {
      return reply.status(409).send({ error: 'No active intervention found', code: 'NO_ACTIVE_INTERVENTION' });
    }

    try {
      const record = await store.completeIntervention({
        sessionId: session.id,
        interventionId: activeRecord.interventionId,
        completedBy: completedBy ?? req.authKeyId ?? 'unknown',
        completedAt: new Date(),
        guidance,
        ...scope,
      });

      if (!record) {
        return reply.status(409).send({ error: 'Failed to complete intervention', code: 'INTERVENTION_COMPLETE_FAILED' });
      }

      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'session.intervention.complete', `Intervention completed: ${session.id}`, session.id, scope.tenantId);

      return buildResult(session.id, session.status, session.lastActivity, record);
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // POST /v1/sessions/:id/resume
  registerWithLegacy(app, 'post', '/v1/sessions/:id/resume', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const store = ctx.pauseInterventionStore;
    if (!store) return reply.status(501).send({ error: 'Pause/intervention store is not configured' });

    const parsed = resumeSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const { resumedBy, resumeMetadata } = parsed.data;
    const scope = resolveScope(ctx, session.id, req);

    try {
      const resumeId = crypto.randomUUID();
      const record = await store.resume({
        sessionId: session.id,
        resumeId,
        resumedBy: resumedBy ?? req.authKeyId ?? 'unknown',
        resumedAt: new Date(),
        resumeMetadata,
        ...scope,
      });

      if (!record) {
        return reply.status(409).send({ error: 'No paused or intervening session found to resume', code: 'NOT_PAUSED' });
      }

      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'session.resume', `Session resumed: ${session.id}`, session.id, scope.tenantId);

      return buildResult(session.id, session.status, session.lastActivity, record);
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // POST /v1/sessions/:id/cancel
  registerWithLegacy(app, 'post', '/v1/sessions/:id/cancel', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const parsed = cancelSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return reply.status(501).send({ error: 'ACP backend is not configured' });

    const scope = resolveScope(ctx, session.id, req);

    try {
      await acpBackend.cancelSession({ sessionId: session.id, tenantId: scope.tenantId, ownerKeyId: scope.ownerKeyId });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'session.cancel', `Session cancelled: ${session.id}`, session.id, scope.tenantId);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // GET /v1/sessions/:id/intervention
  registerWithLegacy(app, 'get', '/v1/sessions/:id/intervention', withSessionOwnership(ctx, async (req, reply, session) => {
    const store = ctx.pauseInterventionStore;
    if (!store) return reply.status(501).send({ error: 'Pause/intervention store is not configured' });

    const scope = resolveScope(ctx, session.id, req);

    try {
      const record = await store.getActive(session.id, scope) ?? await store.getLatest(session.id, scope);
      if (!record) {
        return reply.status(404).send({ error: 'No intervention found for this session' });
      }
      return serializeRecord(record);
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // POST /v1/sessions/:id/approval/approve
  registerWithLegacy(app, 'post', '/v1/sessions/:id/approval/approve', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const parsed = approveToolSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return reply.status(501).send({ error: 'ACP backend is not configured' });

    const scope = resolveScope(ctx, session.id, req);

    try {
      const result = await acpBackend.approveSession({ sessionId: session.id, tenantId: scope.tenantId, ownerKeyId: scope.ownerKeyId, approvalId: parsed.data.approvalId });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'permission.approve', `Tool approved: ${session.id}`, session.id, scope.tenantId);
      return result;
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // POST /v1/sessions/:id/approval/reject
  registerWithLegacy(app, 'post', '/v1/sessions/:id/approval/reject', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const parsed = rejectToolSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return reply.status(501).send({ error: 'ACP backend is not configured' });

    const scope = resolveScope(ctx, session.id, req);

    try {
      const result = await acpBackend.rejectSession({ sessionId: session.id, tenantId: scope.tenantId, ownerKeyId: scope.ownerKeyId, approvalId: parsed.data.approvalId });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'permission.reject', `Tool rejected: ${session.id}`, session.id, scope.tenantId);
      return result;
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // GET /v1/sessions/:id/approval/pending
  registerWithLegacy(app, 'get', '/v1/sessions/:id/approval/pending', withSessionOwnership(ctx, async (_req, _reply, session) => {
    const acpBackend = ctx.acpBackend;
    if (!acpBackend) return { pending: null };
    const pending = acpBackend.getPendingApproval(session.id);
    return { pending };
  }));
}
