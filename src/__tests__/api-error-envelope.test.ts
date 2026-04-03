import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeApiErrorPayload } from '../api-error-envelope.js';

describe('API error envelope normalization (Issue #399)', () => {
  let app: ReturnType<typeof Fastify> | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('normalizes JSON error responses with code, message, details, requestId, and legacy error', async () => {
    app = Fastify({ logger: false });
    app.addHook('onSend', (req: FastifyRequest, reply: FastifyReply, payload: unknown, done: (err?: Error | null, payload?: unknown) => void) => {
      const contentType = reply.getHeader('content-type');
      const normalized = normalizeApiErrorPayload({
        payload,
        statusCode: reply.statusCode,
        requestId: req.id,
        contentType: typeof contentType === 'string' ? contentType : undefined,
      });
      done(null, normalized as any);
    });

    app.post('/v1/example', async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: [{ field: 'workDir', issue: 'Required' }],
      });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/example',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Invalid request body');
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toEqual([{ field: 'workDir', issue: 'Required' }]);
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId.length).toBeGreaterThan(0);
  });

  it('does not normalize SSE payloads', async () => {
    app = Fastify({ logger: false });
    app.addHook('onSend', (req: FastifyRequest, reply: FastifyReply, payload: unknown, done: (err?: Error | null, payload?: unknown) => void) => {
      const contentType = reply.getHeader('content-type');
      const normalized = normalizeApiErrorPayload({
        payload,
        statusCode: reply.statusCode,
        requestId: req.id,
        contentType: typeof contentType === 'string' ? contentType : undefined,
      });
      done(null, normalized as any);
    });

    app.get('/v1/sse', async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.header('content-type', 'text/event-stream');
      return reply.status(400).send('data: keep-original\n\n');
    });

    const response = await app.inject({ method: 'GET', url: '/v1/sse' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toBe('data: keep-original\n\n');
  });
});
