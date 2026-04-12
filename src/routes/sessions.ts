/**
 * routes/sessions.ts — Session CRUD, listing, batch, health.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compareSemver, extractCCVersion, MIN_CC_VERSION } from '../validation.js';
import { cleanupTerminatedSessionState } from '../session-cleanup.js';
import {
  type RouteContext, type IdParams, type IdRequest,
  requireRole, requireOwnership, addActionHints, makePayload,
} from './context.js';

const execFileAsync = promisify(execFile);

// #1393: claudeCommand must not contain shell metacharacters
const SAFE_COMMAND_RE = /^[a-zA-Z0-9_./@:= -]+$/;

const createSessionSchema = z.object({
  workDir: z.string().min(1),
  name: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
  prd: z.string().max(100_000).optional(),
  resumeSessionId: z.string().uuid().optional(),
  claudeCommand: z.string().max(500).regex(SAFE_COMMAND_RE).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  parentId: z.string().uuid().optional(),
  memoryKeys: z.array(z.string()).max(50).optional(),
}).strict();

const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  status: z.enum([
    'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
    'settings', 'error', 'unknown',
  ]).optional(),
}).refine(d => d.ids !== undefined || d.status !== undefined, {
  message: 'At least one of "ids" or "status" is required',
});

export function registerSessionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const {
    sessions, auth, metrics, monitor, eventBus, channels,
    memoryBridge, toolRegistry, getAuditLogger, validateWorkDir,
  } = ctx;

  // List sessions (with pagination, status filter, and project filter)
  app.get<{
    Querystring: { page?: string; limit?: string; status?: string; project?: string };
  }>('/v1/sessions', async (req) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const statusFilter = req.query.status;
    const projectFilter = req.query.project;

    let all = sessions.listSessions();
    const callerKeyId = req.authKeyId;
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined) {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
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

    return { sessions: items, pagination: { page, limit, total, totalPages } };
  });

  // Issue #754: Session statistics endpoint
  app.get('/v1/sessions/stats', async (req) => {
    let all = sessions.listSessions();
    const callerKeyId = req.authKeyId;
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined) {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
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
  app.delete('/v1/sessions/batch', async (req, reply) => {
    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const { ids, status } = parsed.data;

    const targets = new Set<string>(ids ?? []);
    if (status) {
      for (const s of sessions.listSessions()) {
        if (s.status === status) targets.add(s.id);
      }
    }

    let deleted = 0;
    const notFound: string[] = [];
    const errors: string[] = [];

    for (const id of targets) {
      const session = sessions.getSession(id);
      if (!session) { notFound.push(id); continue; }
      const callerKeyId = req.authKeyId;
      if (session.ownerKeyId && callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && session.ownerKeyId !== callerKeyId) {
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
  });

  // Backwards compat: /sessions (no prefix) returns raw array
  app.get('/sessions', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    let all = sessions.listSessions();
    const callerKeyId = req.authKeyId;
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined) {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
    return all;
  });

  // Create session (Issue #607: reuse idle session for same workDir)
  async function createSessionHandler(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const { workDir, name, prompt, prd, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove, parentId, memoryKeys } = parsed.data;
    if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

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

    const session = await sessions.createSession({ workDir: safeWorkDir, name, prd, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove, parentId, ownerKeyId: req.authKeyId });
    metrics.sessionCreated(session.id);

    const auditLogger = getAuditLogger();
    if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.create', `Session created: ${session.windowName} in ${safeWorkDir}`, session.id);

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

    return reply.status(201).send({ ...session, promptDelivery });
  }
  app.post('/v1/sessions', createSessionHandler);
  app.post('/sessions', createSessionHandler);

  // Get session (Issue #20: includes actionHints)
  async function getSessionHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    return addActionHints(session, sessions);
  }
  app.get<IdParams>('/v1/sessions/:id', getSessionHandler);
  app.get<IdParams>('/sessions/:id', getSessionHandler);

  // #128: Bulk health check
  app.get('/v1/sessions/health', async (req, reply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const callerKeyId = req.authKeyId;
    const callerRole = auth.getRole(callerKeyId ?? null);
    const allSessions = sessions.listSessions();
    const visibleSessions = callerRole === 'admin' || callerKeyId === null || callerKeyId === undefined
      ? allSessions
      : allSessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
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
    await Promise.all(visibleSessions.map(async (s) => {
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
  async function sessionHealthHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    try {
      return await sessions.getHealth(req.params.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.get<IdParams>('/v1/sessions/:id/health', sessionHealthHandler);
  app.get<IdParams>('/sessions/:id/health', sessionHealthHandler);
}
