import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionManager } from './session.js';
import type { MetricsCollector } from './metrics.js';
import type { AuditLogger } from './audit.js';
import type { ApiKeyRole } from './auth.js';
import type { AuthManager } from './services/auth/index.js';
import type { Config } from './config.js';
import { requireSessionOwnership } from './routes/context.js';

type PermissionAction = 'approve' | 'reject';
type IdParams = { Params: { id: string } };
type IdRequest = FastifyRequest<IdParams>;

type PermissionSessions = Pick<SessionManager, 'approve' | 'reject' | 'getLatencyMetrics' | 'getSession'>;
type PermissionMetrics = Pick<MetricsCollector, 'recordPermissionResponse'>;
type ResolveRole = (keyId: string | null | undefined) => ApiKeyRole;

function createPermissionHandler(
  action: PermissionAction,
  sessions: PermissionSessions,
  metrics: PermissionMetrics,
  audit: AuditLogger | null,
  resolveRole?: ResolveRole,
  getAuditLogger?: () => AuditLogger | null,
  auth?: AuthManager,
  config?: Config,
): (req: IdRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: IdRequest, reply: FastifyReply): Promise<unknown> => {
    // #1641: Enforce operator/admin when role resolution is configured.
    if (resolveRole) {
      const role = resolveRole(req.authKeyId ?? null);
      if (role !== 'admin' && role !== 'operator') {
        return reply.status(403).send({ error: 'Forbidden: operator or admin role required' });
      }
    }

    // Issue #1429: Enforce session ownership
    const keyId = req.authKeyId;

    if (auth && config) {
      const session = requireSessionOwnership(sessions, auth, config, req.params.id, reply, keyId);
      if (!session) {
        const effectiveAudit = getAuditLogger ? getAuditLogger() : audit;
        if (effectiveAudit) {
          void effectiveAudit.log(
            keyId ?? 'system',
            'session.action.denied',
            `Denied ${action}: session owned by another API key`,
            req.params.id,
          );
        }
        return;
      }

      const effectiveAudit = getAuditLogger ? getAuditLogger() : audit;
      if (effectiveAudit) {
        void effectiveAudit.log(
          keyId ?? 'system',
          'session.action.allowed',
          `Allowed ${action}`,
          req.params.id,
        );
      }
    } else {
      const session = sessions.getSession(req.params.id);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      if (keyId !== 'master' && keyId !== null && keyId !== undefined && session.ownerKeyId && session.ownerKeyId !== keyId) {
        return reply.status(403).send({ error: 'Forbidden: session owned by another API key' });
      }
    }

    try {
      if (action === 'approve') {
        await sessions.approve(req.params.id);
      } else {
        await sessions.reject(req.params.id);
      }

      // #1419: Audit permission decision
      // #1640: Resolve audit logger lazily so it picks up the instance set in main()
      const effectiveAudit = getAuditLogger ? getAuditLogger() : audit;
      if (effectiveAudit) {
        void effectiveAudit.log(keyId ?? 'system', `permission.${action}` as `permission.${typeof action}`, `Permission ${action} for session ${req.params.id}`, req.params.id);
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
  audit: AuditLogger | null = null,
  options?: {
    resolveRole?: ResolveRole;
    getAuditLogger?: () => AuditLogger | null;
    auth?: AuthManager;
    config?: Config;
  },
): void {
  for (const action of ['approve', 'reject'] as const) {
    const handler = createPermissionHandler(
      action,
      sessions,
      metrics,
      audit,
      options?.resolveRole,
      options?.getAuditLogger,
      options?.auth,
      options?.config,
    );
    app.post<IdParams>(`/v1/sessions/:id/${action}`, handler);
    app.post<IdParams>(`/sessions/:id/${action}`, handler);
  }
}
