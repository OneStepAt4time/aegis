/**
 * routes/sessions.ts — Session CRUD, listing, batch, health.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareSemver, extractCCVersion, MIN_CC_VERSION, buildEnvSchema } from '../validation.js';
import { SYSTEM_TENANT } from '../config.js';
import { filterByTenant } from '../utils/tenant-filter.js';
import { validateWorkdirPath } from '../tenant-workdir.js';
import { cleanupTerminatedSessionState } from '../session-cleanup.js';
import {
  type RouteContext,
  requirePermission,
  requireRole,
  resolveRequestAuditActor,
  getRequestRole,
  addActionHints,
  redactSession,
  makePayload,
  registerWithLegacy, withOwnership, withValidation,
} from './context.js';

const execFileAsync = promisify(execFile);

// #1393: claudeCommand must not contain shell metacharacters
const SAFE_COMMAND_RE = /^[a-zA-Z0-9_./@:= -]+$/;

/** Build the create-session schema with config-driven env denylist. */
function buildCreateSessionSchema(ctx: RouteContext) {
  const extraDenylist = ctx.config.envDenylist ?? [];
  const adminAllowlist = ctx.config.envAdminAllowlist ?? [];
  return z.object({
    workDir: z.string().min(1),
    name: z.string().max(200).optional(),
    prompt: z.string().max(100_000).optional(),
    prd: z.string().max(100_000).optional(),
    resumeSessionId: z.string().uuid().optional(),
    claudeCommand: z.string().max(500).regex(SAFE_COMMAND_RE).optional(),
    env: buildEnvSchema(extraDenylist, adminAllowlist).optional(),
    stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
    permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
    autoApprove: z.boolean().optional(),
    parentId: z.string().uuid().optional(),
    memoryKeys: z.array(z.string()).max(50).optional(),
  }).strict();
}

const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  status: z.enum([
    'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
    'settings', 'error', 'rate_limit', 'unknown',
  ]).optional(),
}).refine(d => d.ids !== undefined || d.status !== undefined, {
  message: 'At least one of "ids" or "status" is required',
});

const sessionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.string().optional(),
  ownerKeyId: z.string().optional(),
});
export function registerSessionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const {
    sessions, auth, quotas, metrics, monitor, eventBus, channels,
    memoryBridge, toolRegistry, getAuditLogger, validateWorkDir,
  } = ctx;

  // Build schema once with config-driven env denylist (Issue #1908)
  const createSessionSchema = buildCreateSessionSchema(ctx);

  // Session history (created/killed + active), paginated.
  registerWithLegacy(app, 'get', '/v1/sessions/history', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

    const parsed = sessionHistoryQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }

    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 50;
    const statusFilter = parsed.data.status;
    const ownerFilter = parsed.data.ownerKeyId;

    const historyMap = new Map<string, {
      id: string;
      ownerKeyId?: string;
      createdAt?: number;
      endedAt?: number;
      lastSeenAt: number;
      finalStatus: 'active' | 'killed' | 'unknown';
      source: 'audit' | 'live' | 'audit+live';
    }>();

    const auditLogger = getAuditLogger();
    if (auditLogger) {
      const records = await auditLogger.query({ limit: 5000, reverse: true });
      for (const rec of records) {
        if ((rec.action !== 'session.create' && rec.action !== 'session.kill') || !rec.sessionId) continue;
        const tsMs = Date.parse(rec.ts);
        if (!Number.isFinite(tsMs)) continue;
        const existing = historyMap.get(rec.sessionId) ?? {
          id: rec.sessionId,
          createdAt: undefined,
          endedAt: undefined,
          ownerKeyId: undefined,
          lastSeenAt: tsMs,
          finalStatus: 'unknown' as const,
          source: 'audit' as const,
        };

        if (rec.action === 'session.create') {
          existing.createdAt = existing.createdAt ?? tsMs;
          existing.ownerKeyId = existing.ownerKeyId ?? rec.actor;
          if (!existing.endedAt) {
            existing.finalStatus = 'unknown';
          }
        } else if (rec.action === 'session.kill') {
          existing.endedAt = existing.endedAt ?? tsMs;
          existing.finalStatus = 'killed';
        }

        existing.lastSeenAt = Math.max(existing.lastSeenAt, tsMs);
        historyMap.set(rec.sessionId, existing);
      }
    }

    for (const s of sessions.listSessions()) {
      const existing = historyMap.get(s.id);
      if (existing) {
        existing.ownerKeyId = existing.ownerKeyId ?? s.ownerKeyId;
        existing.createdAt = existing.createdAt ?? s.createdAt;
        existing.lastSeenAt = Math.max(existing.lastSeenAt, s.lastActivity || s.createdAt);
        existing.finalStatus = 'active';
        existing.source = existing.source === 'audit' ? 'audit+live' : 'live';
      } else {
        historyMap.set(s.id, {
          id: s.id,
          ownerKeyId: s.ownerKeyId,
          createdAt: s.createdAt,
          endedAt: undefined,
          lastSeenAt: s.lastActivity || s.createdAt,
          finalStatus: 'active',
          source: 'live',
        });
      }
    }

    let history = Array.from(historyMap.values());
    const callerKeyId = req.authKeyId;
    const callerRole = getRequestRole(auth, req);
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && callerRole !== 'admin') {
      history = history.filter(h => !h.ownerKeyId || h.ownerKeyId === callerKeyId);
    }
    if (ownerFilter) {
      history = history.filter(h => h.ownerKeyId === ownerFilter);
    }
    if (statusFilter) {
      history = history.filter(h => h.finalStatus === statusFilter);
    }

    history.sort((a, b) => (b.lastSeenAt - a.lastSeenAt) || (b.createdAt ?? 0) - (a.createdAt ?? 0));

    const total = history.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const items = history.slice(start, start + limit);

    return {
      records: items,
      pagination: { page, limit, total: total ?? 0, totalPages: totalPages ?? 0 },
    };
  });
  // List sessions (with pagination, status filter, and project filter)
  // Note: uses app.get directly since /sessions is a separate route with different behavior (raw array vs paginated object)
  // Issue #2462: validate pagination params instead of silently clamping
  const sessionsListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    status: z.string().optional(),
    project: z.string().optional(),
  });

  app.get<{ Querystring: { page?: string; limit?: string; status?: string; project?: string } }>('/v1/sessions', async (req, reply) => {
    const parsed = sessionsListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }
    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 20;
    const statusFilter = req.query.status;
    const projectFilter = req.query.project;

    let all = sessions.listSessions();
    const callerKeyId = req.authKeyId;
    const callerRole = getRequestRole(auth, req);
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && callerRole !== 'admin') {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
    // Issue #1944: Tenant scoping
    all = filterByTenant(all, req.tenantId);
    if (statusFilter) {
      all = all.filter(s => s.status === statusFilter);
    }
    if (projectFilter) {
      const lower = projectFilter.toLowerCase();
      all = all.filter(s => s.workDir.toLowerCase().includes(lower));
    }
    all.sort((a, b) => b.createdAt - a.createdAt);

    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    const totalPages = Math.ceil(total / limit);

    // Issue #2527: Redact sensitive fields from session list responses
    const safeItems = items.map(s => redactSession(s as unknown as Record<string, unknown>));
    return { sessions: safeItems, pagination: { page, limit, total: total ?? 0, totalPages: totalPages ?? 0 } };
  });

  // Issue #754: Session statistics endpoint
  registerWithLegacy(app, 'get', '/v1/sessions/stats', async (req: FastifyRequest, _reply: FastifyReply) => {
    let all = sessions.listSessions();
    const callerKeyId = req.authKeyId;
    const callerRole = getRequestRole(auth, req);
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && callerRole !== 'admin') {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
    // Issue #1944: Tenant scoping
    all = filterByTenant(all, req.tenantId);
    const byStatus: Partial<Record<string, number>> = {};
    for (const s of all) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    }
    const global = metrics.getGlobalMetrics(all.length);
    return {
      active: all.length,
      byStatus,
      totalCreated: global.sessions.total_created,
      totalCompleted: global.sessions.completed,
      totalFailed: global.sessions.failed,
    };
  });

  // Issue #754: Bulk-delete sessions
  registerWithLegacy(app, 'delete', '/v1/sessions/batch', withValidation(batchDeleteSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const { ids, status } = data;

    const targets = new Set<string>(ids ?? []);
    if (status) {
      for (const s of sessions.listSessions()) {
        if (s.status === status) targets.add(s.id);
      }
    }

    const callerKeyId = req.authKeyId;
    const callerRole = getRequestRole(auth, req);

    let deleted = 0;
    const notFound: string[] = [];
    const errors: string[] = [];

    for (const id of targets) {
      const session = sessions.getSession(id);
      if (!session) { notFound.push(id); continue; }
      if (
        session.ownerKeyId
        && callerKeyId !== 'master'
        && callerRole !== 'admin'
        && callerKeyId !== null
        && callerKeyId !== undefined
        && session.ownerKeyId !== callerKeyId
      ) {
        continue;
      }
      try {
        await sessions.killSession(id);
        eventBus.emitEnded(id, 'killed');
        void channels.sessionEnded(makePayload(sessions, 'session.ended', id, 'killed'));
        cleanupTerminatedSessionState(id, { monitor, metrics, toolRegistry });
        deleted++;
      } catch (e: unknown) {
        errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return reply.status(200).send({ deleted, notFound, errors });
  }));

  // Backwards compat: /sessions (no prefix) returns raw array
  app.get('/sessions', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    let all = sessions.listSessions();
    const callerKeyId = req.authKeyId;
    const callerRole = getRequestRole(auth, req);
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && callerRole !== 'admin') {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
    // Issue #1944: Tenant scoping
    all = filterByTenant(all, req.tenantId);
    // Issue #2527: Redact sensitive fields
    return all.map(s => redactSession(s as unknown as Record<string, unknown>));
  });

  // Create session (Issue #607: reuse idle session for same workDir)
  async function createSessionHandler(req: FastifyRequest, reply: FastifyReply, data: z.infer<typeof createSessionSchema>): Promise<unknown> {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const { workDir, name, prompt, prd, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove, parentId, memoryKeys } = data;
    if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

    // Issue #1953: Per-key quota enforcement at session creation.
    const keyId = req.authKeyId;
    const apiKey = keyId && keyId !== 'master' ? auth.getKey(keyId) : null;
    if (apiKey) {
      const ownedSessions = sessions.listSessions().filter(s => s.ownerKeyId === keyId);
      const quotaResult = quotas.checkSessionQuota(apiKey, ownedSessions.length);
      if (!quotaResult.allowed) {
        const auditLogger = getAuditLogger();
        if (auditLogger) void auditLogger.log(resolveRequestAuditActor(auth, req, 'system'), 'session.quota.rejected', quotaResult.message ?? 'Quota exceeded', undefined, req.tenantId);
        return reply.status(429).send({
          error: 'QUOTA_EXCEEDED',
          message: quotaResult.message,
          quota: quotaResult.reason,
          usage: quotaResult.usage,
        });
      }
    }

    // Issue #564: Validate installed Claude Code version
    try {
      const { stdout: raw } = await execFileAsync('claude', ['--version'], { encoding: 'utf-8', timeout: 5000 });
      const ccVer = extractCCVersion(raw);
      if (ccVer !== null && compareSemver(ccVer, MIN_CC_VERSION) < 0) {
        return reply.status(422).send({
          error: `Claude Code version ${ccVer} is below minimum supported version ${MIN_CC_VERSION}. Please upgrade.`,
          code: 'CC_VERSION_TOO_OLD',
          upgrade: 'Run: claude update  or  npm install -g @anthropic-ai/claude-code@latest',
        });
      }
    } catch {
      // claude CLI not found or timed out — skip version check (fails open)
    }

    const safeWorkDir = await validateWorkDir(workDir);
    if (typeof safeWorkDir === 'object') return reply.status(400).send({ error: safeWorkDir.error, code: safeWorkDir.code });

    // Issue #1945: Tenant workdir namespace validation
    const tenantWorkdirResult = validateWorkdirPath(req.tenantId, safeWorkDir, ctx.config);
    if (!tenantWorkdirResult.allowed) {
      const auditLogger = getAuditLogger();
      if (auditLogger) void auditLogger.log(resolveRequestAuditActor(auth, req, 'system'), 'session.action.denied', tenantWorkdirResult.reason ?? 'Tenant workdir validation failed', undefined, req.tenantId);
      return reply.status(403).send({ error: tenantWorkdirResult.reason ?? 'workDir is outside tenant root', code: 'TENANT_WORKDIR_DENIED' });
    }

    // Issue #607: Check for an existing idle session with the same workDir
    const existing = await sessions.findIdleSessionByWorkDir(safeWorkDir);
    if (existing) {
      try {
        let promptDelivery: { delivered: boolean; attempts: number } | undefined;
        if (prompt) {
          let finalPrompt = prompt;
          if (memoryKeys && memoryKeys.length > 0 && memoryBridge) {
            const resolved = memoryBridge.resolveKeys(memoryKeys);
            if (resolved.size > 0) {
              const lines = ['[Memory context]'];
              for (const [k, v] of resolved) lines.push(`${k}: ${v}`);
              lines.push('', prompt);
              finalPrompt = lines.join('\n');
            }
          }
          promptDelivery = await sessions.sendInitialPrompt(existing.id, finalPrompt);
          metrics.promptSent(promptDelivery.delivered);
        }
        return reply.status(200).send({ ...existing, reused: true, promptDelivery });
      } finally {
        sessions.releaseSessionClaim(existing.id);
      }
    }

    const session = await sessions.createSession({ workDir: safeWorkDir, name, prd, resumeSessionId, claudeCommand, env: env as Record<string, string> | undefined, stallThresholdMs, permissionMode, autoApprove, parentId, ownerKeyId: req.authKeyId, tenantId: req.tenantId });
    metrics.sessionCreated(session.id);

    const auditLogger = getAuditLogger();
    if (auditLogger) void auditLogger.log(resolveRequestAuditActor(auth, req, 'system'), 'session.create', `Session created: ${session.windowName} in ${safeWorkDir} (permission=${req.matchedPermission ?? 'create'})`, session.id, req.tenantId);

    await channels.sessionCreated({
      event: 'session.created',
      timestamp: new Date().toISOString(),
      session: { id: session.id, name: session.windowName, workDir },
      detail: `Session created: ${session.windowName}`,
      meta: prompt ? { prompt: prompt.slice(0, 200), permissionMode: permissionMode ?? (autoApprove ? 'bypassPermissions' : undefined) } : undefined,
    });

    let promptDelivery: { delivered: boolean; attempts: number } | undefined;
    if (prompt) {
      let finalPrompt = prompt;
      if (memoryKeys && memoryKeys.length > 0 && memoryBridge) {
        const resolved = memoryBridge.resolveKeys(memoryKeys);
        if (resolved.size > 0) {
          const lines = ['[Memory context]'];
          for (const [k, v] of resolved) lines.push(`${k}: ${v}`);
          lines.push('', prompt);
          finalPrompt = lines.join('\n');
        }
      }
      promptDelivery = await sessions.sendInitialPrompt(session.id, finalPrompt);
      metrics.promptSent(promptDelivery.delivered);
    }

    return reply.status(201).send({ ...redactSession(session as unknown as Record<string, unknown>), promptDelivery });
  }
  registerWithLegacy(app, 'post', '/v1/sessions', {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute',
      },
    },
    // Issue #1908: Custom handler wraps withValidation to emit audit on env rejection
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        // Emit audit record for env-related rejections (Issue #1908)
        const envErrors = parsed.error.issues.filter(i => i.path.length >= 2 && i.path[0] === 'env');
        if (envErrors.length > 0) {
          const auditLogger = getAuditLogger();
          if (auditLogger) {
            void auditLogger.log(
              resolveRequestAuditActor(auth, req, 'anonymous'),
              'session.env.rejected',
              envErrors.map(e => e.message).join('; '),
              undefined,
              req.tenantId,
            );
          }
        }
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }
      return createSessionHandler(req, reply, parsed.data);
    },
  });

  // Get session (Issue #20: includes actionHints)
  registerWithLegacy(app, 'get', '/v1/sessions/:id', withOwnership(sessions, async (_req, _reply, session) => {
    return addActionHints(session, sessions);
  }));

  // #128: Bulk health check
  registerWithLegacy(app, 'get', '/v1/sessions/health', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const callerKeyId = req.authKeyId;
    const callerRole = getRequestRole(auth, req);
    let allSessions = sessions.listSessions();
    // Issue #1944: Apply ownership + tenant scoping
    if (!(callerRole === 'admin' || callerKeyId === null || callerKeyId === undefined)) {
      allSessions = allSessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
    allSessions = filterByTenant(allSessions, req.tenantId);
    const results: Record<string, {
      alive: boolean;
      windowExists: boolean;
      claudeRunning: boolean;
      paneCommand: string | null;
      status: string;
      hasTranscript: boolean;
      lastActivity: number;
      lastActivityAgo: number;
      sessionAge: number;
      details: string;
    }> = {};
    await Promise.all(allSessions.map(async (s) => {
      try {
        results[s.id] = await sessions.getHealth(s.id);
      } catch {
        results[s.id] = {
          alive: false, windowExists: false, claudeRunning: false,
          paneCommand: null, status: 'unknown', hasTranscript: false,
          lastActivity: 0, lastActivityAgo: 0, sessionAge: 0,
          details: 'Error fetching health',
        };
      }
    }));
    return results;
  });

  // Session health check (Issue #2)
  registerWithLegacy(app, 'get', '/v1/sessions/:id/health', withOwnership(sessions, async (_req, reply, session) => {
    try {
      return await sessions.getHealth(session.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));
}
