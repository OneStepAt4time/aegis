import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionManager } from './session.js';
import type { MetricsCollector } from './metrics.js';

type PermissionAction = 'approve' | 'reject';
type IdParams = { Params: { id: string } };
type IdRequest = FastifyRequest<IdParams>;

type PermissionSessions = Pick<SessionManager, 'approve' | 'reject' | 'getLatencyMetrics'>;
type PermissionMetrics = Pick<MetricsCollector, 'recordPermissionResponse'>;

function createPermissionHandler(
  action: PermissionAction,
  sessions: PermissionSessions,
  metrics: PermissionMetrics,
): (req: IdRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: IdRequest, reply: FastifyReply): Promise<unknown> => {
    try {
      if (action === 'approve') {
        await sessions.approve(req.params.id);
      } else {
        await sessions.reject(req.params.id);
      }

      // Issue #87: Record permission response latency.
      const lat = sessions.getLatencyMetrics(req.params.id);
      if (lat !== null && lat.permission_response_ms !== null) {
        metrics.recordPermissionResponse(req.params.id, lat.permission_response_ms);
      }

      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export function registerPermissionRoutes(
  app: FastifyInstance,
  sessions: PermissionSessions,
  metrics: PermissionMetrics,
): void {
  for (const action of ['approve', 'reject'] as const) {
    const handler = createPermissionHandler(action, sessions, metrics);
    app.post<IdParams>(`/v1/sessions/:id/${action}`, handler);
    app.post<IdParams>(`/sessions/:id/${action}`, handler);
  }
}
