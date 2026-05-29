/**
 * routes/quick-approve-reject.ts — Dedicated quick approve/reject endpoints
 * for the dashboard inline buttons (Issue #4193).
 *
 * These endpoints provide dedicated routes with richer request bodies
 * (approverId, reason) and explicit audit trail entries for the dashboard
 * quick-approve/reject UX.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { safeErrorMessage,
  type RouteContext,
  registerWithLegacy,
  requirePermission,
  resolveRequestAuditActor,
  requireSessionOwnership,
} from './context.js';

interface QuickApproveBody {
  approverId?: string;
}

interface QuickRejectBody {
  reason?: string;
}

export function registerQuickApproveRejectRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, auth, metrics, getAuditLogger } = ctx;

  // POST /v1/sessions/:id/permission/approve
  const approveHandler = async (req: FastifyRequest<{ Params: { id: string }; Body: QuickApproveBody }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'approve')) return;
    const id = req.params.id;
    const session = requireSessionOwnership(ctx, id, req, reply, 'approve');
    if (!session) return;

    const { approverId } = (req.body as QuickApproveBody | undefined) ?? {};

    try {
      await sessions.approve(id);

      // Audit log with rich metadata
      const auditLogger = getAuditLogger();
      const actor = resolveRequestAuditActor(auth, req, approverId ?? 'dashboard');
      if (auditLogger) {
        void auditLogger.log(
          actor,
          'permission.approve' as const,
          `Quick approve for session ${id} (source=dashboard, approverId=${approverId ?? 'n/a'})`,
          id,
          req.tenantId,
        );
      }

      // Record permission response latency (Issue #87)
      const lat = sessions.getLatencyMetrics(id);
      if (lat !== null && lat.permission_response_ms !== null) {
        metrics.recordPermissionResponse(id, lat.permission_response_ms);
      }

      return reply.send({ ok: true });
    } catch (e: unknown) {
      return reply.status(404).send({ error: safeErrorMessage(e, 404) });
    }
  };

  registerWithLegacy(app, 'post', '/v1/sessions/:id/permission/approve', approveHandler);

  // POST /v1/sessions/:id/permission/reject
  const rejectHandler = async (req: FastifyRequest<{ Params: { id: string }; Body: QuickRejectBody }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'reject')) return;
    const id = req.params.id;
    const session = requireSessionOwnership(ctx, id, req, reply, 'reject');
    if (!session) return;

    const { reason } = (req.body as QuickRejectBody | undefined) ?? {};

    try {
      await sessions.reject(id);

      // Audit log with reason
      const auditLogger = getAuditLogger();
      const actor = resolveRequestAuditActor(auth, req, 'dashboard');
      if (auditLogger) {
        void auditLogger.log(
          actor,
          'permission.reject' as const,
          `Quick reject for session ${id} (source=dashboard, reason=${reason ?? 'n/a'})`,
          id,
          req.tenantId,
        );
      }

      // Record permission response latency (Issue #87)
      const lat = sessions.getLatencyMetrics(id);
      if (lat !== null && lat.permission_response_ms !== null) {
        metrics.recordPermissionResponse(id, lat.permission_response_ms);
      }

      return reply.send({ ok: true });
    } catch (e: unknown) {
      return reply.status(404).send({ error: safeErrorMessage(e, 404) });
    }
  };

  registerWithLegacy(app, 'post', '/v1/sessions/:id/permission/reject', rejectHandler);
}
