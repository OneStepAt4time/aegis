/**
 * sessions.ts — Session route plugin.
 *
 * Registers ALL session-related routes extracted from server.ts.
 * This is the largest route plugin, handling session CRUD, messaging,
 * permissions, hooks, screenshots, SSE streams, transcripts, and more.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  sendMessageSchema,
  commandSchema,
  bashSchema,
  screenshotSchema,
  permissionHookSchema,
  stopHookSchema,
  batchSessionSchema,
  parseIntSafe,
  isValidUUID,
  compareSemver,
  extractCCVersion,
  MIN_CC_VERSION,
  permissionRuleSchema,
  permissionProfileSchema,
  type PermissionPolicy,
  type PermissionProfile,
} from '../validation.js';
import { captureScreenshot, isPlaywrightAvailable } from '../screenshot.js';
import { validateScreenshotUrl, resolveAndCheckIp, buildHostResolverRule } from '../ssrf.js';
import { SSEWriter } from '../sse-writer.js';
import type { SessionSSEEvent } from '../events.js';
import { runVerification } from '../verification.js';
import type { SessionInfo } from '../session.js';
import type { RouteDeps } from './route-deps.js';

// ── Shared types ──────────────────────────────────────────────────────

type IdParams = { Params: { id: string } };
type IdRequest = FastifyRequest<IdParams>;

// ── Constants ─────────────────────────────────────────────────────────

/** Issue #1393: claudeCommand must not contain shell metacharacters. */
const SAFE_COMMAND_RE = /^[a-zA-Z0-9_./@:= -]+$/;

/** Maximum concurrent sessions for batch create. */
const MAX_CONCURRENT_SESSIONS = 200;

/** Async version of execFile for non-blocking version check. */
const execFileAsync = promisify(execFile);

// ── Schemas ───────────────────────────────────────────────────────────

/** POST /v1/sessions — session creation schema (Issue #226). */
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

/** DELETE /v1/sessions/batch — bulk delete schema (Issue #754). */
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

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Add actionHints to a session response for interactive states (Issue #20).
 * Also exposes pending question data for MCP/REST callers (Issue #599).
 */
function addActionHints(
  session: SessionInfo,
  sessions?: RouteDeps['sessions'],
): Record<string, unknown> {
  // #357: Convert Set to array for JSON serialization
  const result: Record<string, unknown> = {
    ...session,
    activeSubagents: session.activeSubagents ? [...session.activeSubagents] : undefined,
  };
  if (session.status === 'permission_prompt' || session.status === 'bash_approval') {
    result.actionHints = {
      approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
      reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
    };
  }
  // #599: Expose pending question data for MCP/REST callers
  if (session.status === 'ask_question' && sessions) {
    const info = sessions.getPendingQuestionInfo(session.id);
    if (info) {
      result.pendingQuestion = {
        toolUseId: info.toolUseId,
        content: info.question,
        options: extractQuestionOptions(info.question),
        since: info.timestamp,
      };
    }
  }
  return result;
}

/** #599: Extract selectable options from AskUserQuestion text. */
function extractQuestionOptions(text: string): string[] | null {
  // Numbered options: "1. Foo\n2. Bar"
  const numberedRegex = /^\s*(\d+)\.\s+(.+)$/gm;
  const options: string[] = [];
  let m;
  while ((m = numberedRegex.exec(text)) !== null) {
    options.push(m[2].trim());
  }
  if (options.length >= 2) return options.slice(0, 4);
  return null;
}

// ── Route Plugin ──────────────────────────────────────────────────────

export function registerSessionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const {
    sessions, eventBus, channels, pipelines, toolRegistry,
    metrics, sseLimiter, memoryBridge, auditLogger, auth, config,
    requestKeyMap, validateWorkDir: validateWorkDirWithConfig,
    makePayload, cleanupTerminatedSessionState,
    requireRole, requireOwnership,
  } = deps;

  // ── List sessions (paginated, filtered) ─────────────────────────────

  app.get<{
    Querystring: { page?: string; limit?: string; status?: string; project?: string };
  }>('/v1/sessions', async (req) => {
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    const statusFilter = req.query.status;
    const projectFilter = req.query.project;

    let all = sessions.listSessions();
    // Issue #1429: Scope sessions to owner for non-master keys
    const callerKeyId = req.authKeyId;
    if (callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined) {
      all = all.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    }
    if (statusFilter) {
      all = all.filter(s => s.status === statusFilter);
    }
    // Issue #754: filter by project (workDir prefix/substring match)
    if (projectFilter) {
      const lower = projectFilter.toLowerCase();
      all = all.filter(s => s.workDir.toLowerCase().includes(lower));
    }

    // Sort by createdAt descending (newest first)
    all.sort((a, b) => b.createdAt - a.createdAt);

    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);

    const totalPages = Math.ceil(total / limit);

    return {
      sessions: items,
      pagination: { page, limit, total, totalPages },
    };
  });

  // ── Session statistics (Issue #754) ─────────────────────────────────

  app.get('/v1/sessions/stats', async () => {
    const all = sessions.listSessions();
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

  // ── Bulk delete sessions (Issue #754) ───────────────────────────────

  app.delete('/v1/sessions/batch', async (req, reply) => {
    const parsed = batchDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }
    const { ids, status } = parsed.data;

    // Collect target session IDs
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
      // Issue #1429: Enforce ownership in batch delete
      if (!session) {
        notFound.push(id);
        continue;
      }
      // Skip sessions owned by another key (unless master/no-auth)
      const callerKeyId = req.authKeyId;
      if (session.ownerKeyId && callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && session.ownerKeyId !== callerKeyId) {
        continue;
      }
      try {
        await sessions.killSession(id);
        eventBus.emitEnded(id, 'killed');
        void channels.sessionEnded(makePayload('session.ended', id, 'killed'));
        cleanupTerminatedSessionState(id, { monitor: deps.monitor, metrics, toolRegistry });
        deleted++;
      } catch (e: unknown) {
        errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return reply.status(200).send({ deleted, notFound, errors });
  });

  // ── Backwards compat: /sessions (no prefix) returns raw array ───────

  app.get('/sessions', async () => sessions.listSessions());

  // ── Create session (Issue #607: reuse idle session for same workDir) ─

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

    const safeWorkDir = await validateWorkDirWithConfig(workDir);
    if (typeof safeWorkDir === 'object') return reply.status(400).send({ error: safeWorkDir.error, code: safeWorkDir.code });

    // Issue #607: Check for an existing idle session with the same workDir
    const existing = await sessions.findIdleSessionByWorkDir(safeWorkDir);
    if (existing) {
      try {
        // Send prompt to the existing session if provided
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

    console.time("POST_CREATE_SESSION");
    const session = await sessions.createSession({ workDir: safeWorkDir, name, prd, resumeSessionId, claudeCommand, env, stallThresholdMs, permissionMode, autoApprove, parentId, ownerKeyId: req.authKeyId });
    console.timeEnd("POST_CREATE_SESSION"); console.time("POST_CHANNEL_CREATED");

    // Issue #625: Track session in metrics so sessionsCreated counter is accurate
    metrics.sessionCreated(session.id);

    // #1419: Audit session creation
    if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.create', `Session created: ${session.windowName} in ${safeWorkDir}`, session.id);

    // Issue #46: Create Telegram topic BEFORE sending prompt.
    await channels.sessionCreated({
      event: 'session.created',
      timestamp: new Date().toISOString(),
      session: { id: session.id, name: session.windowName, workDir },
      detail: `Session created: ${session.windowName}`,
      meta: prompt ? { prompt: prompt.slice(0, 200), permissionMode: permissionMode ?? (autoApprove ? 'bypassPermissions' : undefined) } : undefined,
    });
    console.timeEnd("POST_CHANNEL_CREATED"); console.time("POST_SEND_INITIAL_PROMPT");

    // Now send the prompt (topic exists, monitor can forward messages)
    let promptDelivery: { delivered: boolean; attempts: number } | undefined;
    if (prompt) {
      // Issue #783: Inject resolved memory values into prompt
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
      console.timeEnd("POST_SEND_INITIAL_PROMPT");
      metrics.promptSent(promptDelivery.delivered);
    } else {
      console.timeEnd("POST_SEND_INITIAL_PROMPT");
    }

    return reply.status(201).send({ ...session, promptDelivery });
  }
  app.post('/v1/sessions', createSessionHandler);
  app.post('/sessions', createSessionHandler);

  // ── Get session (Issue #20: includes actionHints for interactive states) ─

  async function getSessionHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    return addActionHints(session, sessions);
  }
  app.get<IdParams>('/v1/sessions/:id', getSessionHandler);
  app.get<IdParams>('/sessions/:id', getSessionHandler);

  // ── Bulk health check (Issue #128) ──────────────────────────────────

  app.get('/v1/sessions/health', async (req) => {
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
      } catch { /* health check failed — report error state */
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

  // ── Session health check (Issue #2) ─────────────────────────────────

  async function sessionHealthHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      return await sessions.getHealth(req.params.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.get<IdParams>('/v1/sessions/:id/health', sessionHealthHandler);
  app.get<IdParams>('/sessions/:id/health', sessionHealthHandler);

  // ── Send message (with delivery verification — Issue #1) ────────────

  async function sendMessageHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    const { text } = parsed.data;
    try {
      const result = await sessions.sendMessage(req.params.id, text);
      await channels.message({
        event: 'message.user',
        timestamp: new Date().toISOString(),
        session: { id: req.params.id, name: '', workDir: '' },
        detail: text,
      });
      return { ok: true, delivered: result.delivered, attempts: result.attempts };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/send', sendMessageHandler);
  app.post<IdParams>('/sessions/:id/send', sendMessageHandler);

  // ── Get children sessions (Issue #702) ──────────────────────────────

  async function getChildrenHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    const children = (session.children ?? []).map(id => {
      const child = sessions.getSession(id);
      if (!child) return null;
      return { id: child.id, windowName: child.windowName, status: child.status, createdAt: child.createdAt };
    }).filter(Boolean);
    return { children };
  }
  app.get<IdParams>('/v1/sessions/:id/children', getChildrenHandler);
  app.get<IdParams>('/sessions/:id/children', getChildrenHandler);

  // ── Spawn child session (Issue #702) ────────────────────────────────

  interface SpawnBody { name?: string; prompt?: string; workDir?: string; permissionMode?: string; }
  type SpawnRequest = FastifyRequest<{ Params: { id: string }; Body: SpawnBody | undefined }>;
  async function spawnChildHandler(req: SpawnRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const parentId = req.params.id;
    const parent = requireOwnership(parentId, reply, req.authKeyId);
    if (!parent) return reply as unknown as Record<string, unknown>;
    const { name, prompt, workDir, permissionMode } = req.body ?? {};
    const childName = name ?? `${parent.windowName ?? 'session'}-child`;
    const requestedWorkDir = workDir ?? parent.workDir;
    const safeChildWorkDir = await validateWorkDirWithConfig(requestedWorkDir);
    if (typeof safeChildWorkDir === 'object') {
      return reply.status(400).send({ error: `Invalid workDir: ${safeChildWorkDir.error}`, code: safeChildWorkDir.code });
    }
    const childPermMode = permissionMode ?? parent.permissionMode ?? 'default';
    const childSession = await sessions.createSession({ workDir: safeChildWorkDir, name: childName, parentId, permissionMode: childPermMode, ownerKeyId: req.authKeyId });
    let promptDelivery: { delivered: boolean; attempts: number } | undefined;
    if (prompt) { promptDelivery = await sessions.sendInitialPrompt(childSession.id, prompt); }
    return reply.status(201).send({ ...childSession, promptDelivery });
  }
  app.post('/v1/sessions/:id/spawn', spawnChildHandler);
  app.post('/sessions/:id/spawn', spawnChildHandler);

  // ── Fork session (Issue #468) ───────────────────────────────────────

  interface ForkBody { name?: string; prompt?: string; clearPanes?: boolean; }
  type ForkRequest = FastifyRequest<{ Params: { id: string }; Body: ForkBody | undefined }>;
  async function forkSessionHandler(req: ForkRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const parentId = req.params.id;
    const parent = requireOwnership(parentId, reply, req.authKeyId);
    if (!parent) return reply as unknown as Record<string, unknown>;
    const { name, prompt } = req.body ?? {};
    const forkName = name ?? `${parent.windowName ?? 'session'}-fork`;
    // Inherit: workDir, permissionMode, env (collect from parent's env vars if stored)
    // Note: Parent's env vars are passed during creation but not stored in SessionInfo
    // For now, we inherit structural settings (workDir, permissionMode)
    const forkedSession = await sessions.createSession({
      workDir: parent.workDir,
      name: forkName,
      permissionMode: parent.permissionMode,
      ownerKeyId: req.authKeyId,
    });
    let promptDelivery: { delivered: boolean; attempts: number } | undefined;
    if (prompt) { promptDelivery = await sessions.sendInitialPrompt(forkedSession.id, prompt); }
    await channels.sessionCreated({
      event: 'session.created',
      timestamp: new Date().toISOString(),
      session: { id: forkedSession.id, name: forkedSession.windowName, workDir: parent.workDir },
      detail: `Session forked from ${parentId}`,
    });
    return reply.status(201).send({ ...forkedSession, forkedFrom: parentId, promptDelivery });
  }
  app.post('/v1/sessions/:id/fork', forkSessionHandler);
  app.post('/sessions/:id/fork', forkSessionHandler);

  // ── Permission policy endpoints (Issue #700) ────────────────────────

  type PermissionRequest = FastifyRequest<{ Params: { id: string }; Body: PermissionPolicy | undefined }>;
  async function getPermissionPolicyHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    return { permissionPolicy: session.permissionPolicy ?? [] };
  }
  async function updatePermissionPolicyHandler(req: PermissionRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    const policy = req.body ?? [];
    const result = permissionRuleSchema.array().safeParse(policy);
    if (!result.success) return reply.status(400).send({ error: 'Invalid permission policy', details: result.error.issues });
    session.permissionPolicy = policy;
    await sessions.save();
    return { permissionPolicy: policy };
  }
  app.get<IdParams>('/v1/sessions/:id/permissions', getPermissionPolicyHandler);
  app.put('/v1/sessions/:id/permissions', updatePermissionPolicyHandler);
  app.get<IdParams>('/sessions/:id/permissions', getPermissionPolicyHandler);
  app.put('/sessions/:id/permissions', updatePermissionPolicyHandler);

  // ── Permission profile endpoints (Issue #742) ───────────────────────

  type PermissionProfileRequest = FastifyRequest<{ Params: { id: string }; Body: PermissionProfile | undefined }>;
  async function getPermissionProfileHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    return { permissionProfile: session.permissionProfile ?? null };
  }
  async function updatePermissionProfileHandler(req: PermissionProfileRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    const parsed = permissionProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid permission profile', details: parsed.error.issues });
    session.permissionProfile = parsed.data;
    await sessions.save();
    return { permissionProfile: parsed.data };
  }
  app.get<IdParams>('/v1/sessions/:id/permission-profile', getPermissionProfileHandler);
  app.put('/v1/sessions/:id/permission-profile', updatePermissionProfileHandler);
  app.get<IdParams>('/sessions/:id/permission-profile', getPermissionProfileHandler);
  app.put('/sessions/:id/permission-profile', updatePermissionProfileHandler);

  // ── Read messages ───────────────────────────────────────────────────

  async function readMessagesHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      return await sessions.readMessages(req.params.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.get<IdParams>('/v1/sessions/:id/read', readMessagesHandler);
  app.get<IdParams>('/sessions/:id/read', readMessagesHandler);

  // ── Answer pending question (Issue #336) ────────────────────────────

  app.post<{
    Params: { id: string };
    Body: { questionId?: string; answer?: string };
  }>('/v1/sessions/:id/answer', async (req, reply) => {
    const { questionId, answer } = req.body || {};
    if (!questionId || answer === undefined || answer === null) {
      return reply.status(400).send({ error: 'questionId and answer are required' });
    }
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return;
    const resolved = sessions.submitAnswer(req.params.id, questionId, answer);
    if (!resolved) {
      return reply.status(409).send({ error: 'No pending question matching this questionId' });
    }
    return { ok: true };
  });

  // ── Escape ──────────────────────────────────────────────────────────

  async function escapeHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      await sessions.escape(req.params.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/escape', escapeHandler);
  app.post<IdParams>('/sessions/:id/escape', escapeHandler);

  // ── Interrupt (Ctrl+C) ──────────────────────────────────────────────

  async function interruptHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      await sessions.interrupt(req.params.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/interrupt', interruptHandler);
  app.post<IdParams>('/sessions/:id/interrupt', interruptHandler);

  // ── Kill session ────────────────────────────────────────────────────

  async function killSessionHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    // Issue #1432: Admin or operator can kill sessions
    if (!requireRole(req, reply, 'admin', 'operator')) return;
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      // #842: killSession first, then notify — avoids race where channels
      // reference a session that is still being destroyed.
      await sessions.killSession(req.params.id);
      eventBus.emitEnded(req.params.id, 'killed');
      // #1419: Audit session kill
      if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.kill', `Session killed: ${req.params.id}`, req.params.id);
      await channels.sessionEnded(makePayload('session.ended', req.params.id, 'killed'));
      cleanupTerminatedSessionState(req.params.id, { monitor: deps.monitor, metrics, toolRegistry });
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.delete<IdParams>('/v1/sessions/:id', killSessionHandler);
  app.delete<IdParams>('/sessions/:id', killSessionHandler);

  // ── Capture raw pane ────────────────────────────────────────────────

  async function capturePaneHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return;
    const pane = await deps.tmux.capturePane(session.windowId);
    return { pane };
  }
  app.get<IdParams>('/v1/sessions/:id/pane', capturePaneHandler);
  app.get<IdParams>('/sessions/:id/pane', capturePaneHandler);

  // ── Slash command ───────────────────────────────────────────────────

  async function commandHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    const { command } = parsed.data;
    try {
      const cmd = command.startsWith('/') ? command : `/${command}`;
      await sessions.sendMessage(req.params.id, cmd);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/command', commandHandler);
  app.post<IdParams>('/sessions/:id/command', commandHandler);

  // ── Bash mode ───────────────────────────────────────────────────────

  async function bashHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const parsed = bashSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    const { command } = parsed.data;
    try {
      const cmd = command.startsWith('!') ? command : `!${command}`;
      await sessions.sendMessage(req.params.id, cmd);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/bash', bashHandler);
  app.post<IdParams>('/sessions/:id/bash', bashHandler);

  // ── Session summary (Issue #35) ─────────────────────────────────────

  async function summaryHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      return await sessions.getSummary(req.params.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.get<IdParams>('/v1/sessions/:id/summary', summaryHandler);
  app.get<IdParams>('/sessions/:id/summary', summaryHandler);

  // ── Paginated transcript read ───────────────────────────────────────

  app.get<{
    Params: { id: string };
    Querystring: { page?: string; limit?: string; role?: string };
  }>('/v1/sessions/:id/transcript', async (req, reply) => {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const allowedRoles = new Set(['user', 'assistant', 'system']);
      const roleFilter = req.query.role as string | undefined;
      if (roleFilter && !allowedRoles.has(roleFilter)) {
        return reply.status(400).send({ error: `Invalid role filter: ${roleFilter}. Allowed values: user, assistant, system` });
      }
      return await sessions.readTranscript(req.params.id, page, limit, roleFilter as 'user' | 'assistant' | 'system' | undefined);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Cursor-based transcript replay (Issue #883) ─────────────────────

  app.get<{
    Params: { id: string };
    Querystring: { before_id?: string; limit?: string; role?: string };
  }>('/v1/sessions/:id/transcript/cursor', async (req, reply) => {
    if (!requireOwnership(req.params.id, reply, req.authKeyId)) return;
    try {
      const rawBeforeId = req.query.before_id;
      const beforeId = rawBeforeId !== undefined ? parseInt(rawBeforeId, 10) : undefined;
      if (beforeId !== undefined && (!Number.isInteger(beforeId) || beforeId < 1)) {
        return reply.status(400).send({ error: 'before_id must be a positive integer' });
      }
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
      const allowedRoles = new Set(['user', 'assistant', 'system']);
      const roleFilter = req.query.role as string | undefined;
      if (roleFilter && !allowedRoles.has(roleFilter)) {
        return reply.status(400).send({ error: `Invalid role filter: ${roleFilter}. Allowed values: user, assistant, system` });
      }
      return await sessions.readTranscriptCursor(
        req.params.id,
        beforeId,
        limit,
        roleFilter as 'user' | 'assistant' | 'system' | undefined,
      );
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ── Screenshot capture (Issue #22) ──────────────────────────────────

  async function screenshotHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const parsed = screenshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { url, fullPage, width, height } = parsed.data;

    const urlError = validateScreenshotUrl(url);
    if (urlError) return reply.status(400).send({ error: urlError });

    // DNS-resolution check: resolve hostname and reject private IPs.
    const hostname = new URL(url).hostname;
    const dnsResult = await resolveAndCheckIp(hostname);
    if (dnsResult.error) return reply.status(400).send({ error: dnsResult.error });

    // Validate session exists
    const sessionId = (req.params as { id: string }).id;
    const session = sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    if (!isPlaywrightAvailable()) {
      return reply.status(501).send({
        error: 'Playwright is not installed',
        message: 'Install Playwright to enable screenshots: npx playwright install chromium && npm install -D playwright',
      });
    }

    try {
      // Pin the validated IP via host-resolver-rules to prevent DNS rebinding
      const hostResolverRule = dnsResult.resolvedIp
        ? buildHostResolverRule(hostname, dnsResult.resolvedIp)
        : undefined;
      const result = await captureScreenshot({ url, fullPage, width, height, hostResolverRule });
      return reply.status(200).send(result);
    } catch (e: unknown) {
      return reply.status(500).send({ error: `Screenshot failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/screenshot', screenshotHandler);
  app.post<IdParams>('/sessions/:id/screenshot', screenshotHandler);

  // ── SSE event stream (Issue #32) ────────────────────────────────────

  app.get<{ Params: { id: string } }>('/v1/sessions/:id/events', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const clientIp = req.ip;
    const acquireResult = sseLimiter.acquire(clientIp);
    if (!acquireResult.allowed) {
      const status = acquireResult.reason === 'per_ip_limit' ? 429 : 503;
      return reply.status(status).send({
        error: acquireResult.reason === 'per_ip_limit'
          ? `Per-IP connection limit reached (${acquireResult.current}/${acquireResult.limit})`
          : `Global connection limit reached (${acquireResult.current}/${acquireResult.limit})`,
        reason: acquireResult.reason,
      });
    }

    // Issue #505: Subscribe BEFORE writing response headers so that if
    // subscription fails, we can still return a proper HTTP error.
    let unsubscribe: (() => void) | undefined;
    const connectionId = acquireResult.connectionId;
    let writer: SSEWriter;

    // Queue events that arrive between subscription and writer creation
    const pendingEvents: SessionSSEEvent[] = [];
    let subscriptionReady = false;

    try {
      const handler = (event: SessionSSEEvent): void => {
        if (!subscriptionReady) {
          pendingEvents.push(event);
          return;
        }
        const id = event.id != null ? `id: ${event.id}\n` : '';
        writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      };
      unsubscribe = eventBus.subscribe(req.params.id, handler);
    } catch (err) {
      req.log.error({ err, sessionId: req.params.id }, 'SSE subscription failed — unable to create event listener');
      sseLimiter.release(connectionId);
      return reply.status(500).send({ error: 'Failed to create SSE subscription' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    writer = new SSEWriter(reply.raw, req.raw, () => {
      unsubscribe?.();
      sseLimiter.release(connectionId);
    });

    // Now safe to deliver events — flush any queued during setup
    subscriptionReady = true;
    for (const event of pendingEvents) {
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    }

    // Send initial connected event
    writer.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

    // Issue #308: Replay missed events if client sends Last-Event-ID
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      const missed = eventBus.getEventsSince(req.params.id, parseInt(lastEventId as string, 10) || 0);
      for (const event of missed) {
        const id = event.id != null ? `id: ${event.id}\n` : '';
        writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      }
    }

    writer.startHeartbeat(30_000, 90_000, () =>
      `data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`
    );

    // Don't let Fastify auto-send (we manage the response manually)
    await reply;
  });

  // ── Claude Code Hook Endpoints (Issue #161) ────────────────────────

  // POST /v1/sessions/:id/hooks/permission — PermissionRequest hook from CC
  app.post<{
    Params: { id: string };
    Body: {
      session_id?: string;
      tool_name?: string;
      tool_input?: unknown;
      permission_mode?: string;
      hook_event_name?: string;
    };
  }>('/v1/sessions/:id/hooks/permission', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const parsed = permissionHookSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { tool_name, tool_input, permission_mode } = parsed.data;

    // Update session status
    session.status = 'permission_prompt';
    session.lastActivity = Date.now();
    await sessions.save();

    // Notify channels and SSE
    const detail = tool_name
      ? `Permission request: ${tool_name}${permission_mode ? ` (${permission_mode})` : ''}`
      : 'Permission requested';
    await channels.statusChange({
      event: 'status.permission',
      timestamp: new Date().toISOString(),
      session: { id: session.id, name: session.windowName, workDir: session.workDir },
      detail,
      meta: { tool_name, tool_input, permission_mode },
    });
    eventBus.emitApproval(session.id, detail);

    return reply.status(200).send({});
  });

  // POST /v1/sessions/:id/hooks/stop — Stop hook from CC
  app.post<{
    Params: { id: string };
    Body: {
      session_id?: string;
      stop_reason?: string;
      hook_event_name?: string;
    };
  }>('/v1/sessions/:id/hooks/stop', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const parsed = stopHookSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { stop_reason } = parsed.data;

    // Update session status
    session.status = 'idle';
    session.lastActivity = Date.now();
    await sessions.save();

    // Notify channels and SSE
    const detail = stop_reason
      ? `Claude Code stopped: ${stop_reason}`
      : 'Claude Code session ended normally';
    await channels.statusChange({
      event: 'status.idle',
      timestamp: new Date().toISOString(),
      session: { id: session.id, name: session.windowName, workDir: session.workDir },
      detail,
      meta: { stop_reason },
    });
    eventBus.emitStatus(session.id, 'idle', detail);

    return reply.status(200).send({});
  });

  // ── Batch create (Issue #36, #583) ──────────────────────────────────

  app.post('/v1/sessions/batch', async (req, reply) => {
    const parsed = batchSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const specs = parsed.data.sessions;

    // #583: Per-key batch rate limit (max 1 batch per 5 seconds)
    const keyId = requestKeyMap.get(req.id) ?? 'anonymous';
    if (auth.checkBatchRateLimit(keyId)) {
      return reply.status(429).send({ error: 'Batch rate limit exceeded — 1 batch per 5 seconds per key' });
    }

    // #583: Global concurrent session cap
    const currentCount = sessions.listSessions().length;
    if (currentCount + specs.length > MAX_CONCURRENT_SESSIONS) {
      return reply.status(429).send({ error: `Session cap exceeded — ${currentCount} active, max ${MAX_CONCURRENT_SESSIONS}` });
    }

    for (const spec of specs) {
      const safeWorkDir = await validateWorkDirWithConfig(spec.workDir);
      if (typeof safeWorkDir === 'object') {
        return reply.status(400).send({ error: `Invalid workDir "${spec.workDir}": ${safeWorkDir.error}`, code: safeWorkDir.code });
      }
      spec.workDir = safeWorkDir;
      // Issue #1429: Stamp owner on batch-created sessions
      if (req.authKeyId) (spec as Record<string, unknown>).ownerKeyId = req.authKeyId;
    }
    const result = await pipelines.batchCreate(specs);
    return reply.status(201).send(result);
  });

  // ── Verification Protocol (Issue #740) ──────────────────────────────

  app.post('/v1/sessions/:id/verify', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessionId, reply, req.authKeyId);
    if (!session) return;

    const { workDir } = session;
    if (!workDir) return reply.status(400).send({ error: 'Session has no workDir' });

    const criticalOnly = (config as { verificationProtocol?: { criticalOnly?: boolean } }).verificationProtocol?.criticalOnly ?? false;
    eventBus.emitStatus(sessionId, 'working', `Running verification (criticalOnly=${criticalOnly})...`);

    try {
      const result = await runVerification(workDir, criticalOnly);
      eventBus.emitVerification(sessionId, result);
      const httpStatus = result.ok ? 200 : 422;
      return reply.status(httpStatus).send(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ ok: false, summary: `Verification error: ${msg}` });
    }
  });
}
