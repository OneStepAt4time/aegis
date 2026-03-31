/**
 * Tests for Issue #394: Hook endpoints /v1/hooks/* must not bypass authentication.
 *
 * The auth middleware previously had a blanket skip for all /v1/hooks/* routes.
 * Now it requires a valid X-Session-Id header referencing a known session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { UIState } from '../terminal-parser.js';

// ── Simulated auth middleware (mirrors server.ts setupAuth for hook routes) ──

/** Matches exactly /v1/hooks/{eventName} where eventName is alpha-only. */
const HOOK_ROUTE_RE = /^\/v1\/hooks\/[A-Za-z]+$/;

/** UUID format regex — mirrors validation.ts UUID_REGEX. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Simulates the auth middleware from server.ts for hook routes.
 * Returns null if the request should be allowed, or an error object if rejected.
 */
function simulateHookAuth(
  urlPath: string,
  headers: Record<string, string>,
  query: Record<string, string>,
  getSession: (id: string) => SessionInfo | null,
): { status: number; error: string } | null {
  const strippedPath = urlPath.split('?')[0] ?? '';
  const hookMatch = HOOK_ROUTE_RE.exec(strippedPath);
  if (!hookMatch) return null; // not a hook route — not our concern

  const sessionId = headers['x-session-id'] || query.sessionId;
  // Issue #580: Reject non-UUID session IDs before getSession lookup.
  if (sessionId && !UUID_RE.test(sessionId)) {
    return { status: 400, error: 'Invalid session ID — must be a UUID' };
  }
  if (sessionId && getSession(sessionId)) {
    return null; // valid session — allow
  }
  return { status: 401, error: 'Unauthorized — hook endpoint requires valid session ID' };
}

// ── Helpers ──

function createMockSessionManager(session: SessionInfo | null): SessionManager {
  return {
    getSession: vi.fn().mockReturnValue(session),
    updateStatusFromHook: vi.fn((_id: string, _hookEvent: string, _hookTimestamp?: number): UIState | null => {
      return session?.status ?? null;
    }),
    updateSessionModel: vi.fn(),
    waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as const)),
    hasPendingPermission: vi.fn().mockReturnValue(false),
    getPendingPermissionInfo: vi.fn().mockReturnValue(null),
    resolvePendingPermission: vi.fn().mockReturnValue(false),
    cleanupPendingPermission: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  } as unknown as SessionManager;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    windowId: '@5',
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
  };
}

// ── Tests ──

describe('Issue #394: Hook endpoint auth — no blanket bypass', () => {
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;
  let session: SessionInfo;
  let mockSessions: SessionManager;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    session = makeSession();
    mockSessions = createMockSessionManager(session);
    registerHookRoutes(app, { sessions: mockSessions, eventBus });
  });

  describe('Auth middleware simulation', () => {
    it('should reject hook request with no session ID', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        {},
        {},
        (id) => id === session.id ? session : null,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(result!.error).toContain('session ID');
    });

    it('should reject hook request with unknown session ID', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        { 'x-session-id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        {},
        (id) => id === session.id ? session : null,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should reject hook request with unknown session ID via query param', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        {},
        { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        (id) => id === session.id ? session : null,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should allow hook request with valid session ID via header', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        { 'x-session-id': session.id },
        {},
        (id) => id === session.id ? session : null,
      );
      expect(result).toBeNull();
    });

    it('should allow hook request with valid session ID via query param', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        {},
        { sessionId: session.id },
        (id) => id === session.id ? session : null,
      );
      expect(result).toBeNull();
    });

    it('should not interfere with non-hook routes', () => {
      const result = simulateHookAuth(
        '/v1/sessions',
        {},
        {},
        (id) => id === session.id ? session : null,
      );
      expect(result).toBeNull();
    });

    it('should apply to all hook event types', () => {
      const events = ['Stop', 'StopFailure', 'PreToolUse', 'PermissionRequest',
        'PostToolUse', 'Notification', 'SubagentStart', 'SubagentStop'];
      for (const eventName of events) {
        const result = simulateHookAuth(
          `/v1/hooks/${eventName}`,
          {},
          {},
          (id) => id === session.id ? session : null,
        );
        expect(result).not.toBeNull();
        expect(result!.status).toBe(401);
      }
    });

    // Issue #580: UUID format validation on hookSessionId
    it('should reject non-UUID session ID in header with 400', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        { 'x-session-id': 'not-a-uuid' },
        {},
        () => session,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(400);
      expect(result!.error).toContain('Invalid session ID');
    });

    it('should reject non-UUID session ID in query param with 400', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        {},
        { sessionId: '../../etc/passwd' },
        () => session,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(400);
      expect(result!.error).toContain('Invalid session ID');
    });

    it('should reject partially malformed UUID with 400', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        { 'x-session-id': '12345678-1234-1234-1234-12345678901X' },
        {},
        () => session,
      );
      expect(result).not.toBeNull();
      expect(result!.status).toBe(400);
    });

    it('should allow valid UUID format even if session is not found', () => {
      const result = simulateHookAuth(
        '/v1/hooks/Stop',
        { 'x-session-id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        {},
        () => null,
      );
      // UUID format is valid, but session not found → 401 (not 400)
      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });
  });

  describe('Hook route handler still enforces session validation', () => {
    it('should return 400 when no session ID is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Missing session ID');
    });

    it('should return 404 for unknown session ID', async () => {
      const noSession = createMockSessionManager(null);
      const app2 = Fastify({ logger: false });
      registerHookRoutes(app2, { sessions: noSession, eventBus });

      const res = await app2.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        headers: { 'X-Session-Id': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('should return 200 for valid session ID via header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        headers: { 'X-Session-Id': session.id },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    });

    it('should return 200 for valid session ID via query param', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    });

    // Issue #580: Route handler UUID validation
    it('should reject non-UUID session ID with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        headers: { 'X-Session-Id': 'not-a-valid-uuid' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid session ID');
    });

    it('should reject path traversal attempt with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        headers: { 'X-Session-Id': '../../etc/passwd' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid session ID');
    });
  });
});
