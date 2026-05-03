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
  type RouteContext,
  registerWithLegacy, withOwnership, withValidation,
} from './context.js';

export function registerSessionDataRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, auth, config, metrics, monitor, eventBus, channels, toolRegistry, sseLimiter } = ctx;

  // Per-session metrics (Issue #40)
  registerWithLegacy(app, 'get', '/v1/sessions/:id/metrics', withOwnership(sessions, async (req: FastifyRequest, reply: FastifyReply, session) => {
    const m = metrics.getSessionMetrics(session.id);
    if (!m) return reply.status(404).send({ error: 'No metrics for this session' });
    return m;
  }));

  // Issue #704: Tool usage per session
  registerWithLegacy(app, 'get', '/v1/sessions/:id/tools', withOwnership(sessions, async (_req: FastifyRequest, _reply: FastifyReply, session) => {
    if (session.jsonlPath) {
      try {
        const result = await readNewEntries(session.jsonlPath, 0);
        toolRegistry.processEntries(session.id, result.entries);
      } catch { /* JSONL not available */ }
    }
    const tools = toolRegistry.getSessionTools(session.id);
    return { sessionId: session.id, tools, totalCalls: tools.reduce((sum, t) => sum + t.count, 0) };
  }));

  // Global tool definitions
  registerWithLegacy(app, 'get', '/v1/tools', async (_req: FastifyRequest, _reply: FastifyReply) => {
    const definitions = toolRegistry.getToolDefinitions();
    const categories = [...new Set(definitions.map(t => t.category))];
    return { tools: definitions, categories, totalTools: definitions.length };
  });

  // Issue #87: Per-session latency metrics
  registerWithLegacy(app, 'get', '/v1/sessions/:id/latency', withOwnership(sessions, async (_req: FastifyRequest, _reply: FastifyReply, session) => {
    const realtimeLatency = sessions.getLatencyMetrics(session.id);
    const aggregatedLatency = metrics.getSessionLatency(session.id);
    return { sessionId: session.id, realtime: realtimeLatency, aggregated: aggregatedLatency };
  }));

  // Session summary (Issue #35)
  registerWithLegacy(app, 'get', '/v1/sessions/:id/summary', withOwnership(sessions, async (_req, reply, session) => {
    try { return await sessions.getSummary(session.id); } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Paginated transcript read
  registerWithLegacy(app, 'get', '/v1/sessions/:id/transcript', withOwnership(sessions, async (req: FastifyRequest, reply: FastifyReply, _session) => {
    try {
      const query = req.query as { page?: string; limit?: string; role?: string };
      const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10) || 50));
      const allowedRoles = new Set(['user', 'assistant', 'system']);
      const roleFilter = query.role as string | undefined;
      if (roleFilter && !allowedRoles.has(roleFilter)) {
        return reply.status(400).send({ error: `Invalid role filter: ${roleFilter}. Allowed values: user, assistant, system` });
      }
      const sessionId = (req.params as { id: string }).id;
      return await sessions.readTranscript(sessionId, page, limit, roleFilter as 'user' | 'assistant' | 'system' | undefined);
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Cursor-based transcript replay (Issue #883)
  registerWithLegacy(app, 'get', '/v1/sessions/:id/transcript/cursor', withOwnership(sessions, async (req: FastifyRequest, reply: FastifyReply, _session) => {
    try {
      const query = req.query as { before_id?: string; limit?: string; role?: string };
      const rawBeforeId = query.before_id;
      const beforeId = rawBeforeId !== undefined ? parseInt(rawBeforeId, 10) : undefined;
      if (beforeId !== undefined && (!Number.isInteger(beforeId) || beforeId < 1)) {
        return reply.status(400).send({ error: 'before_id must be a positive integer' });
      }
      const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10) || 50));
      const allowedRoles = new Set(['user', 'assistant', 'system']);
      const roleFilter = query.role as string | undefined;
      if (roleFilter && !allowedRoles.has(roleFilter)) {
        return reply.status(400).send({ error: `Invalid role filter: ${roleFilter}. Allowed values: user, assistant, system` });
      }
      const sessionId = (req.params as { id: string }).id;
      return await sessions.readTranscriptCursor(
        sessionId,
        beforeId,
        limit,
        roleFilter as 'user' | 'assistant' | 'system' | undefined,
      );
    } catch (e: unknown) {
      return reply.status(404).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Screenshot capture (Issue #22)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/screenshot', withOwnership(sessions, async (req, reply, _session) => {
    const parsed = screenshotSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const { url, fullPage, width, height } = parsed.data;

    const urlError = validateScreenshotUrl(url);
    if (urlError) return reply.status(400).send({ error: urlError });

    const hostname = new URL(url).hostname;
    const dnsResult = await resolveAndCheckIp(hostname);
    if (dnsResult.error) return reply.status(400).send({ error: dnsResult.error });

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
  }));

  // Issue #740: Verification Protocol
  registerWithLegacy(app, 'post', '/v1/sessions/:id/verify', withOwnership(sessions, async (_req: FastifyRequest, reply: FastifyReply, session) => {
    const { workDir } = session;
    if (!workDir) return reply.status(400).send({ error: 'Session has no workDir' });

    const criticalOnly = (config as { verificationProtocol?: { criticalOnly?: boolean } }).verificationProtocol?.criticalOnly ?? false;
    eventBus.emitStatus(session.id, 'working', `Running verification (criticalOnly=${criticalOnly})…`);

    try {
      const result = await runVerification(workDir, criticalOnly);
      eventBus.emitVerification(session.id, result);
      const httpStatus = result.ok ? 200 : 422;
      return reply.status(httpStatus).send(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({ ok: false, summary: `Verification error: ${msg}` });
    }
  }));

  // Per-session SSE event stream (Issue #32)
  // Issue #2461: Extracted to variable so /stream alias reuses the same handler.
  const sessionEventsHandler = withOwnership(sessions, async (req: FastifyRequest, reply: FastifyReply, session) => {

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
      unsubscribe = eventBus.subscribe(session.id, handler);
    } catch (err) {
      req.log.error({ err, sessionId: session.id }, 'SSE subscription failed');
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
      sseLimiter.unregisterWriter(writer);
    });

    subscriptionReady = true;
    for (const event of pendingEvents) {
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    }

    writer.write(`data: ${JSON.stringify({ event: 'connected', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`);

    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      const missed = eventBus.getEventsSince(session.id, parseInt(lastEventId as string, 10) || 0);
      for (const event of missed) {
        const id = event.id != null ? `id: ${event.id}\n` : '';
        writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      }
    }

    writer.startHeartbeat(30_000, config.sseIdleMs, config.sseClientTimeoutMs, () =>
      `data: ${JSON.stringify({ event: 'heartbeat', sessionId: session.id, timestamp: new Date().toISOString() })}\n\n`
    );

    await reply;
  });

  registerWithLegacy(app, 'get', '/v1/sessions/:id/events', sessionEventsHandler);

  // Issue #2461: /stream alias for /events SSE
  registerWithLegacy(app, 'get', '/v1/sessions/:id/stream', sessionEventsHandler);

  // ── Claude Code Hook Endpoints (Issue #161) ─────────────────────
  // Permission hook — validates body with withValidation, looks up session manually
  // (Claude Code calls this directly, not through API user auth)
  registerWithLegacy(app, 'post', '/v1/sessions/:id/hooks/permission', withValidation(permissionHookSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    const sessionId = (req.params as { id: string }).id;
    const session = sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const { tool_name, tool_input, permission_mode } = data;

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
  }));

  // POST /v1/sessions/:id/hooks/stop — Stop hook from CC
  registerWithLegacy(app, 'post', '/v1/sessions/:id/hooks/stop', withValidation(stopHookSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    const sessionId = (req.params as { id: string }).id;
    const session = sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });

    const { stop_reason } = data;

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
  }));
}
