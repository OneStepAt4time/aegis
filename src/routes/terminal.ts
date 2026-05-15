/**
 * routes/terminal.ts — ACP terminal debug endpoints (Issue #2617).
 *
 * Provides REST endpoints for ACP terminal extension operations:
 *   GET  /v1/sessions/:id/terminal/content
 *   POST /v1/sessions/:id/terminal/open
 *   POST /v1/sessions/:id/terminal/input
 *   POST /v1/sessions/:id/terminal/resize
 *   POST /v1/sessions/:id/terminal/reconnect
 *   POST /v1/sessions/:id/terminal/close
 */

import { z } from 'zod';
import {
  type RouteContext,
  registerWithLegacy,
  withSessionOwnership,
  requirePermission,
  resolveRequestAuditActor,
} from './context.js';

/**
 * Response for GET /v1/sessions/:id/terminal/content (#3429).
 * Returns terminal snapshot when available; graceful empty otherwise.
 */
export interface TerminalContentResponse {
  content: string;
  terminalId?: string;
  columns?: number;
  rows?: number;
  source: 'terminal_bridge' | 'unavailable';
}

const terminalInputSchema = z.object({
  terminalId: z.string().min(1),
  data: z.string().max(4096),
}).strict();

const terminalResizeSchema = z.object({
  terminalId: z.string().min(1),
  columns: z.number().int().min(1).max(512),
  rows: z.number().int().min(1).max(512),
}).strict();

const terminalIdSchema = z.object({
  terminalId: z.string().min(1),
}).strict();

export function registerTerminalRoutes(app: Parameters<typeof registerWithLegacy>[0], ctx: RouteContext): void {
  const { auth, getAuditLogger } = ctx;

  // GET /v1/sessions/:id/terminal/content
  // Issue #3429: Dashboard LiveTerminal needs terminal content. Returns
  // snapshot via ACP terminal bridge (reconnect) when a terminalId is
  // provided, otherwise a graceful empty response.
  registerWithLegacy(app, 'get', '/v1/sessions/:id/terminal/content', withSessionOwnership(ctx, async (req, reply, session) => {
    const bridge = ctx.terminalBridge;
    if (!bridge) {
      return reply.send({
        content: '',
        source: 'unavailable' as const,
      } satisfies TerminalContentResponse);
    }

    const query = req.query as { terminalId?: string } | undefined;
    const terminalId = query?.terminalId;
    if (!terminalId) {
      return reply.send({
        content: '',
        source: 'unavailable' as const,
      } satisfies TerminalContentResponse);
    }

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      const snapshot = await bridge.reconnectTerminal({ sessionId: session.id, terminalId, ...scope });
      return reply.send({
        content: snapshot.replayedOutput,
        terminalId: snapshot.terminalId,
        columns: snapshot.columns,
        rows: snapshot.rows,
        source: 'terminal_bridge' as const,
      } satisfies TerminalContentResponse);
    } catch {
      // Terminal not open or reconnect failed — graceful empty.
      return reply.send({
        content: '',
        source: 'unavailable' as const,
      } satisfies TerminalContentResponse);
    }
  }));

  // POST /v1/sessions/:id/terminal/open
  registerWithLegacy(app, 'post', '/v1/sessions/:id/terminal/open', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const bridge = ctx.terminalBridge;
    if (!bridge) return reply.status(501).send({ error: 'ACP terminal bridge is not configured' });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      const result = await bridge.openTerminal({ sessionId: session.id, ...scope });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'terminal.opened', `Terminal opened: ${session.id}`, session.id, scope.tenantId);
      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('not supported')) {
        return reply.status(501).send({ error: 'ACP terminal extension is not supported by this agent', code: 'TERMINAL_UNSUPPORTED' });
      }
      if (message.includes('not active')) {
        return reply.status(503).send({ error: 'ACP runtime is not active for this session', code: 'RUNTIME_UNAVAILABLE' });
      }
      return reply.status(500).send({ error: message });
    }
  }, 'send'));

  // POST /v1/sessions/:id/terminal/input
  registerWithLegacy(app, 'post', '/v1/sessions/:id/terminal/input', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const bridge = ctx.terminalBridge;
    if (!bridge) return reply.status(501).send({ error: 'ACP terminal bridge is not configured' });

    const parsed = terminalInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      await bridge.sendInput({ sessionId: session.id, terminalId: parsed.data.terminalId, data: parsed.data.data, ...scope });
      return { ok: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ error: message });
    }
  }, 'send'));

  // POST /v1/sessions/:id/terminal/resize
  registerWithLegacy(app, 'post', '/v1/sessions/:id/terminal/resize', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const bridge = ctx.terminalBridge;
    if (!bridge) return reply.status(501).send({ error: 'ACP terminal bridge is not configured' });

    const parsed = terminalResizeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      await bridge.resizeTerminal({ sessionId: session.id, terminalId: parsed.data.terminalId, columns: parsed.data.columns, rows: parsed.data.rows, ...scope });
      return { ok: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ error: message });
    }
  }, 'send'));

  // POST /v1/sessions/:id/terminal/reconnect
  registerWithLegacy(app, 'post', '/v1/sessions/:id/terminal/reconnect', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const bridge = ctx.terminalBridge;
    if (!bridge) return reply.status(501).send({ error: 'ACP terminal bridge is not configured' });

    const parsed = terminalIdSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      const result = await bridge.reconnectTerminal({ sessionId: session.id, terminalId: parsed.data.terminalId, ...scope });
      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ error: message });
    }
  }, 'send'));

  // POST /v1/sessions/:id/terminal/close
  registerWithLegacy(app, 'post', '/v1/sessions/:id/terminal/close', withSessionOwnership(ctx, async (req, reply, session) => {
    if (!requirePermission(auth, req, reply, 'send')) return;
    const bridge = ctx.terminalBridge;
    if (!bridge) return reply.status(501).send({ error: 'ACP terminal bridge is not configured' });

    const parsed = terminalIdSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });

    const scope = { tenantId: req.tenantId ?? session.tenantId ?? 'default', ownerKeyId: req.authKeyId ?? session.ownerKeyId ?? 'master' };
    try {
      await bridge.closeTerminal({ sessionId: session.id, terminalId: parsed.data.terminalId, ...scope });
      const audit = getAuditLogger();
      if (audit) void audit.log(resolveRequestAuditActor(auth, req, 'api-key'), 'terminal.closed', `Terminal closed: ${session.id}`, session.id, scope.tenantId);
      return { ok: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ error: message });
    }
  }, 'send'));
}
