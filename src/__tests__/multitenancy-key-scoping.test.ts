/**
 * Issue #2267 (F1/F4): Tenant-scoping for key management endpoints.
 *
 * Tests that admin keys scoped to a specific tenant cannot access or modify
 * keys belonging to other tenants. SYSTEM_TENANT callers see everything.
 */

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAuthRoutes } from '../routes/auth.js';
import type { RouteContext } from '../routes/context.js';
import type { ApiKey } from '../services/auth/types.js';
import { SYSTEM_TENANT } from '../config.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: overrides.id ?? 'key-1',
    name: overrides.name ?? 'test-key',
    hash: overrides.hash ?? '$2a$10$fakehash',
    role: overrides.role ?? 'admin',
    permissions: overrides.permissions ?? [],
    createdAt: overrides.createdAt ?? Date.now(),
    lastUsedAt: overrides.lastUsedAt ?? Date.now(),
    rateLimit: overrides.rateLimit ?? 100,
    expiresAt: overrides.expiresAt ?? null,
    tenantId: overrides.tenantId,
    quotas: overrides.quotas,
  };
}

function makeRouteContext(keys: ApiKey[] = []): RouteContext {
  const keyStore = [...keys];

  return {
    auth: {
      authEnabled: true,
      getRole: vi.fn((keyId: string | null | undefined) => {
        if (keyId === 'master' || keyId === null || keyId === undefined) return 'admin';
        return 'admin';
      }),
      hasPermission: vi.fn(() => true),
      listKeys: vi.fn(() => keyStore.map(({ hash: _, permissions, ...rest }) => ({ ...rest, permissions: [...permissions] }))),
      getKey: vi.fn((id: string) => keyStore.find(k => k.id === id) ?? null),
      revokeKey: vi.fn(async (id: string) => {
        const idx = keyStore.findIndex(k => k.id === id);
        if (idx === -1) return false;
        keyStore.splice(idx, 1);
        return true;
      }),
      rotateKey: vi.fn(async (id: string) => {
        const key = keyStore.find(k => k.id === id);
        if (!key) return null;
        return { id: key.id, key: 'new-rotated-key', name: key.name, role: key.role };
      }),
      rotateKeyWithGrace: vi.fn(async (id: string) => {
        const key = keyStore.find(k => k.id === id);
        if (!key) return null;
        return { id: key.id, key: 'new-grace-key', graceKey: 'old-grace-key', name: key.name, role: key.role };
      }),
      setQuotas: vi.fn(async (id: string, q: any) => {
        const key = keyStore.find(k => k.id === id);
        if (!key) return null;
        key.quotas = q;
        const { hash: _, ...rest } = key;
        return { ...rest, permissions: [...key.permissions] };
      }),
    } as any,
    quotas: {
      getUsage: vi.fn(() => ({ currentConcurrent: 0, maxConcurrent: 10 })),
    } as any,
    sessions: {
      listSessions: vi.fn(() => []),
    } as any,
    config: {
      keyRotationGraceSeconds: 3600,
    } as any,
  } as unknown as RouteContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Key management tenant scoping (#2267 F1/F4)', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify({ logger: false });
    app.decorateRequest('authKeyId', null as unknown as string);
    app.decorateRequest('matchedPermission', null as unknown as string);
    app.decorateRequest('tenantId', undefined as unknown as string);

    app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (token) {
        req.authKeyId = token;
        // Simulate tenant resolution from auth middleware
        if (token === 'system-admin') req.tenantId = SYSTEM_TENANT;
        else if (token === 'acme-admin') req.tenantId = 'acme';
        else if (token === 'globex-admin') req.tenantId = 'globex';
      }
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // ── F4: GET /v1/auth/keys (listKeys) ─────────────────────────────

  describe('F4: listKeys', () => {
    it('tenant admin only sees keys matching its tenant', async () => {
      const keys = [
        makeKey({ id: 'k-1', tenantId: 'acme' }),
        makeKey({ id: 'k-2', tenantId: 'globex' }),
        makeKey({ id: 'k-3' }), // no tenantId (legacy)
      ];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/keys',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.map((k: any) => k.id);
      expect(ids).toContain('k-1');
      expect(ids).not.toContain('k-2');
      expect(ids).not.toContain('k-3');
    });

    it('SYSTEM_TENANT admin sees all keys', async () => {
      const keys = [
        makeKey({ id: 'k-1', tenantId: 'acme' }),
        makeKey({ id: 'k-2', tenantId: 'globex' }),
        makeKey({ id: 'k-3' }), // legacy
      ];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/keys',
        headers: { Authorization: 'Bearer system-admin' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(3);
    });

    it('legacy keys (no tenantId) are invisible to non-SYSTEM_TENANT callers', async () => {
      const keys = [
        makeKey({ id: 'k-1' }), // no tenantId
        makeKey({ id: 'k-2', tenantId: 'globex' }),
      ];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/keys',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(0);
    });
  });

  // ── F1: DELETE /v1/auth/keys/:id (revokeKey) ─────────────────────

  describe('F1: revokeKey', () => {
    it('tenant admin cannot revoke other tenant key (404)', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/k-1',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(404);
      // Key still exists
      expect(ctx.auth.getKey('k-1')).not.toBeNull();
    });

    it('tenant admin can revoke own tenant key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'acme' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/k-1',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('SYSTEM_TENANT admin can revoke any key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/k-1',
        headers: { Authorization: 'Bearer system-admin' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('non-existent key returns 404', async () => {
      const ctx = makeRouteContext([]);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/nonexistent',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('legacy key (no tenantId) is only accessible to SYSTEM_TENANT', async () => {
      const keys = [makeKey({ id: 'k-1' })]; // no tenantId
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      // Regular tenant gets 404
      const res1 = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/k-1',
        headers: { Authorization: 'Bearer acme-admin' },
      });
      expect(res1.statusCode).toBe(404);

      // SYSTEM_TENANT gets 200
      const res2 = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/k-1',
        headers: { Authorization: 'Bearer system-admin' },
      });
      expect(res2.statusCode).toBe(200);
    });
  });

  // ── F1: POST /v1/auth/keys/:id/rotate ────────────────────────────

  describe('F1: rotateKey', () => {
    it('tenant admin cannot rotate other tenant key (404)', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/keys/k-1/rotate',
        headers: { Authorization: 'Bearer acme-admin', 'Content-Type': 'application/json' },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it('tenant admin can rotate own tenant key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'acme' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/keys/k-1/rotate',
        headers: { Authorization: 'Bearer acme-admin', 'Content-Type': 'application/json' },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });

    it('SYSTEM_TENANT admin can rotate any key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/keys/k-1/rotate',
        headers: { Authorization: 'Bearer system-admin', 'Content-Type': 'application/json' },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── F1: POST /v1/auth/keys/rotate (with grace) ───────────────────

  describe('F1: rotateKeyWithGrace', () => {
    it('tenant admin cannot rotate other tenant key with grace (404)', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/keys/rotate',
        headers: { Authorization: 'Bearer acme-admin', 'Content-Type': 'application/json' },
        payload: { keyId: 'k-1' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('tenant admin can rotate own tenant key with grace', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'acme' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/keys/rotate',
        headers: { Authorization: 'Bearer acme-admin', 'Content-Type': 'application/json' },
        payload: { keyId: 'k-1' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('SYSTEM_TENANT admin can rotate any key with grace', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/keys/rotate',
        headers: { Authorization: 'Bearer system-admin', 'Content-Type': 'application/json' },
        payload: { keyId: 'k-1' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── F1: GET /v1/auth/keys/:id/quotas ─────────────────────────────

  describe('F1: getKey quotas', () => {
    it('tenant admin cannot get quotas for other tenant key (404)', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/keys/k-1/quotas',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('tenant admin can get quotas for own tenant key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'acme', quotas: { maxConcurrentSessions: 5, maxTokensPerWindow: null, maxSpendPerWindow: null, quotaWindowMs: 3600000 } })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/keys/k-1/quotas',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      expect(res.statusCode).toBe(200);
    });

    it('SYSTEM_TENANT admin can get quotas for any key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex', quotas: { maxConcurrentSessions: 5, maxTokensPerWindow: null, maxSpendPerWindow: null, quotaWindowMs: 3600000 } })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/keys/k-1/quotas',
        headers: { Authorization: 'Bearer system-admin' },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── F1: PUT /v1/auth/keys/:id/quotas ─────────────────────────────

  describe('F1: setQuotas', () => {
    it('tenant admin cannot set quotas for other tenant key (404)', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'PUT',
        url: '/v1/auth/keys/k-1/quotas',
        headers: { Authorization: 'Bearer acme-admin', 'Content-Type': 'application/json' },
        payload: { maxConcurrentSessions: 10 },
      });

      expect(res.statusCode).toBe(404);
    });

    it('tenant admin can set quotas for own tenant key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'acme' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'PUT',
        url: '/v1/auth/keys/k-1/quotas',
        headers: { Authorization: 'Bearer acme-admin', 'Content-Type': 'application/json' },
        payload: { maxConcurrentSessions: 10 },
      });

      expect(res.statusCode).toBe(200);
    });

    it('SYSTEM_TENANT admin can set quotas for any key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res = await app.inject({
        method: 'PUT',
        url: '/v1/auth/keys/k-1/quotas',
        headers: { Authorization: 'Bearer system-admin', 'Content-Type': 'application/json' },
        payload: { maxConcurrentSessions: 10 },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── Cross-tenant 404 prevents enumeration ────────────────────────

  describe('404 prevents key-ID enumeration', () => {
    it('same status code for non-existent and wrong-tenant key', async () => {
      const keys = [makeKey({ id: 'k-1', tenantId: 'globex' })];
      const ctx = makeRouteContext(keys);
      registerAuthRoutes(app, ctx);

      const res1 = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/k-1',
        headers: { Authorization: 'Bearer acme-admin' },
      });
      const res2 = await app.inject({
        method: 'DELETE',
        url: '/v1/auth/keys/nonexistent',
        headers: { Authorization: 'Bearer acme-admin' },
      });

      // Both return 404 — attacker cannot distinguish
      expect(res1.statusCode).toBe(404);
      expect(res2.statusCode).toBe(404);
      expect(res1.json()).toEqual(res2.json());
    });
  });
});
