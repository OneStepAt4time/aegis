/**
 * Issue #1910 — Session ownership authorization on action routes.
 *
 * Tests requireSessionOwnership() helper: admin bypass, owner allowed,
 * non-owner denied (403 + SESSION_FORBIDDEN), config flag bypass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionInfo } from '../session.js';
import type { RouteContext } from '../routes/context.js';
import type { AuditLogger } from '../audit.js';
import { requireSessionOwnership } from '../routes/context.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 's-1',
    windowId: '@1',
    windowName: 'cc-test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

function makeReply() {
  const body: { status?: number; payload?: unknown } = {};
  const send = vi.fn((payload: unknown) => { body.payload = payload; return payload; });
  const status = vi.fn((code: number) => {
    body.status = code;
    return { send };
  });
  return { send, status, body };
}

function makeCtx(overrides: Partial<RouteContext> = {}): RouteContext {
  const auditLog = vi.fn();
  const auditLogger = { log: auditLog } as unknown as AuditLogger;
  return {
    sessions: {
      getSession: vi.fn(() => makeSession({ ownerKeyId: 'key-alice' })),
    } as unknown as RouteContext['sessions'],
    auth: {
      getRole: vi.fn((keyId: string | null | undefined) => {
        if (keyId === 'key-admin') return 'admin';
        if (keyId === 'key-alice' || keyId === 'key-bob') return 'operator';
        return 'viewer';
      }),
    } as unknown as RouteContext['auth'],
    config: { enforceSessionOwnership: true } as RouteContext['config'],
    getAuditLogger: vi.fn(() => auditLogger),
    ...overrides,
  } as RouteContext;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Issue #1910 — requireSessionOwnership()', () => {
  it('allows the session owner', () => {
    const ctx = makeCtx();
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-alice' } as any, reply as any);

    expect(session).toBeTruthy();
    expect(session!.id).toBe('s-1');
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('denies non-owner with 403 SESSION_FORBIDDEN', () => {
    const ctx = makeCtx();
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-bob' } as any, reply as any);

    expect(session).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'SESSION_FORBIDDEN',
      message: 'You do not own this session',
    });
  });

  it('emits session.action.denied audit for non-owner', () => {
    const ctx = makeCtx();
    const auditLog = vi.fn();
    ctx.getAuditLogger = vi.fn(() => ({ log: auditLog } as unknown as AuditLogger));
    const reply = makeReply();

    requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-bob' } as any, reply as any);

    expect(auditLog).toHaveBeenCalledWith(
      'key-bob',
      'session.action.denied',
      expect.stringContaining('Non-owner action denied on session s-1'),
      's-1',
    );
  });

  it('allows admin bypass for non-owner', () => {
    const ctx = makeCtx();
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-admin' } as any, reply as any);

    expect(session).toBeTruthy();
    expect(session!.id).toBe('s-1');
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('emits session.action.allowed audit for admin bypass', () => {
    const ctx = makeCtx();
    const auditLog = vi.fn();
    ctx.getAuditLogger = vi.fn(() => ({ log: auditLog } as unknown as AuditLogger));
    const reply = makeReply();

    requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-admin' } as any, reply as any);

    expect(auditLog).toHaveBeenCalledWith(
      'key-admin',
      'session.action.allowed',
      expect.stringContaining('Admin bypass for action on session s-1'),
      's-1',
    );
  });

  it('emits session.action.allowed audit for owner', () => {
    const ctx = makeCtx();
    const auditLog = vi.fn();
    ctx.getAuditLogger = vi.fn(() => ({ log: auditLog } as unknown as AuditLogger));
    const reply = makeReply();

    requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-alice' } as any, reply as any);

    expect(auditLog).toHaveBeenCalledWith(
      'key-alice',
      'session.action.allowed',
      expect.stringContaining('Owner action on session s-1'),
      's-1',
    );
  });

  it('returns 404 when session not found', () => {
    const ctx = makeCtx({
      sessions: { getSession: vi.fn(() => null) } as unknown as RouteContext['sessions'],
    });
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 'missing', { authKeyId: 'key-alice' } as any, reply as any);

    expect(session).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('master token bypasses ownership', () => {
    const ctx = makeCtx();
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'master' } as any, reply as any);

    expect(session).toBeTruthy();
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('null authKeyId (no auth) bypasses ownership', () => {
    const ctx = makeCtx();
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: null } as any, reply as any);

    expect(session).toBeTruthy();
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('legacy session without ownerKeyId allows any key', () => {
    const ctx = makeCtx({
      sessions: { getSession: vi.fn(() => makeSession({ ownerKeyId: undefined })) } as unknown as RouteContext['sessions'],
    });
    const reply = makeReply();
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-random' } as any, reply as any);

    expect(session).toBeTruthy();
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('AEGIS_ENFORCE_SESSION_OWNERSHIP=false falls through to basic ownership', () => {
    const ctx = makeCtx();
    ctx.config = { ...ctx.config, enforceSessionOwnership: false };
    const reply = makeReply();

    // Non-owner on an owned session should still get 403 via the basic ownership check
    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-bob' } as any, reply as any);

    expect(session).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it('AEGIS_ENFORCE_SESSION_OWNERSHIP=false allows owner', () => {
    const ctx = makeCtx();
    ctx.config = { ...ctx.config, enforceSessionOwnership: false };
    const reply = makeReply();

    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'key-alice' } as any, reply as any);

    expect(session).toBeTruthy();
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('AEGIS_ENFORCE_SESSION_OWNERSHIP=false allows master token for non-owner', () => {
    const ctx = makeCtx();
    ctx.config = { ...ctx.config, enforceSessionOwnership: false };
    const reply = makeReply();

    const session = requireSessionOwnership(ctx, 's-1', { authKeyId: 'master' } as any, reply as any);

    expect(session).toBeTruthy();
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });
});
