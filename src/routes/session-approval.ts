/**
 * routes/session-approval.ts — Issue #4088: Session-level approval endpoints.
 *
 * These are DISTINCT from the permission approve/reject routes in permission-routes.ts.
 * Session approval gates whether CC starts at all; permission approval gates
 * individual CC tool-use requests.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  type RouteContext,
  requireSessionOwnership,
} from './context.js';

export function registerSessionApprovalRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { sessions, channels } = ctx;

  // POST /v1/sessions/:id/session-approve — approve a session awaiting approval
  const approveHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const session = requireSessionOwnership(ctx, id, req, reply, 'send');
    if (!session) return;

    if (session.status !== 'awaiting_approval') {
      return reply.status(409).send({
        error: 'SESSION_NOT_AWAITING_APPROVAL',
        message: `Session is not awaiting approval (status: ${session.status})`,
      });
    }

    try {
      const approvedBy = req.authKeyId ?? 'unknown';
      const updated = await sessions.approveSession(id, approvedBy);

      // Notify channels
      channels.statusChange({
        event: 'session.approved',
        timestamp: new Date().toISOString(),
        session: { id: updated.id, name: updated.displayName ?? '', workDir: updated.workDir },
        detail: `Session approved by ${approvedBy}`,
      });

      return { ok: true, status: updated.status, approvedBy: updated.approvedBy, approvedAt: updated.approvedAt };
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  app.post('/v1/sessions/:id/session-approve', approveHandler);
  app.post('/sessions/:id/session-approve', approveHandler);

  // POST /v1/sessions/:id/session-reject — reject a session awaiting approval
  const rejectHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const session = requireSessionOwnership(ctx, id, req, reply, 'kill');
    if (!session) return;

    if (session.status !== 'awaiting_approval') {
      return reply.status(409).send({
        error: 'SESSION_NOT_AWAITING_APPROVAL',
        message: `Session is not awaiting approval (status: ${session.status})`,
      });
    }

    try {
      await sessions.rejectSession(id);

      // Notify channels
      channels.statusChange({
        event: 'session.rejected',
        timestamp: new Date().toISOString(),
        session: { id: session.id, name: session.displayName ?? '', workDir: session.workDir },
        detail: 'Session rejected',
      });

      return { ok: true, status: 'killed' };
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  app.post('/v1/sessions/:id/session-reject', rejectHandler);
  app.post('/sessions/:id/session-reject', rejectHandler);
}
