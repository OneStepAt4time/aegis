/**
 * rate-limit.test.ts — API rate limiting test (Issue #2097).
 *
 * Verifies that @fastify/rate-limit returns 429 with Retry-After
 * and X-RateLimit-* headers when the per-IP limit is exceeded.
 */

import Fastify from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Fetch helper for real HTTP requests. */
async function get(url: string): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const res = await fetch(url);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const body = await res.json();
  return { status: res.status, headers, body };
}

describe('Rate limiting (Issue #2097)', () => {
  const app = Fastify({ logger: false });
  let baseUrl: string;

  beforeAll(async () => {
    await app.register(fastifyRateLimit, {
      global: true,
      max: 3,
      timeWindow: 60000,
      addHeadersOnExceeding: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
      },
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
        'retry-after': true,
      },
    });

    app.get('/v1/sessions', async (_req, reply) => {
      return reply.send({ sessions: [] });
    });

    await app.ready();
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = addr;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 with rate-limit headers when limit exceeded', async () => {
    // Exhaust the 3-request limit
    for (let i = 0; i < 3; i++) {
      const res = await get(`${baseUrl}/v1/sessions`);
      expect(res.status).toBe(200);
      // Rate-limit headers present on successful responses
      expect(res.headers['x-ratelimit-limit']).toBe('3');
    }

    // 4th request should be rate limited
    const res = await get(`${baseUrl}/v1/sessions`);
    expect(res.status).toBe(429);

    const body = res.body as { statusCode: number; error: string; message: string };
    expect(body.statusCode).toBe(429);
    expect(body.error).toBe('Too Many Requests');

    // X-RateLimit headers and Retry-After present on 429 response
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['retry-after']).toBeDefined();
  });
});
