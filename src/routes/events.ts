/**
 * routes/events.ts — Global SSE event stream.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SSEWriter } from '../sse-writer.js';
import type { GlobalSSEEvent } from '../events.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy } from './context.js';
import type { SessionManager } from '../session.js';
import { SYSTEM_TENANT } from '../config.js';
import { filterByTenant } from '../utils/tenant-filter.js';

type SessionLookup = Pick<SessionManager, 'getSession' | 'listSessions'>;

function hasScopedAuthContext(req: FastifyRequest): boolean {
  return req.authKeyId !== null && req.authKeyId !== undefined
    || req.authRole !== null && req.authRole !== undefined
    || req.tenantId !== undefined;
}

export function isGlobalEventVisibleToRequest(
  event: GlobalSSEEvent,
  sessions: Pick<SessionManager, 'getSession'>,
  tenantId: string | undefined,
  scopedAuthContext: boolean,
): boolean {
  if (!scopedAuthContext) return true;
  if (tenantId === SYSTEM_TENANT) return true;
  if (!tenantId) return false;
  if (!event.sessionId) return true;
  return sessions.getSession(event.sessionId)?.tenantId === tenantId;
}

function visibleActiveSessionCount(
  sessions: SessionLookup,
  tenantId: string | undefined,
  scopedAuthContext: boolean,
): number {
  const allSessions = sessions.listSessions();
  if (!scopedAuthContext) return allSessions.length;
  return filterByTenant(allSessions, tenantId).length;
}

export function registerEventRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, eventBus, sseLimiter, config } = ctx;

  // Global SSE event stream — aggregates events from ALL active sessions
  registerWithLegacy(app, 'get', '/v1/events', async (req: FastifyRequest, reply: FastifyReply) => {
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

    const pendingEvents: GlobalSSEEvent[] = [];
    let subscriptionReady = false;

    const scopedAuthContext = hasScopedAuthContext(req);
    const requestTenantId = req.tenantId;
    const eventIsVisible = (event: GlobalSSEEvent): boolean =>
      isGlobalEventVisibleToRequest(event, sessions, requestTenantId, scopedAuthContext);

    const handler = (event: GlobalSSEEvent): void => {
      if (!eventIsVisible(event)) return;
      if (!subscriptionReady) { pendingEvents.push(event); return; }
      const id = event.id != null ? `id: ${event.id}\n` : '';
      writer.write(`${id}data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      unsubscribe = eventBus.subscribeGlobal(handler);
    } catch (err) {
      req.log.error({ err }, 'Global SSE subscription failed');
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

    writer.write(`data: ${JSON.stringify({
      event: 'connected',
      timestamp: new Date().toISOString(),
      data: { activeSessions: visibleActiveSessionCount(sessions, requestTenantId, scopedAuthContext) },
    })}\n\n`);

    // Issue #301: Replay missed global events if client sends Last-Event-ID
    const lastEventId = req.headers['last-event-id'];
    if (lastEventId) {
      const missed = eventBus.getGlobalEventsSince(parseInt(lastEventId as string, 10) || 0);
      for (const { id, event: globalEvent } of missed) {
        if (!eventIsVisible(globalEvent)) continue;
        writer.write(`id: ${id}\ndata: ${JSON.stringify(globalEvent)}\n\n`);
      }
    }

    sseLimiter.registerWriter(writer);

    writer.startHeartbeat(30_000, config.sseIdleMs, config.sseClientTimeoutMs, () =>
      `data: ${JSON.stringify({ event: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`
    );

    await reply;
  });
}
