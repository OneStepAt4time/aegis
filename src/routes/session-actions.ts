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
  type RouteContext,
  requireRole, makePayload,
  registerWithLegacy, withOwnership, withSessionOwnership,
} from './context.js';

export function registerSessionActionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const {
    sessions, tmux, auth, metrics, monitor, eventBus, channels,
    toolRegistry, getAuditLogger, validateWorkDir,
  } = ctx;

  // Send message (with delivery verification — Issue #1)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/send', withSessionOwnership(sessions, auth, ctx.config, getAuditLogger, 'send', async (req, reply, session) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { text } = parsed.data;
    const sessionId = session.id;
    try {
      const result = await sessions.sendMessage(sessionId, text);
      // Issue #1809: Re-fetch stall info AFTER delivery to avoid false-positive.
      // Previously we called getStallInfo BEFORE send, capturing a stale state
      // (session was temporarily quiet but became active after message delivery).
      const currentStallInfo = monitor.getStallInfo(sessionId);
      await channels.message({
        event: 'message.user',
        timestamp: new Date().toISOString(),
        session: { id: sessionId, name: '', workDir: '' },
        detail: text,
      });
      const response: Record<string, unknown> = { ok: true, delivered: result.delivered, attempts: result.attempts };
      if (currentStallInfo.stalled) response.stall = currentStallInfo;
      return response;
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

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
      auth,
      config: ctx.config,
    },
  );

  // Issue #336: Answer pending AskUserQuestion
  registerWithLegacy(app, 'post', '/v1/sessions/:id/answer', withOwnership(sessions, async (req: FastifyRequest, reply: FastifyReply, session) => {
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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/escape', withSessionOwnership(sessions, auth, ctx.config, getAuditLogger, 'escape', async (req, reply, session) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    try {
      await sessions.escape(session.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Interrupt (Ctrl+C)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/interrupt', withSessionOwnership(sessions, auth, ctx.config, getAuditLogger, 'interrupt', async (req, reply, session) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    try {
      await sessions.interrupt(session.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Kill session
  registerWithLegacy(app, 'delete', '/v1/sessions/:id', withSessionOwnership(sessions, auth, ctx.config, getAuditLogger, 'kill', async (req, reply, session) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    try {
      await sessions.killSession(session.id);
      eventBus.emitEnded(session.id, 'killed');
      const auditLogger = getAuditLogger();
      if (auditLogger) void auditLogger.log(req.authKeyId ?? 'system', 'session.kill', `Session killed: ${session.id}`, session.id);
      await channels.sessionEnded(makePayload(sessions, 'session.ended', session.id, 'killed'));
      cleanupTerminatedSessionState(session.id, { monitor, metrics, toolRegistry });
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Capture raw pane
  registerWithLegacy(app, 'get', '/v1/sessions/:id/pane', withOwnership(sessions, async (_req, _reply, session) => {
    const pane = await tmux.capturePane(session.windowId);
    return { pane };
  }));

  // Slash command
  registerWithLegacy(app, 'post', '/v1/sessions/:id/command', withSessionOwnership(sessions, auth, ctx.config, getAuditLogger, 'command', async (req, reply, session) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    const parsed = commandSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { command } = parsed.data;
    try {
      const cmd = command.startsWith('/') ? command : `/${command}`;
      await sessions.sendMessage(session.id, cmd);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Bash mode — captures command output (Issue #1810)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/bash', withSessionOwnership(sessions, auth, ctx.config, getAuditLogger, 'bash', async (req, reply, session) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator')) return;
    const parsed = bashSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { command } = parsed.data;
    try {
      const cmd = command.startsWith('!') ? command : `!${command}`;

      // Capture baseline pane content before sending
      let baseline = '';
      try {
        baseline = await tmux.capturePane(session.windowId);
      } catch { /* baseline capture is best-effort */ }

      await sessions.sendMessage(session.id, cmd);

      // Wait for command output, then capture and diff
      const result: { ok: true; output?: string } = { ok: true };
      try {
        await new Promise<void>(resolve => setTimeout(resolve, 5000));
        const after = await tmux.capturePane(session.windowId);
        const newOutput = after.startsWith(baseline)
          ? after.slice(baseline.length)
          : after;
        const trimmed = newOutput.trim();
        if (trimmed) {
          result.output = trimmed;
        }
      } catch { /* output capture is best-effort */ }

      return result;
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));
}
