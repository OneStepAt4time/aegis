/**
 * hooks.test.ts — Tests for Issue #169: HTTP hooks endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

function createMockSessionManager(session: SessionInfo | null): SessionManager {
  return {
    getSession: vi.fn().mockReturnValue(session),
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
    permissionMode: 'default',
    ...overrides,
  };
}

describe('HTTP Hooks (Issue #169)', () => {
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

  describe('POST /v1/hooks/Stop', () => {
    it('should return 200 for valid session ID via query param', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: { session_id: 'cc-abc', stop_hook_active: true },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('should return 200 for valid session ID via X-Session-Id header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        headers: { 'X-Session-Id': session.id },
        payload: { session_id: 'cc-abc' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('should return 404 for invalid session ID', async () => {
      const noSession = createMockSessionManager(null);
      const app2 = Fastify({ logger: false });
      registerHookRoutes(app2, { sessions: noSession, eventBus });

      const res = await app2.inject({
        method: 'POST',
        url: '/v1/hooks/Stop?sessionId=nonexistent-id',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('not found');
    });

    it('should return 400 when no session ID provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/hooks/Stop',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Missing session ID');
    });

    it('should emit hook event to SSE subscribers', async () => {
      const events: Array<{ event: string; sessionId: string; data: Record<string, unknown> }> = [];
      eventBus.subscribe(session.id, (e) => events.push(e));

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
        payload: { session_id: 'cc-abc', stop_hook_active: true },
      });

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('hook');
      expect(events[0].sessionId).toBe(session.id);
      expect(events[0].data.hookEvent).toBe('Stop');
    });
  });

  describe('POST /v1/hooks/PreToolUse (decision event)', () => {
    it('should return permissionDecision with decision: allow', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe('allow');
    });

    it('should emit hook event to SSE subscribers', async () => {
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      eventBus.subscribe(session.id, (e) => events.push(e));

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
      });

      expect(events).toHaveLength(1);
      expect(events[0].data.hookEvent).toBe('PreToolUse');
      expect(events[0].data.tool_name).toBe('Bash');
    });
  });

  describe('POST /v1/hooks/PermissionRequest (decision event)', () => {
    it('should return decision: allow', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow file write?' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe('allow');
    });
  });

  describe('POST /v1/hooks/PostToolUse (notification event)', () => {
    it('should return ok: true', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PostToolUse?sessionId=${session.id}`,
        payload: { tool_name: 'Read', tool_output: 'file contents' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });
  });
});
