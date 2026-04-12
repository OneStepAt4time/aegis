/**
 * routes/session-data.ts — Session data endpoints: transcript, summary,
 * screenshot, verify, per-session metrics, tools, latency, per-session SSE,
 * and Claude Code hook endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { screenshotSchema, permissionHookSchema, stopHookSchema } from '../validation.js';
import { captureScreenshot, isPlaywrightAvailable } from '../screenshot.js';
import { validateScreenshotUrl, resolveAndCheckIp, buildHostResolverRule } from '../ssrf.js';
import { runVerification } from '../verification.js';
import { readNewEntries } from '../transcript.js';
import { SSEWriter } from '../sse-writer.js';
import type { SessionSSEEvent } from '../events.js';
import {
  type RouteContext, type IdParams, type IdRequest,
  requireOwnership, makePayload,
} from './context.js';

export function registerSessionDataRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, auth, config, metrics, monitor, eventBus, channels, toolRegistry, sseLimiter } = ctx;

  // Per-session metrics (Issue #40)
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/metrics', async (req, reply) => {
    const session = requireOwnership(sessions, req.params.id, reply, req.authKeyId);
    if (!session) return;
    const m = metrics.getSessionMetrics(req.params.id);
    if (!m) return reply.status(404).send({ error: 'No metrics for this session' });
    return m;
  });

  // Issue #704: Tool usage per session
  app.get<IdParams>('/v1/sessions/:id/tools', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;
    if (session.jsonlPath) {
      try {
        const result = await readNewEntries(session.jsonlPath, 0);
        toolRegistry.processEntries(req.params.id, result.entries);
      } catch { /* JSONL not available */ }
    }
    const tools = toolRegistry.getSessionTools(req.params.id);
    return { sessionId: req.params.id, tools, totalCalls: tools.reduce((sum, t) => sum + t.count, 0) };
  });

  // Global tool definitions
  app.get('/v1/tools', async () => {
    const definitions = toolRegistry.getToolDefinitions();
    const categories = [...new Set(definitions.map(t => t.category))];
    return { tools: definitions, categories, totalTools: definitions.length };
  });

  // Issue #87: Per-session latency metrics
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/latency', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;
    const realtimeLatency = sessions.getLatencyMetrics(req.params.id);
    const aggregatedLatency = metrics.getSessionLatency(req.params.id);
    return { sessionId: req.params.id, realtime: realtimeLatency, aggregated: aggregatedLatency };
  });

  // Session summary (Issue #35)
  async function summaryHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
    try { return await sessions.getSummary(req.params.id); } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  app.get<IdParams>('/v1/sessions/:id/summary', summaryHandler);
  app.get<IdParams>('/sessions/:id/summary', summaryHandler);

  // Paginated transcript read
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; limit?: string; role?: string };
  }>('/v1/sessions/:id/transcript', async (req, reply) => {
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
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

  // Cursor-based transcript replay (Issue #883)
  app.get<{
    Params: { id: string };
    Querystring: { before_id?: string; limit?: string; role?: string };
  }>('/v1/sessions/:id/transcript/cursor', async (req, reply) => {
    if (!requireOwnership(sessions, req.params.id, reply, req.authKeyId)) return;
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

  // Screenshot capture (Issue #22)
  async function screenshotHandler(req: IdRequest, reply: FastifyReply): Promise<unknown> {
    const parsed = screenshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { url, fullPage, width, height } = parsed.data;

    const urlError = validateScreenshotUrl(url);
    if (urlError) return reply.status(400).send({ error: urlError });

    const hostname = new URL(url).hostname;
    const dnsResult = await resolveAndCheckIp(hostname);
    if (dnsResult.error) return reply.status(400).send({ error: dnsResult.error });

    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;

    if (!isPlaywrightAvailable()) {
      return reply.status(501).send({
        error: 'Playwright is not installed',
        message: 'Install Playwright to enable screenshots: npx playwright install chromium && npm install -D playwright',
      });
    }

    try {
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

  // Issue #740: Verification Protocol
  app.post('/v1/sessions/:id/verify', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;

    const { workDir } = session;
    if (!workDir) return reply.status(400).send({ error: 'Session has no workDir' });

    const criticalOnly = (config as { verificationProtocol?: { criticalOnly?: boolean } }).verificationProtocol?.criticalOnly ?? false;
    eventBus.emitStatus(sessionId, 'working', `Running verification (criticalOnly=${criticalOnly})…`);

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

  // Per-session SSE event stream (Issue #32)
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/events', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = requireOwnership(sessions, sessionId, reply, req.authKeyId);
    if (!session) return;

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

    let unsubscribe: (() => void) | undefined;
    const connectionId = acquireResult.connectionId;
    let writer: SSEWriter;

    const pendingEvents: SessionSSEEvent[] = [];
    let subscriptionReady = false;

    try {
      const handler = (event: SessionSSEEvent): void => {
        if (!subscriptionReady) { pendingEvents.push(event); return; }
        const id = event.id != null ? `id: ${event.id}\n` : '';
        writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      };
      unsubscribe = eventBus.subscribe(req.params.id, handler);
    } catch (err) {
      req.log.error({ err, sessionId: req.params.id }, 'SSE subscription failed');
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

    subscriptionReady = true;
    for (const event of pendingEvents) {
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    }

    writer.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

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

    await reply;
  });

  // ── Claude Code Hook Endpoints (Issue #161) ─────────────────────
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

    session.status = 'permission_prompt';
    session.lastActivity = Date.now();
    await sessions.save();

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

    session.status = 'idle';
    session.lastActivity = Date.now();
    await sessions.save();

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
}
