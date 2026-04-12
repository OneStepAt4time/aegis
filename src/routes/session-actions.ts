/**
 * routes/session-actions.ts — Session operations: send, read, answer,
 * escape, interrupt, kill, pane, command, bash, children, spawn, fork, permissions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendMessageSchema, commandSchema, bashSchema, permissionRuleSchema, permissionProfileSchema, type PermissionProfile } from '../validation.js';
import type { PermissionPolicy } from '../validation.js';
import { registerPermissionRoutes } from '../permission-routes.js';
import { cleanupTerminatedSessionState } from '../session-cleanup.js';
import {
  type RouteContext, type IdParams, type IdRequest,
  requireRole, requireOwnership, makePayload,
} from './context.js';

export function registerSessionActionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const {
    sessions, tmux, auth, metrics, monitor, eventBus, channels,
    toolRegistry, getAuditLogger, validateWorkDir,
  } = ctx;

  // Send message (with delivery verification — Issue #1)
  async function sendMessageHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    const { text } = parsed.data;
    try {
      const stallInfo = monitor.getStallInfo(req.params.id);
      const result = await sessions.sendMessage(req.params.id, text, stallInfo);
      await channels.message({
        event: 'message.user',
        timestamp: new Date().toISOString(),
        session: { id: req.params.id, name: '', workDir: '' },
        detail: text,
      });
      const response: Record<string, unknown> = { ok: true, delivered: result.delivered, attempts: result.attempts };
      if (result.stall) response.stall = result.stall;
      return response;
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/send', sendMessageHandler);
  app.post<IdParams>('/sessions/:id/send', sendMessageHandler);

  // Issue #702: GET children sessions
  async function getChildrenHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
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

  // Issue #702: Spawn child session
  interface SpawnBody { name?: string; prompt?: string; workDir?: string; permissionMode?: string; }
  type SpawnRequest = FastifyRequest<{ Params: { id: string }; Body: SpawnBody | undefined }>;
  async function spawnChildHandler(req: SpawnRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const parentId = req.params.id;
    const parent = requireOwnership(sessions, parentId, reply, req.authKeyId);
    if (!parent) return reply as unknown as Record<string, unknown>;
    const { name, prompt, workDir, permissionMode } = req.body ?? {};
    const childName = name ?? `${parent.windowName ?? 'session'}-child`;
    const requestedWorkDir = workDir ?? parent.workDir;
    const safeChildWorkDir = await validateWorkDir(requestedWorkDir);
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

  // Issue #468: Fork session
  interface ForkBody { name?: string; prompt?: string; clearPanes?: boolean; }
  type ForkRequest = FastifyRequest<{ Params: { id: string }; Body: ForkBody | undefined }>;
  async function forkSessionHandler(req: ForkRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const parentId = req.params.id;
    const parent = requireOwnership(sessions, parentId, reply, req.authKeyId);
    if (!parent) return reply as unknown as Record<string, unknown>;
    const { name, prompt } = req.body ?? {};
    const forkName = name ?? `${parent.windowName ?? 'session'}-fork`;
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

  // Issue #700: Permission policy endpoints
  type PermissionRequest = FastifyRequest<{ Params: { id: string }; Body: PermissionPolicy | undefined }>;
  async function getPermissionPolicyHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    return { permissionPolicy: session.permissionPolicy ?? [] };
  }
  async function updatePermissionPolicyHandler(req: PermissionRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
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

  type PermissionProfileRequest = FastifyRequest<{ Params: { id: string }; Body: PermissionProfile | undefined }>;
  async function getPermissionProfileHandler(req: IdRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return reply as unknown as Record<string, unknown>;
    return { permissionProfile: session.permissionProfile ?? null };
  }
  async function updatePermissionProfileHandler(req: PermissionProfileRequest, reply: FastifyReply): Promise<Record<string, unknown>> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
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

  // Read messages
  async function readMessagesHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    try {
      return await sessions.readMessages(req.params.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.get<IdParams>('/v1/sessions/:id/read', readMessagesHandler);
  app.get<IdParams>('/sessions/:id/read', readMessagesHandler);

  // Register approve/reject permission routes
  registerPermissionRoutes(
    app,
    {
      approve: async (id: string) => sessions.approve(id),
      reject: async (id: string) => sessions.reject(id),
      getLatencyMetrics: (id: string) => sessions.getLatencyMetrics(id),
      getSession: (id: string) => sessions.getSession(id),
    },
    {
      recordPermissionResponse: (id: string, latencyMs: number) => metrics.recordPermissionResponse(id, latencyMs),
    },
    null,
    {
      getAuditLogger: () => getAuditLogger() ?? null,
      resolveRole: (keyId) => auth.getRole(keyId),
    },
  );

  // Issue #336: Answer pending AskUserQuestion
  app.post<{
    Params: { id: string };
    Body: { questionId?: string; answer?: string };
  }>('/v1/sessions/:id/answer', async (req, reply) => {
    const { questionId, answer } = req.body || {};
    if (!questionId || answer === undefined || answer === null) {
      return reply.status(400).send({ error: 'questionId and answer are required' });
    }
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;
    const resolved = sessions.submitAnswer(req.params.id, questionId, answer);
    if (!resolved) {
      return reply.status(409).send({ error: 'No pending question matching this questionId' });
    }
    return { ok: true };
  });

  // Escape
  async function escapeHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    try {
      await sessions.escape(req.params.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/escape', escapeHandler);
  app.post<IdParams>('/sessions/:id/escape', escapeHandler);

  // Interrupt (Ctrl+C)
  async function interruptHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    try {
      await sessions.interrupt(req.params.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.post<IdParams>('/v1/sessions/:id/interrupt', interruptHandler);
  app.post<IdParams>('/sessions/:id/interrupt', interruptHandler);

  // Kill session
  async function killSessionHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    try {
      await sessions.killSession(req.params.id);
      eventBus.emitEnded(req.params.id, 'killed');
      const auditLogger = getAuditLogger();
      if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.kill', `Session killed: ${req.params.id}`, req.params.id);
      await channels.sessionEnded(makePayload(sessions, 'session.ended', req.params.id, 'killed'));
      cleanupTerminatedSessionState(req.params.id, { monitor, metrics, toolRegistry });
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.delete<IdParams>('/v1/sessions/:id', killSessionHandler);
  app.delete<IdParams>('/sessions/:id', killSessionHandler);

  // Capture raw pane
  async function capturePaneHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;
    const pane = await tmux.capturePane(session.windowId);
    return { pane };
  }
  app.get<IdParams>('/v1/sessions/:id/pane', capturePaneHandler);
  app.get<IdParams>('/sessions/:id/pane', capturePaneHandler);

  // Slash command
  async function commandHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
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

  // Bash mode
  async function bashHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    const parsed = bashSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
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
}
