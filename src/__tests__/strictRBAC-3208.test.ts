/**
 * Issue #3208: strictRBAC enforcement when auth is disabled.
 *
 * When auth is disabled (no master token, no API keys), requireRole()
 * and requirePermission() normally bypass all RBAC checks (dev mode).
 * With strictRBAC=true, unauthenticated requests to role/permission-protected
 * endpoints are rejected with 401.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requireRole, requirePermission, setRouteConfig } from '../routes/context.js';
import type { AuthManager } from '../services/auth/index.js';
import type { Config } from '../config.js';

function mockReq(authKeyId?: string | null, authRole?: string | null): FastifyRequest {
  return {
    authKeyId: authKeyId ?? null,
    authRole: authRole ?? null,
    authPermissions: null,
  } as unknown as FastifyRequest;
}

function mockReply(): FastifyReply {
  const reply = { statusCode: 200, body: null } as unknown as FastifyReply;
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

function mockAuth(enabled: boolean): AuthManager {
  return {
    authEnabled: enabled,
    getRole: vi.fn().mockReturnValue('admin'),
    getKey: vi.fn(),
  } as unknown as AuthManager;
}

describe('strictRBAC enforcement (Issue #3208)', () => {
  beforeEach(() => {
    // Reset config to default (strictRBAC=false)
    setRouteConfig({ strictRBAC: false } as Config);
  });

  describe('requireRole', () => {
    it('allows unauthenticated requests when auth disabled and strictRBAC=false (dev mode)', () => {
      const auth = mockAuth(false);
      const req = mockReq();
      const reply = mockReply();
      const result = requireRole(auth, req, reply, 'admin');
      expect(result).toBe(true);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated requests when auth disabled and strictRBAC=true', () => {
      setRouteConfig({ strictRBAC: true } as Config);
      const auth = mockAuth(false);
      const req = mockReq();
      const reply = mockReply();
      const result = requireRole(auth, req, reply, 'admin');
      expect(result).toBe(false);
      expect(reply.status).toHaveBeenCalledWith(401);
    });

    it('allows authenticated requests with correct role when strictRBAC=true', () => {
      setRouteConfig({ strictRBAC: true } as Config);
      const auth = mockAuth(false);
      const req = mockReq('key-1', 'admin');
      const reply = mockReply();
      const result = requireRole(auth, req, reply, 'admin');
      expect(result).toBe(true);
      expect(reply.status).not.toHaveBeenCalled();
    });
  });

  describe('requirePermission', () => {
    it('allows unauthenticated requests when auth disabled and strictRBAC=false (dev mode)', () => {
      const auth = mockAuth(false);
      const req = mockReq();
      const reply = mockReply();
      const result = requirePermission(auth, req, reply, 'create');
      expect(result).toBe(true);
    });

    it('rejects unauthenticated requests when auth disabled and strictRBAC=true', () => {
      setRouteConfig({ strictRBAC: true } as Config);
      const auth = mockAuth(false);
      const req = mockReq();
      const reply = mockReply();
      const result = requirePermission(auth, req, reply, 'create');
      expect(result).toBe(false);
      expect(reply.status).toHaveBeenCalledWith(401);
    });
  });
});
