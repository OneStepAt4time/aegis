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

/** Flush all pending setImmediate callbacks. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

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
        case 'PermissionRequest': session.status = 'permission_prompt'; break;
        case 'PreCompact': session.status = 'compacting'; break;
        case 'PostCompact': session.status = 'idle'; break;
        case 'Elicitation':
        case 'ElicitationResult': session.status = 'working'; break;
      }
      session.lastHookAt = Date.now();
      session.lastActivity = Date.now();
      return prev;
    }),
    updateSessionModel: vi.fn((_id: string, model: string): void => {
      if (!session) return;
      session.model = model;
    }),
    waitForPermissionDecision: vi.fn((_sessionId: string, _timeoutMs?: number, _toolName?: string, _prompt?: string) => {
      // For 'default' mode, wait for external resolution (but return immediately for tests)
      // Tests that need to test the waiting behavior should use hook-permission-approval.test.ts
      return Promise.resolve('allow' as const);
    }),
    hasPendingPermission: vi.fn().mockReturnValue(false),
    getPendingPermissionInfo: vi.fn().mockReturnValue(null),
    resolvePendingPermission: vi.fn().mockReturnValue(false),
    cleanupPendingPermission: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    detectWaitingForInput: vi.fn().mockResolvedValue(false),
    recordHookFailure: vi.fn(),
    recordHookSuccess: vi.fn(),
    checkHookCircuitBreaker: vi.fn().mockReturnValue(false),
  } as unknown as SessionManager;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '00000000-0000-0000-0000-000000000005',
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
        url: '/v1/hooks/Stop?sessionId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
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

      await flushAsync();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('hook');
      expect(events[0].sessionId).toBe(session.id);
      expect(events[0].data.hookEvent).toBe('Stop');
    });

    it('should accept Stop hook with empty body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/Stop?sessionId=${session.id}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
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

      await flushAsync();
      // Hook event is always emitted; status event emitted when status changes
      const hookEvents = events.filter(e => e.event === 'hook');
      expect(hookEvents).toHaveLength(1);
      expect(hookEvents[0].data.hookEvent).toBe('PreToolUse');
      expect(hookEvents[0].data.tool_name).toBe('Bash');
    });
  });

  describe('POST /v1/hooks/PermissionRequest (decision event)', () => {
    it('should return hookSpecificOutput with permissionDecision for PermissionRequest (v2)', async () => {
      // Use bypassPermissions mode so the hook responds immediately (Issue #284)
      const autoSession = makeSession({ status: 'working', permissionMode: 'bypassPermissions' });
      const autoMock = createMockSessionManager(autoSession);
      const app2 = Fastify({ logger: false });
      registerHookRoutes(app2, { sessions: autoMock, eventBus });

      const res = await app2.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${autoSession.id}`,
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

    it('should ignore unknown top-level fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PostToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Read',
          tool_output: 'ok',
          unexpected_field: 'extra-data',
        },
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

  it('PermissionRequest hook should update session status to permission_prompt', async () => {
    setupWithSession('working');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
      payload: { permission_prompt: 'Allow file write?' },
    });

    expect(session.status).toBe('permission_prompt');
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

    await flushAsync();
    // Should get hook event + status event (2 events)
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[0].data.hookEvent).toBe('Stop');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('idle');
  });

  it('should emit waiting_for_input on Stop hook when detectWaitingForInput returns true (Issue #812)', async () => {
    setupWithSession('working');
    // Override mock to simulate text-only last assistant message
    mockSessions.detectWaitingForInput = vi.fn().mockResolvedValue(true);
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Stop?sessionId=${session.id}`,
      payload: {},
    });

    await flushAsync();
    expect(events).toHaveLength(2);
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('waiting_for_input');
    expect(session.status).toBe('waiting_for_input');
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

    await flushAsync();
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

    await flushAsync();
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

    await flushAsync();
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

  it('PreCompact hook should update session status to compacting and update lastActivity', async () => {
    setupWithSession('working');
    const beforeActivity = session.lastActivity;
    await new Promise(r => setTimeout(r, 5));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreCompact?sessionId=${session.id}`,
      payload: {},
    });

    expect(session.status).toBe('compacting');
    expect(session.lastActivity).toBeGreaterThanOrEqual(beforeActivity);
  });

  it('PostCompact hook should update session status to idle and update lastActivity', async () => {
    setupWithSession('compacting');
    const beforeActivity = session.lastActivity;
    await new Promise(r => setTimeout(r, 5));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PostCompact?sessionId=${session.id}`,
      payload: {},
    });

    expect(session.status).toBe('idle');
    expect(session.lastActivity).toBeGreaterThanOrEqual(beforeActivity);
  });

  it('Elicitation hook should update session status to working', async () => {
    setupWithSession('idle');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Elicitation?sessionId=${session.id}`,
      payload: { tool_name: 'mcp__server__method' },
    });

    expect(session.status).toBe('working');
  });

  it('ElicitationResult hook should update session status to working', async () => {
    setupWithSession('idle');

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/ElicitationResult?sessionId=${session.id}`,
      payload: { tool_name: 'mcp__server__method', result: 'accepted' },
    });

    expect(session.status).toBe('working');
  });

  it('should emit SSE status event on PreCompact when status changes', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreCompact?sessionId=${session.id}`,
      payload: {},
    });

    await flushAsync();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('compacting');
  });

  it('should emit SSE status event on PostCompact when status changes', async () => {
    setupWithSession('compacting');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PostCompact?sessionId=${session.id}`,
      payload: {},
    });

    await flushAsync();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('idle');
  });

  it('should emit SSE status event on Elicitation when status changes', async () => {
    setupWithSession('idle');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Elicitation?sessionId=${session.id}`,
      payload: {},
    });

    await flushAsync();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('working');
  });

  it('should emit SSE status event on ElicitationResult when status changes', async () => {
    setupWithSession('idle');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/ElicitationResult?sessionId=${session.id}`,
      payload: {},
    });

    await flushAsync();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('hook');
    expect(events[1].event).toBe('status');
    expect(events[1].data.status).toBe('working');
  });

  it('Notification hook should be forwarded to SSE as hook event', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Notification?sessionId=${session.id}`,
      payload: { message: 'Build complete' },
    });

    await flushAsync();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hook');
    expect(events[0].data.hookEvent).toBe('Notification');
  });

  it('FileChanged hook should be forwarded to SSE as hook event', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/FileChanged?sessionId=${session.id}`,
      payload: { path: '/tmp/test/file.ts' },
    });

    await flushAsync();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hook');
    expect(events[0].data.hookEvent).toBe('FileChanged');
  });

  it('CwdChanged hook should be forwarded to SSE as hook event', async () => {
    setupWithSession('working');
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/CwdChanged?sessionId=${session.id}`,
      payload: { cwd: '/tmp/test/subdir' },
    });

    await flushAsync();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('hook');
    expect(events[0].data.hookEvent).toBe('CwdChanged');
  });

  it('Notification hook should be logged', async () => {
    setupWithSession('working');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/Notification?sessionId=${session.id}`,
      payload: { message: 'Build complete' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Notification'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(session.id));
    logSpy.mockRestore();
  });

  it('FileChanged hook should be logged', async () => {
    setupWithSession('working');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/FileChanged?sessionId=${session.id}`,
      payload: { path: '/tmp/test/file.ts' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('FileChanged'));
    logSpy.mockRestore();
  });

  it('CwdChanged hook should be logged', async () => {
    setupWithSession('working');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/CwdChanged?sessionId=${session.id}`,
      payload: { cwd: '/tmp/test/subdir' },
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('CwdChanged'));
    logSpy.mockRestore();
  });
});

describe('Hook validation (Issue #89)', () => {
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;
  let session: SessionInfo;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    // Use bypassPermissions so PermissionRequest hooks respond immediately (Issue #284)
    session = makeSession({ status: 'working', permissionMode: 'bypassPermissions' });
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

  describe('L26: WorktreeCreate/Remove hooks', () => {
    it('should return 200 for WorktreeCreate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeCreate?sessionId=${session.id}`,
        payload: { worktree_path: '/tmp/test-wt' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('should return 400 for WorktreeCreateFailed (invalid - removed)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeCreateFailed?sessionId=${session.id}`,
        payload: { error: 'worktree creation failed' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Unknown hook event: WorktreeCreateFailed" });
    });

    it('should return 200 for WorktreeRemove', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeRemove?sessionId=${session.id}`,
        payload: { worktree_path: '/tmp/test-wt' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('should return 400 for WorktreeRemoveFailed (invalid - removed)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeRemoveFailed?sessionId=${session.id}`,
        payload: { error: 'worktree removal failed' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Unknown hook event: WorktreeRemoveFailed" });
    });

    it('should emit hook event to SSE subscribers for worktree events', async () => {
      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      eventBus.subscribe(session.id, (e) => events.push(e));

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeCreate?sessionId=${session.id}`,
        payload: { worktree_path: '/tmp/test-wt' },
      });

      await flushAsync();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('hook');
      expect(events[0].data.hookEvent).toBe('WorktreeCreate');
    });

    it('should not change session status for worktree events', async () => {
      await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeCreate?sessionId=${session.id}`,
        payload: { worktree_path: '/tmp/test-wt' },
      });

      // Worktree events are informational — status stays working
      expect(session.status).toBe('working');
    });

    it('should log worktree hook events', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await app.inject({
        method: 'POST',
        url: `/v1/hooks/WorktreeCreate?sessionId=${session.id}`,
        payload: { worktree_path: '/tmp/test-wt' },
      });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('WorktreeCreate'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(session.id));
      logSpy.mockRestore();
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

  describe('Issue #1799: Edit tool duplicate line deduplication', () => {
    it('should deduplicate consecutive identical non-blank lines in Edit new_string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/tmp/test.py',
            old_string: 'self._near_miss_pending = False',
            new_string: 'self._last_combo_milestone = 0\nself._last_combo_milestone = 0\nself._near_miss_pending = False',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(body.hookSpecificOutput.updatedInput.new_string).toBe(
        'self._last_combo_milestone = 0\nself._near_miss_pending = False',
      );
    });

    it('should not modify Edit new_string without consecutive duplicates', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/tmp/test.py',
            old_string: 'x = 1',
            new_string: 'x = 1\ny = 2',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(body.hookSpecificOutput.updatedInput).toBeUndefined();
    });

    it('should preserve intentional blank lines', async () => {
      const newString = 'x = 1\n\n\ny = 2';
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/tmp/test.py',
            old_string: 'x = 1',
            new_string: newString,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hookSpecificOutput.updatedInput).toBeUndefined();
    });

    it('should not affect non-Edit tools', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Write',
          tool_input: {
            file_path: '/tmp/test.py',
            content: 'dup\n dup\n',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(body.hookSpecificOutput.updatedInput).toBeUndefined();
    });

    it('should handle Edit without new_string gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
        payload: {
          tool_name: 'Edit',
          tool_input: {
            file_path: '/tmp/test.py',
            old_string: 'x = 1',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.hookSpecificOutput.permissionDecision).toBe('allow');
      expect(body.hookSpecificOutput.updatedInput).toBeUndefined();
    });
  });
});
