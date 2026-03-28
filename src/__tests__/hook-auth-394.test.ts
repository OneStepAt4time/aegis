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
    id: 'test-session-123',
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
        { 'x-session-id': 'unknown-session-id' },
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
        { sessionId: 'fake-session' },
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
        headers: { 'X-Session-Id': 'nonexistent' },
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
  });
});
