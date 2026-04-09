import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerPermissionRoutes } from '../permission-routes.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionInfo } from '../session.js';

// ── Helpers ──────────────────────────────────────────────────────────

type RouteHandler = (req: { params: { id: string }; authKeyId?: string | null }, reply: any) => Promise<unknown>;

function makeMockApp(): FastifyInstance {
  return { post: vi.fn() } as unknown as FastifyInstance;
}

function makeReply() {
  const send = vi.fn((payload: unknown) => payload);
  const status = vi.fn(() => ({ send }));
  return { send, status };
}

function getHandler(app: FastifyInstance, path: string): RouteHandler {
  const post = app.post as ReturnType<typeof vi.fn>;
  const call = post.mock.calls.find((args: unknown[]) => args[0] === path);
  if (!call) throw new Error(`Missing route registration for ${path}`);
  return call[1] as RouteHandler;
}

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

// ── Tests ────────────────────────────────────────────────────────────

describe('Session ownership (#1429) — permission routes', () => {
  let app: FastifyInstance;
  let sessions: {
    approve: ReturnType<typeof vi.fn>;
    reject: ReturnType<typeof vi.fn>;
    getLatencyMetrics: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
  };
  let metrics: { recordPermissionResponse: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    app = makeMockApp();
    sessions = {
      approve: vi.fn(async () => {}),
      reject: vi.fn(async () => {}),
      getLatencyMetrics: vi.fn(() => ({ permission_response_ms: null })),
      getSession: vi.fn(() => makeSession({ ownerKeyId: 'key-alice' })),
    };
    metrics = { recordPermissionResponse: vi.fn() };
  });

  it('owner can approve own session', async () => {
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    const result = await handler({ params: { id: 's-1' }, authKeyId: 'key-alice' }, reply);

    expect(result).toEqual({ ok: true });
    expect(sessions.approve).toHaveBeenCalledWith('s-1');
    expect(reply.status).not.toHaveBeenCalledWith(403);
  });

  it('non-owner gets 403 on approve', async () => {
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    await handler({ params: { id: 's-1' }, authKeyId: 'key-bob' }, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(sessions.approve).not.toHaveBeenCalled();
  });

  it('non-owner gets 403 on reject', async () => {
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/reject');
    const reply = makeReply();
    await handler({ params: { id: 's-1' }, authKeyId: 'key-bob' }, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(sessions.reject).not.toHaveBeenCalled();
  });

  it('master key bypasses ownership on approve', async () => {
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    const result = await handler({ params: { id: 's-1' }, authKeyId: 'master' }, reply);

    expect(result).toEqual({ ok: true });
    expect(sessions.approve).toHaveBeenCalledWith('s-1');
  });

  it('null keyId (no auth) bypasses ownership', async () => {
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    const result = await handler({ params: { id: 's-1' }, authKeyId: null }, reply);

    expect(result).toEqual({ ok: true });
    expect(sessions.approve).toHaveBeenCalledWith('s-1');
  });

  it('session without ownerKeyId (legacy) allows all access', async () => {
    sessions.getSession.mockReturnValue(makeSession({ ownerKeyId: undefined }));
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    const result = await handler({ params: { id: 's-1' }, authKeyId: 'key-bob' }, reply);

    expect(result).toEqual({ ok: true });
    expect(sessions.approve).toHaveBeenCalledWith('s-1');
  });

  it('returns 404 when session not found', async () => {
    sessions.getSession.mockReturnValue(null);
    registerPermissionRoutes(app, sessions as any, metrics as any);
    const handler = getHandler(app, '/v1/sessions/:id/approve');
    const reply = makeReply();
    await handler({ params: { id: 'missing' }, authKeyId: 'key-alice' }, reply);

    expect(reply.status).toHaveBeenCalledWith(404);
  });
});

describe('Session ownership (#1429) — requireOwnership logic', () => {
  // Test the ownership logic patterns directly
  function checkOwnership(session: SessionInfo | null, keyId: string | null | undefined): { allowed: boolean; code?: number } {
    if (!session) return { allowed: false, code: 404 };
    if (keyId === 'master' || keyId === null || keyId === undefined) return { allowed: true };
    if (!session.ownerKeyId) return { allowed: true };
    if (session.ownerKeyId !== keyId) return { allowed: false, code: 403 };
    return { allowed: true };
  }

  it('allows owner key', () => {
    const s = makeSession({ ownerKeyId: 'key-a' });
    expect(checkOwnership(s, 'key-a').allowed).toBe(true);
  });

  it('rejects non-owner key', () => {
    const s = makeSession({ ownerKeyId: 'key-a' });
    expect(checkOwnership(s, 'key-b')).toEqual({ allowed: false, code: 403 });
  });

  it('allows master key', () => {
    const s = makeSession({ ownerKeyId: 'key-a' });
    expect(checkOwnership(s, 'master').allowed).toBe(true);
  });

  it('allows when keyId is null (no auth)', () => {
    const s = makeSession({ ownerKeyId: 'key-a' });
    expect(checkOwnership(s, null).allowed).toBe(true);
  });

  it('allows when keyId is undefined', () => {
    const s = makeSession({ ownerKeyId: 'key-a' });
    expect(checkOwnership(s, undefined).allowed).toBe(true);
  });

  it('allows any key when session has no ownerKeyId (legacy)', () => {
    const s = makeSession({ ownerKeyId: undefined });
    expect(checkOwnership(s, 'key-random').allowed).toBe(true);
  });

  it('returns 404 when session is null', () => {
    expect(checkOwnership(null, 'key-a')).toEqual({ allowed: false, code: 404 });
  });
});

describe('Session ownership (#1429) — listSessions scoping', () => {
  it('scopes sessions to owner for non-master keys', () => {
    const sessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-bob' }),
      makeSession({ id: 's-3', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-4', ownerKeyId: undefined }), // legacy
    ];

    // Simulate the filter logic from the list sessions route
    const callerKeyId = 'key-alice';
    const filtered = sessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);

    expect(filtered.map(s => s.id)).toEqual(['s-1', 's-3', 's-4']);
  });

  it('returns all sessions for master key', () => {
    const sessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-bob' }),
    ];

    // Master key: no filter applied
    const callerKeyId: string | null = 'master';
    const filtered = callerKeyId === 'master' ? sessions : sessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);

    expect(filtered).toHaveLength(2);
  });

  it('returns all sessions when auth is disabled', () => {
    const sessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-bob' }),
    ];

    const callerKeyId = null;
    const filtered = (callerKeyId === 'master' || callerKeyId === null || callerKeyId === undefined)
      ? sessions
      : sessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);

    expect(filtered).toHaveLength(2);
  });
});

describe('Session ownership (#1429) — batch delete scoping', () => {
  it('skips sessions owned by another key', () => {
    const allSessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-bob' }),
      makeSession({ id: 's-3', ownerKeyId: undefined }), // legacy
    ];

    const callerKeyId: string | null = 'key-alice';
    const deletable = allSessions.filter(s => {
      if (s.ownerKeyId && callerKeyId !== 'master' && callerKeyId !== null && callerKeyId !== undefined && s.ownerKeyId !== callerKeyId) {
        return false;
      }
      return true;
    });

    expect(deletable.map(s => s.id)).toEqual(['s-1', 's-3']);
  });
});
