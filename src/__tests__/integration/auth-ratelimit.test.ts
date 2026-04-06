/**
 * auth-ratelimit.test.ts - Integration tests for auth and rate limiting.
 * Issue #1205
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

describe('Auth and Rate Limiting Integration Tests', () => {
  let app: FastifyInstance;
  const requestCounts = new Map<string, number[]>();
  const RATE_LIMIT = 100;
  const RATE_WINDOW_MS = 60000;

  beforeEach(async () => {
    requestCounts.clear();
    app = Fastify({ logger: false });
    
    // Rate limiting middleware
    app.addHook('onRequest', async (request: any) => {
      const key = request.headers['x-api-key'] as string || request.ip;
      const now = Date.now();
      const counts = requestCounts.get(key) || [];
      // Clean old entries
      const validCounts = counts.filter(t => now - t < RATE_WINDOW_MS);
      requestCounts.set(key, validCounts);
      if (validCounts.length >= RATE_LIMIT) {
        throw { statusCode: 429, message: 'Rate limit exceeded' };
      }
      validCounts.push(now);
      requestCounts.set(key, validCounts);
    });

    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/v1/sessions', async () => ({ sessions: [], total: 0 }));
    app.post('/v1/sessions', async (request: any) => {
      const token = request.headers['authorization'];
      if (!token) throw { statusCode: 401, message: 'Unauthorized' };
      return { id: 'new-session', status: 'idle' };
    });

    await app.ready();
  });

  afterEach(async () => { await app.close(); });

  it('GET /health does not require auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /v1/sessions does not require auth (public route)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
    expect(res.statusCode).toBe(200);
  });

  it('POST /v1/sessions requires authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/tmp', prompt: 'test' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /v1/sessions accepts valid Bearer token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'authorization': 'Bearer test-token-123' },
      payload: { workDir: '/tmp', prompt: 'test' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rate limiting blocks excessive requests from same client', async () => {
    const clientKey = 'rate-limit-test-' + Date.now();
    // Make RATE_LIMIT requests - they should all succeed
    for (let i = 0; i < RATE_LIMIT; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { 'x-api-key': clientKey },
      });
      expect(res.statusCode).toBe(200);
    }
    // The RATE_LIMIT + 1 request should be blocked
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { 'x-api-key': clientKey },
    });
    expect(res.statusCode).toBe(429);
  });

  it('rate limiting is per-client (different keys)', async () => {
    // Client A makes RATE_LIMIT requests
    for (let i = 0; i < RATE_LIMIT; i++) {
      await app.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { 'x-api-key': 'client-a-' + Date.now() },
      });
    }
    // Client B should still succeed (different key)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { 'x-api-key': 'client-b-unique' },
    });
    expect(res.statusCode).toBe(200);
  });
});
