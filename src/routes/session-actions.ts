/**
 * routes/session-actions.ts — Session operations: send, read, answer,
 * escape, interrupt, kill, pane, command, bash, children, spawn, fork, permissions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sendMessageSchema, commandSchema, bashSchema, permissionRuleSchema, permissionProfileSchema, type PermissionProfile } from '../validation.js';
import type { PermissionPolicy } from '../validation.js';
import { registerPermissionRoutes } from '../permission-routes.js';
import { cleanupTerminatedSessionState } from '../session-cleanup.js';
import type { TmuxManager } from '../tmux.js';
import {
  type RouteContext,
  makePayload,
  registerWithLegacy,
  requirePermission,
  resolveRequestAuditActor,
  getRequestRole,
  requestHasPermission,
  withOwnership,
  withSessionOwnership,
} from './context.js';

// ── Issue #2200: Slash command discovery ────────────────────────────────

/** Delay helper for the discover-commands polling loop. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Regex matching `/command  description` lines in the autocomplete panel. */
const SLASH_CMD_PATTERN = /\/(\S+)\s{2,}(.+)/;

/**
 * Issue #2200: Discover available slash commands by interacting with
 * Claude Code's autocomplete panel.
 *
 * 1. Clear input with Ctrl+U
 * 2. Type `/` to open autocomplete panel
 * 3. Loop: capture pane → extract commands → scroll down
 * 4. Stop when stable (5 consecutive identical captures) or max iterations
 * 5. Send Escape to close autocomplete
 */
async function discoverSlashCommands(
  tmux: TmuxManager,
  windowId: string,
): Promise<Array<{ name: string; description: string }>> {
  const MAX_ITERATIONS = 20;
  const STABLE_THRESHOLD = 5;
  const CAPTURE_DELAY_MS = 300;

  const allCommands = new Map<string, string>();
  let previousCapture = '';
  let stableCount = 0;

  try {
    // 1. Clear any existing input
    await tmux.sendSpecialKey(windowId, 'C-u');
    await delay(100);

    // 2. Type `/` to open autocomplete panel
    await tmux.sendKeys(windowId, '/', false);
    await delay(CAPTURE_DELAY_MS);

    // 3. Loop: capture → extract → scroll
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const pane = await tmux.capturePane(windowId);

      for (const line of pane.split('\n')) {
        const match = SLASH_CMD_PATTERN.exec(line);
        if (match) {
          const name = match[1];
          const description = match[2].trim();
          if (!allCommands.has(name)) {
            allCommands.set(name, description);
          }
        }
      }

      // Check stability
      if (pane === previousCapture) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) break;
      } else {
        stableCount = 0;
        previousCapture = pane;
      }

      // Scroll down to reveal more commands
      await tmux.sendSpecialKey(windowId, 'PageDown');
      await delay(CAPTURE_DELAY_MS);
    }
  } finally {
    // 5. Close autocomplete panel
    await tmux.sendSpecialKey(windowId, 'Escape');
    await delay(50);
    await tmux.sendSpecialKey(windowId, 'Escape');
  }

  return Array.from(allCommands.entries()).map(([name, description]) => ({ name, description }));
}

export function registerSessionActionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const {
    sessions, tmux, auth, quotas, config, metrics, monitor, eventBus, channels,
    toolRegistry, getAuditLogger, validateWorkDir,
  } = ctx;

  // Send message (with delivery verification — Issue #1)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/send', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { text } = parsed.data;
    const sessionId = session.id;

    // Issue #1953: Per-key token/spend quota enforcement at send time.
    const keyId = req.authKeyId;
    const apiKey = keyId && keyId !== 'master' ? auth.getKey(keyId) : null;
    if (apiKey) {
      const ownedSessions = sessions.listSessions().filter(s => s.ownerKeyId === keyId);
      const quotaResult = quotas.checkSendQuota(apiKey, ownedSessions.length);
      if (!quotaResult.allowed) {
        return reply.status(429).send({
          error: 'QUOTA_EXCEEDED',
          message: quotaResult.message,
          quota: quotaResult.reason,
          usage: quotaResult.usage,
        });
      }
    }
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
  }, 'send'));

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
    if (!requirePermission(auth, req, reply, 'create')) return;
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
    if (!requirePermission(auth, req, reply, 'create')) return;
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
      hasPermission: (_keyId, permission, req) => requestHasPermission(auth, req, permission),
      resolveRole: (_keyId, req) => getRequestRole(auth, req),
      config,
    },
  );

  // Issue #336: Answer pending AskUserQuestion
  registerWithLegacy(app, 'post', '/v1/sessions/:id/answer', withOwnership(sessions, async (req: FastifyRequest, reply: FastifyReply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
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
  registerWithLegacy(app, 'post', '/v1/sessions/:id/escape', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    try {
      await sessions.escape(session.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // Interrupt (Ctrl+C)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/interrupt', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    try {
      await sessions.interrupt(session.id);
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));

  // Kill session
  registerWithLegacy(app, 'delete', '/v1/sessions/:id', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    try {
      await sessions.killSession(session.id);
      // Issue #2067: record session as failed before cleanup
      metrics.sessionFailed(session.id);
      eventBus.emitEnded(session.id, 'killed');
      const auditLogger = getAuditLogger();
      if (auditLogger) void auditLogger.log(resolveRequestAuditActor(auth, req, 'system'), 'session.kill', `Session killed: ${session.id} (permission=${req.matchedPermission ?? 'kill'})`, session.id, req.tenantId);
      await channels.sessionEnded(makePayload(sessions, 'session.ended', session.id, 'killed'));
      cleanupTerminatedSessionState(session.id, { monitor, metrics, toolRegistry });
      return { ok: true };
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'kill'));

  // Capture raw pane
  registerWithLegacy(app, 'get', '/v1/sessions/:id/pane', withOwnership(sessions, async (_req, _reply, session) => {
    const pane = await tmux.capturePane(session.windowId);
    return { pane };
  }));

  // Slash command
  registerWithLegacy(app, 'post', '/v1/sessions/:id/command', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
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
  }, 'send'));

  // Bash mode — captures command output (Issue #1810)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/bash', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
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
  }, 'send'));

  // Issue #2200: Discover slash commands via autocomplete panel scraping
  registerWithLegacy(app, 'post', '/v1/sessions/:id/discover-commands', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    try {
      const commands = await discoverSlashCommands(tmux, session.windowId);
      return { commands };
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }, 'send'));
}
