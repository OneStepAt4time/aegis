/**
 * sse-bridge.ts — SSE endpoint that bridges EventBus events to browser clients.
 *
 * Provides a /v1/sse endpoint on the Fastify server that pushes real-time events
 * to connected clients via Server-Sent Events protocol.
 *
 * Security (#4393):
 * - Route is covered by auth middleware (SSE token, Bearer, dashboard cookie)
 * - Tenant-scoped: events filtered via isGlobalEventVisibleToRequest()
 * - Connection-limited: reuses SSEConnectionLimiter from server context
 * - Wired to real SessionEventBus (not an isolated LocalEventBus)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { GlobalSSEEvent } from '../events.js';
import type { RouteContext } from '../routes/context.js';
import { isGlobalEventVisibleToRequest } from '../routes/events.js';
import { StructuredLogger } from '../logger.js';
import { SYSTEM_TENANT } from '../config.js';

const log = new StructuredLogger();

export function registerSSEBridge(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, eventBus, sseLimiter } = ctx;

  app.get('/v1/sse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Connection limiting
    const clientIp = request.ip;
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

    const connectionId = acquireResult.connectionId;

    // Determine tenant scope from authenticated request
    const scopedAuthContext = request.authKeyId != null
      || request.authRole != null
      || request.tenantId != null;
    const requestTenantId = request.tenantId;

    const eventIsVisible = (event: GlobalSSEEvent): boolean =>
      isGlobalEventVisibleToRequest(event, sessions, requestTenantId, scopedAuthContext);

    // Set up SSE response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('\n');

    let unsubscribe: (() => void) | undefined;

    // Subscribe to global events with tenant filtering
    const handler = (event: GlobalSSEEvent): void => {
      if (!eventIsVisible(event)) return;
      try {
        const id = event.id != null ? `id: ${event.id}\n` : '';
        reply.raw.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      } catch (err) {
        log.warn({ component: 'sse-bridge', operation: 'send', attributes: { error: String(err) } });
      }
    };

    try {
      unsubscribe = eventBus.subscribeGlobal(handler);
    } catch (err) {
      log.error({ component: 'sse-bridge', operation: 'subscribe', attributes: { error: String(err) } });
      sseLimiter.release(connectionId);
      return reply.status(500).send({ error: 'Failed to create SSE subscription' });
    }

    // Send connected event
    reply.raw.write(`data: ${JSON.stringify({
      event: 'connected',
      timestamp: new Date().toISOString(),
    })}\n\n`);

    // Heartbeat to keep connection alive
    const hb = setInterval(() => {
      try { reply.raw.write(': hb\n\n'); } catch (_e) { /* connection closed */ }
    }, 30000);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      clearInterval(hb);
      unsubscribe?.();
      sseLimiter.release(connectionId);
    });

    await reply;
  });
}

export default registerSSEBridge;
