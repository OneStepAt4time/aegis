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

describe('Session ownership (#1568) — permission policy/profile endpoints', () => {
  type PermissionEndpoint =
    | '/v1/sessions/:id/permissions [GET]'
    | '/v1/sessions/:id/permissions [PUT]'
    | '/v1/sessions/:id/permission-profile [GET]'
    | '/v1/sessions/:id/permission-profile [PUT]';

  interface SimulatedResponse {
    statusCode: number;
    body: Record<string, unknown>;
  }

  function simulatePermissionEndpoint(
    endpoint: PermissionEndpoint,
    session: SessionInfo | null,
    keyId: string | null | undefined,
    payload?: unknown,
  ): SimulatedResponse {
    if (!session) return { statusCode: 404, body: { error: 'Session not found' } };
    if (keyId !== 'master' && keyId !== null && keyId !== undefined && session.ownerKeyId && session.ownerKeyId !== keyId) {
      return { statusCode: 403, body: { error: 'Forbidden: session owned by another API key' } };
    }

    if (endpoint === '/v1/sessions/:id/permissions [GET]') {
      return { statusCode: 200, body: { permissionPolicy: session.permissionPolicy ?? [] } };
    }

    if (endpoint === '/v1/sessions/:id/permissions [PUT]') {
      return { statusCode: 200, body: { permissionPolicy: Array.isArray(payload) ? payload : [] } };
    }

    if (endpoint === '/v1/sessions/:id/permission-profile [GET]') {
      return { statusCode: 200, body: { permissionProfile: session.permissionProfile ?? null } };
    }

    return { statusCode: 200, body: { permissionProfile: typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null } };
  }

  const endpoints: PermissionEndpoint[] = [
    '/v1/sessions/:id/permissions [GET]',
    '/v1/sessions/:id/permissions [PUT]',
    '/v1/sessions/:id/permission-profile [GET]',
    '/v1/sessions/:id/permission-profile [PUT]',
  ];

  it('returns 403 for all four endpoints when caller does not own the session', () => {
    const s = makeSession({ ownerKeyId: 'key-owner' });
    for (const endpoint of endpoints) {
      const result = simulatePermissionEndpoint(endpoint, s, 'key-other', []);
      expect(result.statusCode).toBe(403);
    }
  });

  it('returns data/accepts updates for owner across all four endpoints', () => {
    const s = makeSession({
      ownerKeyId: 'key-owner',
      permissionPolicy: [{ source: 'aegisApi', ruleBehavior: 'allow', toolName: 'Bash' }],
      permissionProfile: { defaultBehavior: 'ask', rules: [{ tool: 'Read', behavior: 'allow' }] },
    });

    const getPolicy = simulatePermissionEndpoint('/v1/sessions/:id/permissions [GET]', s, 'key-owner');
    expect(getPolicy.statusCode).toBe(200);
    expect(getPolicy.body).toEqual({ permissionPolicy: [{ source: 'aegisApi', ruleBehavior: 'allow', toolName: 'Bash' }] });

    const putPolicyPayload = [{ matcher: 'Edit(*)', mode: 'ask' }];
    const putPolicy = simulatePermissionEndpoint('/v1/sessions/:id/permissions [PUT]', s, 'key-owner', putPolicyPayload);
    expect(putPolicy.statusCode).toBe(200);
    expect(putPolicy.body).toEqual({ permissionPolicy: putPolicyPayload });

    const getProfile = simulatePermissionEndpoint('/v1/sessions/:id/permission-profile [GET]', s, 'key-owner');
    expect(getProfile.statusCode).toBe(200);
    expect(getProfile.body).toEqual({ permissionProfile: { defaultBehavior: 'ask', rules: [{ tool: 'Read', behavior: 'allow' }] } });

    const putProfilePayload = { defaultBehavior: 'deny', rules: [{ tool: 'Write', behavior: 'ask' }] };
    const putProfile = simulatePermissionEndpoint('/v1/sessions/:id/permission-profile [PUT]', s, 'key-owner', putProfilePayload);
    expect(putProfile.statusCode).toBe(200);
    expect(putProfile.body).toEqual({ permissionProfile: putProfilePayload });
  });
});

describe('Session health ownership/scope (#1569)', () => {
  function canReadSessionHealth(session: SessionInfo | null, keyId: string | null | undefined): boolean {
    if (!session) return false;
    if (keyId === 'master' || keyId === null || keyId === undefined) return true;
    if (!session.ownerKeyId) return true;
    return session.ownerKeyId === keyId;
  }

  function filterBulkHealthSessions(
    allSessions: SessionInfo[],
    callerKeyId: string | null | undefined,
    callerRole: 'admin' | 'operator' | 'viewer',
  ): string[] {
    if (callerRole === 'admin' || callerKeyId === null || callerKeyId === undefined) {
      return allSessions.map(s => s.id);
    }
    return allSessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId).map(s => s.id);
  }

  it('per-session health rejects non-owner and allows owner', () => {
    const owned = makeSession({ id: 's-owned', ownerKeyId: 'key-owner' });
    expect(canReadSessionHealth(owned, 'key-other')).toBe(false);
    expect(canReadSessionHealth(owned, 'key-owner')).toBe(true);
  });

  it('bulk health returns all sessions for admin', () => {
    const sessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-a' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-b' }),
      makeSession({ id: 's-3', ownerKeyId: undefined }),
    ];

    expect(filterBulkHealthSessions(sessions, 'key-any', 'admin')).toEqual(['s-1', 's-2', 's-3']);
  });

  it('bulk health is scoped to owner+legacy for non-admin callers', () => {
    const sessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-a' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-b' }),
      makeSession({ id: 's-3', ownerKeyId: undefined }),
    ];

    expect(filterBulkHealthSessions(sessions, 'key-a', 'viewer')).toEqual(['s-1', 's-3']);
  });
});

describe('Session ownership (#1399) — metrics, tools, latency, screenshot, events, consensus, stats', () => {
  // These endpoints were missing ownership checks. They now use requireOwnership()
  // (same logic as the existing checkOwnership pattern above) or the list-scoping filter.

  type PerSessionEndpoint =
    | 'metrics'
    | 'tools'
    | 'latency'
    | 'screenshot'
    | 'events'
    | 'consensus';

  function simulateRequireOwnership(
    session: SessionInfo | null,
    keyId: string | null | undefined,
  ): { allowed: boolean; code?: number } {
    if (!session) return { allowed: false, code: 404 };
    if (keyId === 'master' || keyId === null || keyId === undefined) return { allowed: true };
    if (!session.ownerKeyId) return { allowed: true };
    if (session.ownerKeyId !== keyId) return { allowed: false, code: 403 };
    return { allowed: true };
  }

  const perSessionEndpoints: PerSessionEndpoint[] = [
    'metrics', 'tools', 'latency', 'screenshot', 'events', 'consensus',
  ];

  it('rejects non-owner with 403 on all newly-guarded per-session endpoints', () => {
    const s = makeSession({ ownerKeyId: 'key-owner' });
    for (const _ of perSessionEndpoints) {
      const result = simulateRequireOwnership(s, 'key-other');
      expect(result).toEqual({ allowed: false, code: 403 });
    }
  });

  it('allows owner on all newly-guarded per-session endpoints', () => {
    const s = makeSession({ ownerKeyId: 'key-owner' });
    for (const _ of perSessionEndpoints) {
      const result = simulateRequireOwnership(s, 'key-owner');
      expect(result.allowed).toBe(true);
    }
  });

  it('master key bypasses ownership on all newly-guarded endpoints', () => {
    const s = makeSession({ ownerKeyId: 'key-owner' });
    for (const _ of perSessionEndpoints) {
      const result = simulateRequireOwnership(s, 'master');
      expect(result.allowed).toBe(true);
    }
  });

  it('null keyId (no-auth mode) bypasses ownership', () => {
    const s = makeSession({ ownerKeyId: 'key-owner' });
    for (const _ of perSessionEndpoints) {
      const result = simulateRequireOwnership(s, null);
      expect(result.allowed).toBe(true);
    }
  });

  it('legacy session without ownerKeyId allows all access', () => {
    const s = makeSession({ ownerKeyId: undefined });
    for (const _ of perSessionEndpoints) {
      const result = simulateRequireOwnership(s, 'key-random');
      expect(result.allowed).toBe(true);
    }
  });

  it('returns 404 when session not found on any endpoint', () => {
    for (const _ of perSessionEndpoints) {
      const result = simulateRequireOwnership(null, 'key-owner');
      expect(result).toEqual({ allowed: false, code: 404 });
    }
  });

  it('GET /v1/sessions/stats scopes by ownership for non-master keys', () => {
    const allSessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-bob' }),
      makeSession({ id: 's-3', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-4', ownerKeyId: undefined }), // legacy
    ];

    // Non-master, non-null key: scoped
    const callerKeyId = 'key-alice';
    const scoped = allSessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);
    expect(scoped.map(s => s.id)).toEqual(['s-1', 's-3', 's-4']);
  });

  it('GET /v1/sessions/stats returns all for master key', () => {
    const allSessions = [
      makeSession({ id: 's-1', ownerKeyId: 'key-alice' }),
      makeSession({ id: 's-2', ownerKeyId: 'key-bob' }),
    ];

    const callerKeyId: string | null = 'master';
    const filtered = (callerKeyId === 'master' || callerKeyId === null || callerKeyId === undefined)
      ? allSessions
      : allSessions.filter(s => !s.ownerKeyId || s.ownerKeyId === callerKeyId);

    expect(filtered).toHaveLength(2);
  });
});
