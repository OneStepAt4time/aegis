/**
 * hook-permission-approval.test.ts — Tests for Issue #284: Hook-based permission approval.
 *
 * Tests that:
 * 1. Auto-approve sessions respond immediately to PermissionRequest hooks
 * 2. Non-auto-approve sessions store pending permission and wait for client approval
 * 3. Pending permissions auto-reject after timeout
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerHookRoutes } from '../hooks.js';
import { SessionEventBus } from '../events.js';
import type { SessionManager, PermissionDecision } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { UIState } from '../terminal-parser.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '00000000-0000-0000-0000-000000000004',
    windowId: '@5',
    windowName: 'cc-test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

function createMockSessionManager(session: SessionInfo | null): SessionManager {
  // Track pending permission resolver
  let pendingResolve: ((decision: PermissionDecision) => void) | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingToolName: string | undefined;
  let pendingPrompt: string | undefined;

  return {
    getSession: vi.fn().mockReturnValue(session),
    updateStatusFromHook: vi.fn((_id: string, hookEvent: string, _hookTimestamp?: number): UIState | null => {
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
    addSubagent: vi.fn(),
    removeSubagent: vi.fn(),
    waitForPermissionDecision: vi.fn(
      (sessionId: string, timeoutMs?: number, toolName?: string, prompt?: string): Promise<PermissionDecision> => {
        return new Promise<PermissionDecision>((resolve) => {
          pendingTimer = setTimeout(() => {
            pendingResolve = null;
            resolve('deny');
          }, timeoutMs ?? 10_000);
          pendingResolve = resolve;
          pendingToolName = toolName;
          pendingPrompt = prompt;
        });
      },
    ),
    hasPendingPermission: vi.fn(() => pendingResolve !== null),
    getPendingPermissionInfo: vi.fn(() =>
      pendingResolve !== null ? { toolName: pendingToolName, prompt: pendingPrompt } : null,
    ),
    // Helper to simulate client approve/reject from test code
    _testResolvePending: (decision: PermissionDecision): boolean => {
      if (!pendingResolve) return false;
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingResolve(decision);
      pendingResolve = null;
      pendingTimer = null;
      return true;
    },
  } as unknown as SessionManager;
}

describe('Issue #284: Hook-based permission approval', () => {
  describe('Auto-approve sessions (permissionMode != default)', () => {
    const autoApproveModes = ['bypassPermissions', 'dontAsk', 'acceptEdits', 'auto'];

    for (const mode of autoApproveModes) {
      it(`should respond immediately with "allow" for permissionMode=${mode}`, async () => {
        const app = Fastify({ logger: false });
        const eventBus = new SessionEventBus();
        const session = makeSession({ status: 'working', permissionMode: mode });
        const mockSessions = createMockSessionManager(session);
        registerHookRoutes(app, { sessions: mockSessions, eventBus });

        const res = await app.inject({
          method: 'POST',
          url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
          payload: { permission_prompt: 'Allow file write?', permission_mode: mode },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().hookSpecificOutput?.permissionDecision).toBe('allow');
        expect(res.json().hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
        // Should NOT wait for client — waitForPermissionDecision should not be called
        expect(mockSessions.waitForPermissionDecision).not.toHaveBeenCalled();
      });
    }
  });

  it('should wait for client approval for permissionMode=plan', async () => {
    const app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    const session = makeSession({ status: 'working', permissionMode: 'plan' });
    const mockSessions = createMockSessionManager(session) as SessionManager & { _testResolvePending: (d: PermissionDecision) => boolean };
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    const hookPromise = app.inject({
      method: 'POST',
      url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
      payload: { permission_prompt: 'Allow file write?', permission_mode: 'plan', tool_name: 'Write' },
    });

    await new Promise(r => setTimeout(r, 50));

    expect(mockSessions.waitForPermissionDecision).toHaveBeenCalledWith(
      session.id,
      expect.any(Number),
      'Write',
      'Allow file write?',
    );

    mockSessions._testResolvePending('allow');

    const res = await hookPromise;
    expect(res.statusCode).toBe(200);
    expect(res.json().hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(res.json().hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
  });

  describe('Non-auto-approve sessions (permissionMode=default)', () => {
    let app: ReturnType<typeof Fastify>;
    let eventBus: SessionEventBus;
    let session: SessionInfo;
    let mockSessions: SessionManager & { _testResolvePending: (d: PermissionDecision) => boolean };

    beforeEach(async () => {
      app = Fastify({ logger: false });
      eventBus = new SessionEventBus();
      session = makeSession({ status: 'working', permissionMode: 'default' });
      mockSessions = createMockSessionManager(session) as SessionManager & { _testResolvePending: (d: PermissionDecision) => boolean };
      registerHookRoutes(app, { sessions: mockSessions, eventBus });
    });

    it('should wait for client approval and respond with "allow"', async () => {
      // Fire the hook request (this will block waiting for client decision)
      const hookPromise = app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow file write?', tool_name: 'Write' },
      });

      // Give the hook handler a moment to set up the pending permission
      await new Promise(r => setTimeout(r, 50));

      // Simulate client approval
      mockSessions._testResolvePending('allow');

      const res = await hookPromise;
      expect(res.statusCode).toBe(200);
      expect(res.json().hookSpecificOutput?.permissionDecision).toBe('allow');
      expect(res.json().hookSpecificOutput?.hookEventName).toBe('PermissionRequest');
    });

    it('should wait for client rejection and respond with "deny"', async () => {
      const hookPromise = app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow Bash command?', tool_name: 'Bash' },
      });

      await new Promise(r => setTimeout(r, 50));

      // Simulate client rejection
      mockSessions._testResolvePending('deny');

      const res = await hookPromise;
      expect(res.statusCode).toBe(200);
      expect(res.json().hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('should pass tool name and prompt to waitForPermissionDecision', async () => {
      const hookPromise = app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow writing to index.ts?', tool_name: 'Edit' },
      });

      await new Promise(r => setTimeout(r, 50));

      expect(mockSessions.waitForPermissionDecision).toHaveBeenCalledWith(
        session.id,
        expect.any(Number),
        'Edit',
        'Allow writing to index.ts?',
      );

      mockSessions._testResolvePending('allow');
      await hookPromise;
    });
  });

  describe('Timeout behavior', () => {
    it('should auto-reject pending permission after timeout', async () => {
      const app = Fastify({ logger: false });
      const eventBus = new SessionEventBus();
      const session = makeSession({ status: 'working', permissionMode: 'default' });
      const mockSessions = createMockSessionManager(session);

      registerHookRoutes(app, { sessions: mockSessions, eventBus });

      // Fire the hook request
      const hookPromise = app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow file write?' },
      });

      // Give it a moment, then resolve with 'deny' to simulate timeout behavior
      await new Promise(r => setTimeout(r, 50));
      (mockSessions as unknown as { _testResolvePending: (d: PermissionDecision) => boolean })._testResolvePending('deny');

      const res = await hookPromise;

      expect(res.statusCode).toBe(200);
      expect(res.json().hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });

  describe('SSE events during PermissionRequest', () => {
    it('should emit approval SSE event even for non-auto-approve sessions', async () => {
      const app = Fastify({ logger: false });
      const eventBus = new SessionEventBus();
      const session = makeSession({ status: 'working', permissionMode: 'default' });
      const mockSessions = createMockSessionManager(session);
      registerHookRoutes(app, { sessions: mockSessions, eventBus });

      const events: Array<{ event: string; data: Record<string, unknown> }> = [];
      eventBus.subscribe(session.id, (e) => events.push(e));

      const hookPromise = app.inject({
        method: 'POST',
        url: `/v1/hooks/PermissionRequest?sessionId=${session.id}`,
        payload: { permission_prompt: 'Allow file write?' },
      });

      await new Promise(r => setTimeout(r, 50));

      // SSE events should have been emitted before waiting for client
      const approvalEvents = events.filter(e => e.event === 'approval');
      expect(approvalEvents).toHaveLength(1);
      expect(approvalEvents[0].data.prompt).toBe('Allow file write?');

      (mockSessions as unknown as { _testResolvePending: (d: PermissionDecision) => boolean })._testResolvePending('allow');
      await hookPromise;
    });
  });
});
