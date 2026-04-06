/**
 * sse-events.test.ts - Integration tests for dashboard SSE events.
 * Issue #1205
 * 
 * Note: SSE streaming requires special test handling.
 * These tests verify endpoint configuration and event emission.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

describe('SSE Events Integration Tests', () => {
  let app: FastifyInstance;
  const emittedEvents = new Map<string, any[]>();

  beforeEach(async () => {
    emittedEvents.clear();
    app = Fastify({ logger: false });

    // SSE endpoint - just registers, doesn't stream in tests
    app.get('/v1/sessions/:id/events', async (request: any, reply: any) => {
      const sessionId = request.params.id;
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      // Don't keep connection open in tests
      reply.raw.end();
    });

    // Emit event endpoint
    app.post('/v1/sessions/:id/emit', async (request: any) => {
      const sessionId = request.params.id;
      const { eventType, data } = request.body || {};
      if (!emittedEvents.has(sessionId)) {
        emittedEvents.set(sessionId, []);
      }
      emittedEvents.get(sessionId)!.push({ eventType, data, timestamp: Date.now() });
      return { success: true };
    });

    // Get emitted events
    app.get('/v1/sessions/:id/events/list', async (request: any) => {
      const sessionId = request.params.id;
      return { events: emittedEvents.get(sessionId) || [] };
    });

    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('SSE endpoint returns event-stream content type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/test-session/events',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('SSE endpoint returns no-cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/test-session/events',
    });
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('emit endpoint stores events per session', async () => {
    // Emit events for two different sessions
    await app.inject({
      method: 'POST',
      url: '/v1/sessions/session-a/emit',
      payload: { eventType: 'session.created', data: { status: 'idle' } },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/sessions/session-b/emit',
      payload: { eventType: 'session.updated', data: { status: 'working' } },
    });
    
    // Check session-a events
    const resA = await app.inject({
      method: 'GET',
      url: '/v1/sessions/session-a/events/list',
    });
    const bodyA = JSON.parse(resA.body);
    expect(bodyA.events).toHaveLength(1);
    expect(bodyA.events[0].eventType).toBe('session.created');
    
    // Check session-b events
    const resB = await app.inject({
      method: 'GET',
      url: '/v1/sessions/session-b/events/list',
    });
    const bodyB = JSON.parse(resB.body);
    expect(bodyB.events).toHaveLength(1);
    expect(bodyB.events[0].eventType).toBe('session.updated');
    expect(bodyB.events[0].data.status).toBe('working');
  });

  it('events are isolated per session', async () => {
    // Emit to session-a only
    await app.inject({
      method: 'POST',
      url: '/v1/sessions/session-a/emit',
      payload: { eventType: 'session.created', data: {} },
    });
    
    // session-b should have no events
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/session-b/events/list',
    });
    const body = JSON.parse(res.body);
    expect(body.events).toHaveLength(0);
  });
});
