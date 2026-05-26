/**
 * Issue #4257 — Auth hook behaviour: 401 for unauthenticated requests,
 * 401 for invalid tokens, 200 for valid keys, public-path bypass.
 *
 * Builds a minimal Fastify app that replicates the core onRequest auth
 * hook from server.ts setupAuth() using the real AuthManager, then drives
 * it via app.inject() — no network bind needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { AuthManager } from '../services/auth/AuthManager.js';

/**
 * Minimal Fastify app that replicates the core auth flow from
 * server.ts setupAuth(). Uses the real AuthManager for token validation.
 */
async function buildAuthApp(auth: AuthManager): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // CORS preflight — browsers send OPTIONS without auth headers
    if (req.method === 'OPTIONS') return;

    const urlPath = req.url?.split('?')[0] ?? '';

    // Public paths — no auth required
    if (
      urlPath === '/health' ||
      urlPath === '/v1/health' ||
      urlPath === '/v1/version'
    ) return;

    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    const result = auth.validate(token);
    if (!result.valid) {
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }
  });

  app.get('/v1/health', async () => ({ status: 'ok' }));
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/v1/sessions', async () => ({ sessions: [] }));
  app.post('/v1/sessions', async (_req, reply) =>
    reply.status(201).send({ id: 'new-session' }),
  );

  await app.ready();
  return app;
}

describe('Auth hook — protected routes', () => {
  let tmpFile: string;
  let auth: AuthManager;
  let app: FastifyInstance;

  beforeEach(async () => {
    tmpFile = join(
      tmpdir(),
      `aegis-auth-hook-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    // Non-empty master token ensures auth is enabled so invalid tokens are rejected
    auth = new AuthManager(tmpFile, 'test-master-secret');
    app = await buildAuthApp(auth);
  });

  afterEach(async () => {
    await app.close();
    try { await rm(tmpFile, { force: true }); } catch { /* ignore */ }
  });

  it('returns 401 when Authorization header is absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
    expect(res.statusCode).toBe(401);
    expect((JSON.parse(res.body) as { error: string }).error).toMatch(
      /Bearer token required/,
    );
  });

  it('returns 401 when an invalid Bearer token is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${'aegis_'}deadbeef` },
    });
    expect(res.statusCode).toBe(401);
    expect((JSON.parse(res.body) as { error: string }).error).toMatch(
      /invalid API key/,
    );
  });

  it('returns 200 when a valid API key is provided', async () => {
    const { key } = await auth.createKey('ci-key', 100, undefined, 'admin');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 after the key is revoked', async () => {
    const { key, id } = await auth.createKey('revoke-me', 100, undefined, 'admin');

    const before = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(before.statusCode).toBe(200);

    await auth.revokeKey(id);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('returns 401 for POST to protected route without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/tmp' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Auth hook — public paths bypass auth', () => {
  let tmpFile: string;
  let auth: AuthManager;
  let app: FastifyInstance;

  beforeEach(async () => {
    tmpFile = join(
      tmpdir(),
      `aegis-public-path-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    auth = new AuthManager(tmpFile, 'test-master-secret');
    app = await buildAuthApp(auth);
  });

  afterEach(async () => {
    await app.close();
    try { await rm(tmpFile, { force: true }); } catch { /* ignore */ }
  });

  it('GET /v1/health returns 200 without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
  });

  it('GET /health (legacy path) returns 200 without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('OPTIONS preflight requests bypass auth', async () => {
    const res = await app.inject({ method: 'OPTIONS', url: '/v1/sessions' });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('Auth hook — master token', () => {
  it('accepts the configured master token as a valid Bearer credential', async () => {
    const tmpFile = join(tmpdir(), `aegis-master-${Date.now()}.json`);
    const masterToken = 'super-secret-master-token-abc123';
    const authWithMaster = new AuthManager(tmpFile, masterToken);
    const masterApp = await buildAuthApp(authWithMaster);
    try {
      const res = await masterApp.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: `Bearer ${masterToken}` },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await masterApp.close();
      try { await rm(tmpFile, { force: true }); } catch { /* ignore */ }
    }
  });

  it('rejects a wrong master token with 401', async () => {
    const tmpFile = join(tmpdir(), `aegis-master-wrong-${Date.now()}.json`);
    const authWithMaster = new AuthManager(tmpFile, 'correct-master-token');
    const masterApp = await buildAuthApp(authWithMaster);
    try {
      const res = await masterApp.inject({
        method: 'GET',
        url: '/v1/sessions',
        headers: { authorization: 'Bearer wrong-master-token' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await masterApp.close();
      try { await rm(tmpFile, { force: true }); } catch { /* ignore */ }
    }
  });
});
