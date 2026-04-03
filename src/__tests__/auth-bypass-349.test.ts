/**
 * Tests for Issue #349: Auth bypass via broad path matching in middleware.
 *
 * Covers:
 * 1. Exact path matching for auth skips (hook routes, terminal routes)
 * 2. workDir allowlist + symlink resolution
 * 3. Hook event name validation against known list
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { UIState } from '../terminal-parser.js';

// ── Auth skip regex patterns (duplicated from server.ts setupAuth) ──

/** Matches exactly /v1/hooks/{eventName} where eventName is alpha-only. */
const HOOK_ROUTE_RE = /^\/v1\/hooks\/[A-Za-z]+$/;

/** Matches exactly /v1/sessions/{id}/terminal. */
const TERMINAL_ROUTE_RE = /^\/v1\/sessions\/[^/]+\/terminal$/;

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
    id: '00000000-0000-0000-0000-000000000002',
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

describe('Issue #349: Auth bypass via broad path matching', () => {
  describe('Fix 1: Exact path matching for auth skips', () => {
    it('should match /v1/hooks/Stop', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks/Stop')).toBe(true);
    });

    it('should match /v1/hooks/PreToolUse', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks/PreToolUse')).toBe(true);
    });

    it('should match /v1/hooks/PermissionRequest', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks/PermissionRequest')).toBe(true);
    });

    it('should NOT match /v1/hooks (no event name)', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks')).toBe(false);
    });

    it('should NOT match /v1/hooks/ (trailing slash)', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks/')).toBe(false);
    });

    it('should NOT match /v1/hooks../../sessions (path traversal)', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks../../sessions')).toBe(false);
    });

    it('should NOT match /v1/hooks/foo/bar (extra segments)', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks/foo/bar')).toBe(false);
    });

    it('should NOT match /v1/hooks/../../../etc/passwd', () => {
      expect(HOOK_ROUTE_RE.test('/v1/hooks/../../../etc/passwd')).toBe(false);
    });

    it('should NOT match /v1/hooks/Stop?sessionId=abc (query string)', () => {
      // Auth middleware strips query string before matching: urlPath = url.split('?')[0]
      // So the regex tests on the path part only
      expect(HOOK_ROUTE_RE.test('/v1/hooks/Stop?sessionId=abc')).toBe(false);
    });

    it('should match /v1/hooks/Stop with query string stripped', () => {
      const urlPath = '/v1/hooks/Stop?sessionId=abc'.split('?')[0];
      expect(HOOK_ROUTE_RE.test(urlPath)).toBe(true);
    });

    it('should match /v1/sessions/abc-123/terminal', () => {
      expect(TERMINAL_ROUTE_RE.test('/v1/sessions/abc-123/terminal')).toBe(true);
    });

    it('should NOT match /v1/sessions/some-terminal-data (substring)', () => {
      // Old code: includes('/terminal') would match this. New code: exact pattern.
      expect(TERMINAL_ROUTE_RE.test('/v1/sessions/some-terminal-data')).toBe(false);
    });

    it('should NOT match /v1/sessions/abc/terminal/extra (extra segments)', () => {
      expect(TERMINAL_ROUTE_RE.test('/v1/sessions/abc/terminal/extra')).toBe(false);
    });

    it('should NOT match /v1/terminal (no session ID)', () => {
      expect(TERMINAL_ROUTE_RE.test('/v1/terminal')).toBe(false);
    });

    it('should NOT match /terminal (bare substring match)', () => {
      expect(TERMINAL_ROUTE_RE.test('/terminal')).toBe(false);
    });
  });

  describe('Fix 5: Hook event name validation', () => {
    let app: ReturnType<typeof Fastify>;
    let eventBus: SessionEventBus;
    let session: SessionInfo;

    beforeEach(async () => {
      app = Fastify({ logger: false });
      eventBus = new SessionEventBus();
      session = makeSession();
      const mockSessions = createMockSessionManager(session);
      registerHookRoutes(app, { sessions: mockSessions, eventBus });
    });

    const KNOWN_EVENTS = [
      'Stop', 'StopFailure', 'PreToolUse', 'PostToolUse',
      'PostToolUseFailure', 'Notification', 'PermissionRequest',
      'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop',
      'TaskCompleted', 'TeammateIdle', 'PreCompact', 'PostCompact',
      'UserPromptSubmit', 'WorktreeCreate',
      'WorktreeRemove', 'Elicitation',
      'ElicitationResult', 'FileChanged', 'CwdChanged',
    ];

    for (const eventName of KNOWN_EVENTS) {
      it(`should accept known event: ${eventName}`, async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/hooks/${eventName}`,
          headers: { 'X-Session-Id': session.id },
          payload: {},
        });
        expect(res.statusCode).not.toBe(400);
      });
    }

    it('should reject unknown event name EvilEvent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/EvilEvent',
        headers: { 'X-Session-Id': session.id },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Unknown hook event');
    });

    it('should reject unknown event name with special chars', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/../../etc/passwd',
        payload: {},
      });
      // Fastify may 404 this as unmatched route, or 400 from validation
      expect([400, 404]).toContain(res.statusCode);
    });

    it('should reject empty event name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/',
        payload: {},
      });
      // Empty eventName is not in KNOWN_HOOK_EVENTS — returns 400
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Unknown hook event');
    });
  });
});
