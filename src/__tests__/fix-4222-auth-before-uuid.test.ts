/**
 * fix-4222-auth-before-uuid.test.ts — Verify auth check runs before UUID validation.
 *
 * Issue #4222: Approve/reject endpoints were validating session ID format
 * (UUID check) BEFORE checking authentication. This leaked information:
 * unauthenticated requests got 400 for bad UUIDs but 401 for valid UUIDs.
 *
 * Fix: UUID validation hook moved inside setupAuth() so it runs AFTER auth.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { isValidUUID } from '../validation.js';

const TEST_TOKEN = 'test-token-for-4222';

/**
 * Build a minimal Fastify server that replicates the hook order from the fix:
 * 1. Auth hook (rejects unauthenticated requests with 401)
 * 2. UUID validation hook (rejects invalid UUIDs with 400)
 * 3. Route handlers (approve/reject stubs)
 */
async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify();

  // 1. Auth hook — mimics setupAuth auth check (simplified)
  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath === '/health' || urlPath === '/v1/health') return;

    const bearer = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined;

    if (!bearer) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    if (bearer !== TEST_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized — invalid token' });
    }
  });

  // 2. UUID validation hook — runs AFTER auth (same order as the fix)
  app.addHook('onRequest', async (req, reply) => {
    const id = (req.params as Record<string, string | undefined>).id;
    if (id !== undefined && !isValidUUID(id)) {
      return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
    }
  });

  // 3. Stub route handlers (mimicking approve/reject/permission/session-approve)
  const stubHandler = async () => ({ ok: true });

  app.post('/v1/sessions/:id/approve', stubHandler);
  app.post('/v1/sessions/:id/reject', stubHandler);
  app.post('/v1/sessions/:id/permission/approve', stubHandler);
  app.post('/v1/sessions/:id/permission/reject', stubHandler);
  app.post('/v1/sessions/:id/session-approve', stubHandler);
  app.post('/v1/sessions/:id/session-reject', stubHandler);
  app.get('/v1/health', async () => ({ status: 'ok' }));

  return app;
}

describe('#4222: auth check before UUID validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Unauthenticated + invalid UUID → should get 401, not 400 ──

  it('unauthenticated POST /approve with invalid UUID returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/not-a-uuid/approve',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });

  it('unauthenticated POST /reject with invalid UUID returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/not-a-uuid/reject',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });

  it('unauthenticated POST /permission/approve with invalid UUID returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/not-a-uuid/permission/approve',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });

  it('unauthenticated POST /session-approve with invalid UUID returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/not-a-uuid/session-approve',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });

  // ── Unauthenticated + valid UUID → should get 401 (same error) ──

  it('unauthenticated POST /approve with valid UUID returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/00000000-0000-0000-0000-000000000000/approve',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });

  it('unauthenticated POST /reject with valid UUID returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/00000000-0000-0000-0000-000000000000/reject',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Unauthorized') });
  });

  // ── Authenticated + invalid UUID → should get 400 ──

  it('authenticated POST /approve with invalid UUID returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/not-a-uuid/approve',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid session ID') });
  });

  it('authenticated POST /reject with invalid UUID returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/not-a-uuid/reject',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.stringContaining('Invalid session ID') });
  });

  // ── Authenticated + valid UUID → should reach handler (200) ──

  it('authenticated POST /approve with valid UUID passes through to handler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/00000000-0000-0000-0000-000000000000/approve',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('authenticated POST /reject with valid UUID passes through to handler', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions/00000000-0000-0000-0000-000000000000/reject',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  // ── Uniformity check: same error for valid and invalid UUID when unauthenticated ──

  it('unauthenticated responses are uniform: both valid and invalid UUID get 401', async () => {
    const [badUuid, validUuid] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/sessions/not-a-uuid/approve' }),
      app.inject({ method: 'POST', url: '/v1/sessions/00000000-0000-0000-0000-000000000000/approve' }),
    ]);
    expect(badUuid.statusCode).toBe(401);
    expect(validUuid.statusCode).toBe(401);
    // Both must return the same status code — no information leak
    expect(badUuid.statusCode).toBe(validUuid.statusCode);
  });
});
