/**
 * answer-timeout-nan.test.ts — Tests for Issue #637: ANSWER_TIMEOUT_MS NaN guard.
 *
 * Verifies that when ANSWER_TIMEOUT_MS is set to a non-numeric env var,
 * the hooks module falls back to 30000 instead of passing NaN to waitForAnswer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { SessionEventBus } from '../events.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import type { UIState } from '../terminal-parser.js';

function makeSession(): SessionInfo {
  return {
    id: '00000000-0000-0000-0000-000000000099',
    windowId: '@99',
    windowName: 'test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'working',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'bypassPermissions',
  };
}

describe('Issue #637: ANSWER_TIMEOUT_MS NaN guard', () => {
  const originalEnv = process.env.ANSWER_TIMEOUT_MS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ANSWER_TIMEOUT_MS;
    } else {
      process.env.ANSWER_TIMEOUT_MS = originalEnv;
    }
    vi.resetModules();
  });

  it('passes a finite timeout (not NaN) when env var is non-numeric', async () => {
    process.env.ANSWER_TIMEOUT_MS = 'not-a-number';

    let capturedTimeout: number | undefined;
    const session = makeSession();
    const mockSessions: SessionManager = {
      getSession: vi.fn().mockReturnValue(session),
      updateStatusFromHook: vi.fn((): UIState | null => 'working'),
      updateSessionModel: vi.fn(),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as const)),
      hasPendingPermission: vi.fn().mockReturnValue(false),
      getPendingPermissionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingPermission: vi.fn(),
      waitForAnswer: vi.fn((_sid: string, _toolUseId: string, _q: string, timeoutMs?: number) => {
        capturedTimeout = timeoutMs;
        return Promise.resolve(null);
      }),
      submitAnswer: vi.fn(),
      hasPendingQuestion: vi.fn().mockReturnValue(false),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingQuestion: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    } as unknown as SessionManager;

    const { registerHookRoutes } = await import('../hooks.js');
    const app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_nan_test',
        tool_input: { questions: [{ question: 'Test?' }] },
      },
    });

    expect(capturedTimeout).toBeDefined();
    expect(Number.isFinite(capturedTimeout!)).toBe(true);
    expect(capturedTimeout).toBe(30_000);
  });

  it('passes a finite timeout when env var is undefined', async () => {
    delete process.env.ANSWER_TIMEOUT_MS;

    let capturedTimeout: number | undefined;
    const session = makeSession();
    const mockSessions: SessionManager = {
      getSession: vi.fn().mockReturnValue(session),
      updateStatusFromHook: vi.fn((): UIState | null => 'working'),
      updateSessionModel: vi.fn(),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as const)),
      hasPendingPermission: vi.fn().mockReturnValue(false),
      getPendingPermissionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingPermission: vi.fn(),
      waitForAnswer: vi.fn((_sid: string, _toolUseId: string, _q: string, timeoutMs?: number) => {
        capturedTimeout = timeoutMs;
        return Promise.resolve(null);
      }),
      submitAnswer: vi.fn(),
      hasPendingQuestion: vi.fn().mockReturnValue(false),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingQuestion: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    } as unknown as SessionManager;

    const { registerHookRoutes } = await import('../hooks.js');
    const app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_undefined_test',
        tool_input: { questions: [{ question: 'Test?' }] },
      },
    });

    expect(capturedTimeout).toBe(30_000);
  });

  it('uses custom value when env var is a valid number string', async () => {
    process.env.ANSWER_TIMEOUT_MS = '5000';

    let capturedTimeout: number | undefined;
    const session = makeSession();
    const mockSessions: SessionManager = {
      getSession: vi.fn().mockReturnValue(session),
      updateStatusFromHook: vi.fn((): UIState | null => 'working'),
      updateSessionModel: vi.fn(),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as const)),
      hasPendingPermission: vi.fn().mockReturnValue(false),
      getPendingPermissionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingPermission: vi.fn(),
      waitForAnswer: vi.fn((_sid: string, _toolUseId: string, _q: string, timeoutMs?: number) => {
        capturedTimeout = timeoutMs;
        return Promise.resolve(null);
      }),
      submitAnswer: vi.fn(),
      hasPendingQuestion: vi.fn().mockReturnValue(false),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingQuestion: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    } as unknown as SessionManager;

    const { registerHookRoutes } = await import('../hooks.js');
    const app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_custom_test',
        tool_input: { questions: [{ question: 'Test?' }] },
      },
    });

    expect(capturedTimeout).toBe(5000);
  });

  it('clamps timeout to lower bound when env var is too small', async () => {
    process.env.ANSWER_TIMEOUT_MS = '1';

    let capturedTimeout: number | undefined;
    const session = makeSession();
    const mockSessions: SessionManager = {
      getSession: vi.fn().mockReturnValue(session),
      updateStatusFromHook: vi.fn((): UIState | null => 'working'),
      updateSessionModel: vi.fn(),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as const)),
      hasPendingPermission: vi.fn().mockReturnValue(false),
      getPendingPermissionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingPermission: vi.fn(),
      waitForAnswer: vi.fn((_sid: string, _toolUseId: string, _q: string, timeoutMs?: number) => {
        capturedTimeout = timeoutMs;
        return Promise.resolve(null);
      }),
      submitAnswer: vi.fn(),
      hasPendingQuestion: vi.fn().mockReturnValue(false),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingQuestion: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    } as unknown as SessionManager;

    const { registerHookRoutes } = await import('../hooks.js');
    const app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_low_bound_test',
        tool_input: { questions: [{ question: 'Test?' }] },
      },
    });

    expect(capturedTimeout).toBe(1_000);
  });

  it('clamps timeout to upper bound when env var is too large', async () => {
    process.env.ANSWER_TIMEOUT_MS = '700000';

    let capturedTimeout: number | undefined;
    const session = makeSession();
    const mockSessions: SessionManager = {
      getSession: vi.fn().mockReturnValue(session),
      updateStatusFromHook: vi.fn((): UIState | null => 'working'),
      updateSessionModel: vi.fn(),
      addSubagent: vi.fn(),
      removeSubagent: vi.fn(),
      waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as const)),
      hasPendingPermission: vi.fn().mockReturnValue(false),
      getPendingPermissionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingPermission: vi.fn(),
      waitForAnswer: vi.fn((_sid: string, _toolUseId: string, _q: string, timeoutMs?: number) => {
        capturedTimeout = timeoutMs;
        return Promise.resolve(null);
      }),
      submitAnswer: vi.fn(),
      hasPendingQuestion: vi.fn().mockReturnValue(false),
      getPendingQuestionInfo: vi.fn().mockReturnValue(null),
      cleanupPendingQuestion: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
    } as unknown as SessionManager;

    const { registerHookRoutes } = await import('../hooks.js');
    const app = Fastify({ logger: false });
    const eventBus = new SessionEventBus();
    registerHookRoutes(app, { sessions: mockSessions, eventBus });

    await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_high_bound_test',
        tool_input: { questions: [{ question: 'Test?' }] },
      },
    });

    expect(capturedTimeout).toBe(600_000);
  });
});
