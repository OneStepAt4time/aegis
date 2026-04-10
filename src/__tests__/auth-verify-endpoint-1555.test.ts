/**
 * auth-verify-endpoint-1555.test.ts — Tests for POST /v1/auth/verify behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { AuthManager } from '../auth.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';

const verifyTokenSchema = z.object({
  token: z.string().min(1),
}).strict();

const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX = 5;
const RATE_LIMIT_WINDOW = '1 minute';
const VERIFY_ROUTE_LIMIT = { max: 60, timeWindow: RATE_LIMIT_WINDOW } as const;

interface AuthFailBucket {
  timestamps: number[];
}

async function registerVerifyRoute(app: FastifyInstance, auth: AuthManager): Promise<void> {
  const authFailLimits = new Map<string, AuthFailBucket>();

  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: RATE_LIMIT_WINDOW,
    keyGenerator: (req) => req.ip ?? 'unknown',
  });

  function checkAuthFailRateLimit(ip: string): boolean {
    const now = Date.now();
    const cutoff = now - AUTH_FAIL_WINDOW_MS;
    const bucket = authFailLimits.get(ip) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter(t => t >= cutoff);
    bucket.timestamps.push(now);
    authFailLimits.set(ip, bucket);
    return bucket.timestamps.length > AUTH_FAIL_MAX;
  }

  function recordAuthFailure(ip: string): void {
    checkAuthFailRateLimit(ip);
  }

  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath === '/v1/auth/verify') return;
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }
  });

  app.post('/v1/auth/verify', { config: { rateLimit: VERIFY_ROUTE_LIMIT } }, async (req, reply) => {
    const parsed = verifyTokenSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    if (!auth.authEnabled) {
      return { valid: true, role: 'admin' };
    }

    const clientIp = req.ip ?? 'unknown';
    if (checkAuthFailRateLimit(clientIp)) {
      return reply.status(429).send({ valid: false });
    }

    const result = auth.validate(parsed.data.token);
    if (result.rateLimited) {
      return reply.status(429).send({ valid: false });
    }
    if (!result.valid) {
      recordAuthFailure(clientIp);
      return reply.status(401).send({ valid: false });
    }

    return { valid: true, role: auth.getRole(result.keyId) };
  });

  app.get('/v1/protected', async () => ({ ok: true }));
}

describe('POST /v1/auth/verify (#1555)', () => {
  let app: FastifyInstance;
  let auth: AuthManager;
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `aegis-verify-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    auth = new AuthManager(tmpFile, 'master-token');
    await auth.load();
    app = Fastify({ logger: false });
    await registerVerifyRoute(app, auth);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    try { await rm(tmpFile); } catch { /* ignore */ }
  });

  it('returns 200 and role for a valid API key', async () => {
    const created = await auth.createKey('viewer-key', 100, undefined, 'viewer');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { token: created.key },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, role: 'viewer' });
  });

  it('returns 401 for an invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { token: 'not-a-valid-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ valid: false });
  });

  it('returns 429 after repeated invalid token attempts from the same IP', async () => {
    let saw429 = false;

    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/verify',
        payload: { token: `invalid-${i}` },
      });

      if (res.statusCode === 429) {
        saw429 = true;
        break;
      }
    }

    expect(saw429).toBe(true);
  });

  it('returns 429 when token is valid but rate limited', async () => {
    const created = await auth.createKey('limited-key', 1, undefined, 'viewer');

    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { token: created.key },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { token: created.key },
    });

    expect(second.statusCode).toBe(429);
    expect(second.json()).toEqual({ valid: false });
  });

  it('returns 400 on invalid body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Invalid request body');
  });

  it('allows /v1/auth/verify without Authorization header but protects other routes', async () => {
    const created = await auth.createKey('bootstrap-key', 100, undefined, 'viewer');

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      payload: { token: created.key },
    });
    expect(verifyRes.statusCode).toBe(200);

    const protectedRes = await app.inject({
      method: 'GET',
      url: '/v1/protected',
    });
    expect(protectedRes.statusCode).toBe(401);
  });
});
