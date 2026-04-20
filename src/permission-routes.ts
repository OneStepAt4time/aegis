import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SessionManager } from './session.js';
import type { MetricsCollector } from './metrics.js';
import type { AuditLogger } from './audit.js';
import type { ApiKeyRole } from './auth.js';
import type { Config } from './config.js';

type PermissionAction = 'approve' | 'reject';
type IdParams = { Params: { id: string } };
type IdRequest = FastifyRequest<IdParams>;

type PermissionSessions = Pick<SessionManager, 'approve' | 'reject' | 'getLatencyMetrics' | 'getSession'>;
type PermissionMetrics = Pick<MetricsCollector, 'recordPermissionResponse'>;
type ResolveRole = (keyId: string | null | undefined) => ApiKeyRole;
type HasPermission = (keyId: string | null | undefined, permission: PermissionAction) => boolean;

function createPermissionHandler(
  action: PermissionAction,
  sessions: PermissionSessions,
  metrics: PermissionMetrics,
  audit: AuditLogger | null,
  hasPermission?: HasPermission,
  resolveRole?: ResolveRole,
  getAuditLogger?: () => AuditLogger | null,
  config?: Config,
): (req: IdRequest, reply: FastifyReply) => Promise<unknown> {
  return async (req: IdRequest, reply: FastifyReply): Promise<unknown> => {
    req.matchedPermission = action;
    if (hasPermission && !hasPermission(req.authKeyId ?? null, action)) {
      return reply.status(403).send({ error: `Forbidden: missing ${action} permission` });
    }

    const matchedPermission = req.matchedPermission ?? action;

    // Issue #1429 + #1910: Enforce session ownership with admin bypass + audit
    const session = sessions.getSession(req.params.id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    const keyId = req.authKeyId;

    // Feature flag check (#1910): skip enhanced ownership when disabled
    const enforce = config?.enforceSessionOwnership ?? true;

    if (enforce && keyId !== 'master' && keyId !== null && keyId !== undefined && session.ownerKeyId) {
      const role = resolveRole ? resolveRole(keyId) : 'viewer';
      if (role === 'admin') {
        // Admin bypass — emit allowed audit
        const effectiveAudit = getAuditLogger ? getAuditLogger() : audit;
        if (effectiveAudit) void effectiveAudit.log(keyId, 'session.action.allowed', `Admin bypass for ${matchedPermission} on session ${session.id}`, session.id);
      } else if (session.ownerKeyId !== keyId) {
        // Denied — emit denied audit
        const effectiveAudit = getAuditLogger ? getAuditLogger() : audit;
        if (effectiveAudit) void effectiveAudit.log(keyId, 'session.action.denied', `Non-owner ${matchedPermission} denied on session ${session.id} (owner: ${session.ownerKeyId})`, session.id);
        return reply.status(403).send({ error: 'SESSION_FORBIDDEN', message: 'You do not own this session' });
      }
    } else if (!enforce && keyId !== 'master' && keyId !== null && keyId !== undefined && session.ownerKeyId && session.ownerKeyId !== keyId) {
      return reply.status(403).send({ error: 'Forbidden: session owned by another API key' });
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
        void effectiveAudit.log(
          keyId ?? 'system',
          `permission.${action}` as `permission.${typeof action}`,
          `Permission ${action} for session ${req.params.id} (permission=${matchedPermission})`,
          req.params.id,
        );
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
    hasPermission?: HasPermission;
    resolveRole?: ResolveRole;
    getAuditLogger?: () => AuditLogger | null;
    config?: Config;
  },
): void {
  for (const action of ['approve', 'reject'] as const) {
    const handler = createPermissionHandler(
      action,
      sessions,
      metrics,
      audit,
      options?.hasPermission,
      options?.resolveRole,
      options?.getAuditLogger,
      options?.config,
    );
    app.post<IdParams>(`/v1/sessions/:id/${action}`, handler);
    app.post<IdParams>(`/sessions/:id/${action}`, handler);
  }
}
