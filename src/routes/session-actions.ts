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
  type RouteContext, type IdRequest,
  requireRole, requireOwnership, makePayload,
  registerWithLegacy, withOwnership,
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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/send', sendMessageHandler);

  // Issue #702: GET children sessions
  registerWithLegacy(app, 'get', '/v1/sessions/:id/children', withOwnership(sessions, async (_req, _reply, session) => {
    const children = (session.children ?? []).map(id => {
      const child = sessions.getSession(id);
      if (!child) return null;
      return { id: child.id, windowName: child.windowName, status: child.status, createdAt: child.createdAt };
    }).filter(Boolean);
    return { children };
  }));

  // Issue #702: Spawn child session
  interface SpawnBody { name?: string; prompt?: string; workDir?: string; permissionMode?: string; }
  registerWithLegacy(app, 'post', '/v1/sessions/:id/spawn', withOwnership(sessions, async (req, reply, parent) => {
    const { name, prompt, workDir, permissionMode } = (req.body as SpawnBody | undefined) ?? {};
    const childName = name ?? `${parent.windowName ?? 'session'}-child`;
    const requestedWorkDir = workDir ?? parent.workDir;
    const safeChildWorkDir = await validateWorkDir(requestedWorkDir);
    if (typeof safeChildWorkDir === 'object') {
      return reply.status(400).send({ error: `Invalid workDir: ${safeChildWorkDir.error}`, code: safeChildWorkDir.code });
    }
    const childPermMode = permissionMode ?? parent.permissionMode ?? 'default';
    const childSession = await sessions.createSession({ workDir: safeChildWorkDir, name: childName, parentId: parent.id, permissionMode: childPermMode, ownerKeyId: req.authKeyId });
    let promptDelivery: { delivered: boolean; attempts: number } | undefined;
    if (prompt) { promptDelivery = await sessions.sendInitialPrompt(childSession.id, prompt); }
    return reply.status(201).send({ ...childSession, promptDelivery });
  }));

  // Issue #468: Fork session
  interface ForkBody { name?: string; prompt?: string; clearPanes?: boolean; }
  registerWithLegacy(app, 'post', '/v1/sessions/:id/fork', withOwnership(sessions, async (req, reply, parent) => {
    const { name, prompt } = (req.body as ForkBody | undefined) ?? {};
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
      detail: `Session forked from ${parent.id}`,
    });
    return reply.status(201).send({ ...forkedSession, forkedFrom: parent.id, promptDelivery });
  }));

  // Issue #700: Permission policy endpoints
  registerWithLegacy(app, 'get', '/v1/sessions/:id/permissions', withOwnership(sessions, async (_req, _reply, session) => {
    return { permissionPolicy: session.permissionPolicy ?? [] };
  }));
  registerWithLegacy(app, 'put', '/v1/sessions/:id/permissions', withOwnership(sessions, async (req, reply, session) => {
    const policy = (req.body as PermissionPolicy | undefined) ?? [];
    const result = permissionRuleSchema.array().safeParse(policy);
    if (!result.success) return reply.status(400).send({ error: 'Invalid permission policy', details: result.error.issues });
    session.permissionPolicy = policy;
    await sessions.save();
    return { permissionPolicy: policy };
  }));

  registerWithLegacy(app, 'get', '/v1/sessions/:id/permission-profile', withOwnership(sessions, async (_req, _reply, session) => {
    return { permissionProfile: session.permissionProfile ?? null };
  }));
  registerWithLegacy(app, 'put', '/v1/sessions/:id/permission-profile', withOwnership(sessions, async (req, reply, session) => {
    const parsed = permissionProfileSchema.safeParse((req.body as PermissionProfile | undefined) ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid permission profile', details: parsed.error.issues });
    session.permissionProfile = parsed.data;
    await sessions.save();
    return { permissionProfile: parsed.data };
  }));

  // Read messages
  registerWithLegacy(app, 'get', '/v1/sessions/:id/read', withOwnership(sessions, async (_req, reply, session) => {
    try {
      return await sessions.readMessages(session.id);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

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
  app.post('/v1/sessions/:id/answer', withOwnership(sessions, async (req, reply, session) => {
    const { questionId, answer } = (req.body as { questionId?: string; answer?: string } | undefined) || {};
    if (!questionId || answer === undefined || answer === null) {
      return reply.status(400).send({ error: 'questionId and answer are required' });
    }
    const resolved = sessions.submitAnswer(session.id, questionId, answer);
    if (!resolved) {
      return reply.status(409).send({ error: 'No pending question matching this questionId' });
    }
    return { ok: true };
  }));

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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/escape', escapeHandler);

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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/interrupt', interruptHandler);

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
  registerWithLegacy(app, 'delete', '/v1/sessions/:id', killSessionHandler);

  // Capture raw pane
  registerWithLegacy(app, 'get', '/v1/sessions/:id/pane', withOwnership(sessions, async (_req, _reply, session) => {
    const pane = await tmux.capturePane(session.windowId);
    return { pane };
  }));

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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/command', commandHandler);

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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/bash', bashHandler);
}
