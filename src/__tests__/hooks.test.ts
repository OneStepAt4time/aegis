/**
 * hooks.test.ts — Tests for Issue #169: HTTP hooks endpoint.
 *
 * Phase 1: Basic hook receiving and forwarding.
 * Phase 3: Hook-driven status detection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { UIState } from '../terminal-parser.js';

function createMockSessionManager(session: SessionInfo | null): SessionManager {
  return {
    getSession: vi.fn().mockReturnValue(session),
    updateStatusFromHook: vi.fn((_id: string, hookEvent: string, _hookTimestamp?: number): UIState | null => {
      // Simulate real status mapping
      if (!session) return null;
      const prev = session.status;
      switch (hookEvent) {
        case 'Stop': session.status = 'idle'; break;
        case 'PreToolUse':
        case 'PostToolUse': session.status = 'working'; break;
        case 'PermissionRequest': session.status = 'ask_question'; break;
      }
      session.lastHookAt = Date.now();
      session.lastActivity = Date.now();
      return prev;
    }),
    updateSessionModel: vi.fn((_id: string, model: string): void => {
      if (!session) return;
      session.model = model;
    }),
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
    it('should return hookSpecificOutput with permissionDecision for PreToolUse (v2)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Bash',
          tool_input: { command: 'ls' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().hookSpecificOutput?.permissionDecision).toBe('allow');
    });

    it('should emit hook event to SSE subscribers', async () => {
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      eventBus.subscribe(session.id, (e) => events.push(e));

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
      });

      // Hook event is always emitted; status event emitted when status changes
      const hookEvents = events.filter(e => e.event === 'hook');
      expect(hookEvents).toHaveLength(1);
      expect(hookEvents[0].data.hookEvent).toBe('PreToolUse');
      expect(hookEvents[0].data.tool_name).toBe('Bash');
    });
  });

  describe('POST /v1/hooks/PermissionRequest (decision event)', () => {
    it('should return hookSpecificOutput with permissionDecision for PermissionRequest (v2)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow file write?' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().hookSpecificOutput?.permissionDecision).toBe('allow');
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

describe('Hook-driven status detection (Issue #169 Phase 3)', () => {
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;
  let session: SessionInfo;
  let mockSessions: SessionManager;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
  });

  function setupWithSession(initialStatus: UIState): void {
    session = makeSession({ status: initialStatus });
    mockSessions = createMockSessionManager(session);
    registerHookRoutes(app, { sessions: mockSessions, eventBus });
  }

  it('Stop hook should update session status to idle', async () => {
    setupWithSession('working');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${session.id}`,
      payload: {},
    });

    expect(session.status).toBe('idle');
    expect(session.lastHookAt).toBeDefined();
    expect(session.lastHookAt).toBeGreaterThan(0);
  });

  it('PreToolUse hook should update session status to working', async () => {
    setupWithSession('idle');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: { tool_name: 'Bash' },
    });

    expect(session.status).toBe('working');
    expect(session.lastHookAt).toBeDefined();
  });

  it('PostToolUse hook should update session status to working', async () => {
    setupWithSession('idle');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PostToolUse?sessionId=${session.id}`,
      payload: { tool_name: 'Read' },
    });

    expect(session.status).toBe('working');
    expect(session.lastHookAt).toBeDefined();
  });

  it('PermissionRequest hook should update session status to ask_question', async () => {
    setupWithSession('working');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
      payload: { permission_prompt: 'Allow file write?' },
    });

    expect(session.status).toBe('ask_question');
  });

  it('StopFailure hook should not change session status', async () => {
    setupWithSession('working');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/StopFailure?sessionId=${session.id}`,
      payload: { stop_reason: 'rate_limit' },
    });

    expect(session.status).toBe('working');
    expect(session.lastHookAt).toBeDefined();
  });

  it('should update lastActivity timestamp on every hook', async () => {
    setupWithSession('idle');
    const before = session.lastActivity;

    // Small delay to ensure different timestamp
    await new Promise(r => setTimeout(r, 5));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {},
    });

    expect(session.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('should emit SSE status event on Stop hook when status changes', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${session.id}`,
      payload: {},
    });

    // Should get hook event + status event (2 events)
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[0].data.hookEvent).toBe('Stop');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('idle');
  });

  it('should emit SSE status event on PreToolUse when status changes', async () => {
    setupWithSession('idle');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: { tool_name: 'Bash' },
    });

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('working');
  });

  it('should emit SSE approval event on PermissionRequest', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
      payload: { permission_prompt: 'Allow writing to file.ts?' },
    });

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[1].event).toBe('approval');
    expect(events[1].data.prompt).toBe('Allow writing to file.ts?');
  });

  it('should NOT emit extra SSE status event when status does not change', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    // Already working → PreToolUse won't change status
    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: { tool_name: 'Read' },
    });

    // Only the hook event, no duplicate status event
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hook');
  });

  it('Notification hook should not change status but should update lastHookAt', async () => {
    setupWithSession('working');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Notification?sessionId=${session.id}`,
      payload: { message: 'Build complete' },
    });

    // Notification doesn't map to a UI state, so status stays working
    expect(session.status).toBe('working');
    expect(session.lastHookAt).toBeDefined();
  });
});

describe('Hook validation (Issue #89)', () => {
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;
  let session: SessionInfo;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    session = makeSession({ status: 'working' });
    const mockSessions = createMockSessionManager(session);
    registerHookRoutes(app, { sessions: mockSessions, eventBus });
  });

  describe('L24: permission_mode validation', () => {
    it('should accept valid permission_mode values', async () => {
      for (const mode of ['default', 'plan', 'bypassPermissions']) {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
          payload: { permission_prompt: 'Allow?', permission_mode: mode },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().hookSpecificOutput?.permissionDecision).toBe('allow');
      }
    });

    it('should fallback to "default" for invalid permission_mode', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow?', permission_mode: 'invalid_mode' },
      });

      expect(res.statusCode).toBe(200);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('invalid permission_mode "invalid_mode"'),
      );
      warnSpy.mockRestore();
    });

    it('should not warn when permission_mode is absent', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow?' },
      });

      expect(res.statusCode).toBe(200);
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('L25: model field capture from hook', () => {
    it('should store model field from hook payload on session', async () => {
      await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: { tool_name: 'Read', model: 'claude-sonnet-4-6' },
      });

      expect(session.model).toBe('claude-sonnet-4-6');
    });

    it('should not overwrite model when not present in hook', async () => {
      session.model = 'claude-opus-4-6';

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: { tool_name: 'Read' },
      });

      // model field was already set, and hook didn't include one — should remain
      expect(session.model).toBe('claude-opus-4-6');
    });

    it('should update model across different hook events', async () => {
      await app.inject({
        method: 'POST',
        url: `/v1/hooks/UserPromptSubmit?sessionId=${session.id}`,
        payload: { model: 'claude-haiku-4-5-20251001' },
      });

      expect(session.model).toBe('claude-haiku-4-5-20251001');

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: { tool_name: 'Bash', model: 'claude-opus-4-6' },
      });

      expect(session.model).toBe('claude-opus-4-6');
    });
  });
});
