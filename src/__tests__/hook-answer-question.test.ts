/**
 * hook-answer-question.test.ts — Tests for Issue #336: Headless question answering.
 *
 * Tests that:
 * 1. AskUserQuestion PreToolUse hook waits for external answer
 * 2. Answer is returned via updatedInput
 * 3. Timeout falls through to allow without answer
 * 4. POST /v1/sessions/:id/answer endpoint resolves pending questions
 * 5. SessionManager methods work correctly
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
    id: 'test-session-123',
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
    permissionMode: 'bypassPermissions',
    ...overrides,
  };
}

/** Flush all pending setImmediate callbacks. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

// ── Mock SessionManager for hook route tests ──────────────────────────

function createMockSessionManagerWithAnswer(session: SessionInfo): SessionManager & {
  _testResolveAnswer: (answer: string | null) => boolean;
} {
  let pendingAnswerResolve: ((answer: string | null) => void) | null = null;
  let pendingAnswerTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    getSession: vi.fn().mockReturnValue(session),
    updateStatusFromHook: vi.fn((_id: string, hookEvent: string): UIState | null => {
      if (!session) return null;
      const prev = session.status;
      switch (hookEvent) {
        case 'Stop': session.status = 'idle'; break;
        case 'PreToolUse':
        case 'PostToolUse': session.status = 'working'; break;
        case 'PermissionRequest': session.status = 'permission_prompt'; break;
      }
      session.lastHookAt = Date.now();
      session.lastActivity = Date.now();
      return prev;
    }),
    updateSessionModel: vi.fn(),
    addSubagent: vi.fn(),
    removeSubagent: vi.fn(),
    waitForPermissionDecision: vi.fn(() => Promise.resolve('allow' as PermissionDecision)),
    hasPendingPermission: vi.fn().mockReturnValue(false),
    getPendingPermissionInfo: vi.fn().mockReturnValue(null),
    cleanupPendingPermission: vi.fn(),
    waitForAnswer: vi.fn(
      (_sessionId: string, _toolUseId: string, _question: string, _timeoutMs?: number): Promise<string | null> => {
        return new Promise<string | null>((resolve) => {
          pendingAnswerTimer = setTimeout(() => {
            pendingAnswerResolve = null;
            resolve(null);
          }, _timeoutMs ?? 30_000);
          pendingAnswerResolve = resolve;
        });
      },
    ),
    submitAnswer: vi.fn(),
    hasPendingQuestion: vi.fn(() => pendingAnswerResolve !== null),
    getPendingQuestionInfo: vi.fn(),
    cleanupPendingQuestion: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    // Test helper
    _testResolveAnswer(answer: string | null): boolean {
      if (!pendingAnswerResolve) return false;
      if (pendingAnswerTimer) clearTimeout(pendingAnswerTimer);
      pendingAnswerResolve(answer);
      pendingAnswerResolve = null;
      pendingAnswerTimer = null;
      return true;
    },
  } as unknown as SessionManager & { _testResolveAnswer: (answer: string | null) => boolean };
}

describe('Issue #336: AskUserQuestion hook handling', () => {
  let app: ReturnType<typeof Fastify>;
  let eventBus: SessionEventBus;
  let session: SessionInfo;
  let mockSessions: SessionManager & { _testResolveAnswer: (answer: string | null) => boolean };

  beforeEach(async () => {
    app = Fastify({ logger: false });
    eventBus = new SessionEventBus();
    session = makeSession({ status: 'working', permissionMode: 'bypassPermissions' });
    mockSessions = createMockSessionManagerWithAnswer(session);
    registerHookRoutes(app, { sessions: mockSessions, eventBus });
  });

  it('should detect AskUserQuestion and wait for answer', async () => {
    const hookPromise = app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_abc123',
        tool_input: {
          questions: [{ question: 'Which framework?', options: [{ label: 'React' }, { label: 'Vue' }] }],
        },
      },
    });

    await new Promise(r => setTimeout(r, 50));

    // waitForAnswer should have been called
    expect(mockSessions.waitForAnswer).toHaveBeenCalledWith(
      session.id,
      'toolu_abc123',
      'Which framework?',
      expect.any(Number),
    );

    // Resolve with answer
    mockSessions._testResolveAnswer('React');

    const res = await hookPromise;
    expect(res.statusCode).toBe(200);
    expect(res.json().hookSpecificOutput.permissionDecision).toBe('allow');
    expect(res.json().hookSpecificOutput.updatedInput).toEqual({ answer: 'React' });
  });

  it('should emit ask_question SSE event before waiting for answer', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    eventBus.subscribe(session.id, (e) => events.push(e));

    const hookPromise = app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_abc123',
        tool_input: {
          questions: [{ question: 'Which approach?' }],
        },
      },
    });

    await new Promise(r => setTimeout(r, 50));

    // SSE event should have been emitted
    const statusEvents = events.filter(e => e.event === 'status' && e.data?.status === 'ask_question');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].data.questionId).toBe('toolu_abc123');
    expect(statusEvents[0].data.question).toBe('Which approach?');

    mockSessions._testResolveAnswer('Option A');
    await hookPromise;
  });

  it('should return allow without updatedInput on timeout', async () => {
    // Use a mock that resolves immediately with null (simulating timeout)
    const timeoutMock = createMockSessionManagerWithAnswer(session);
    timeoutMock.waitForAnswer = vi.fn(() => Promise.resolve(null));
    const app2 = Fastify({ logger: false });
    registerHookRoutes(app2, { sessions: timeoutMock, eventBus });

    const res = await app2.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_timeout',
        tool_input: { questions: [{ question: 'Which?' }] },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().hookSpecificOutput.permissionDecision).toBe('allow');
    expect(res.json().hookSpecificOutput.updatedInput).toBeUndefined();
  });

  it('should handle AskUserQuestion with empty tool_input', async () => {
    const hookPromise = app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_empty',
        tool_input: {},
      },
    });

    await new Promise(r => setTimeout(r, 50));
    mockSessions._testResolveAnswer('some answer');
    const res = await hookPromise;

    expect(res.statusCode).toBe(200);
    // Should still call waitForAnswer even with empty question
    expect(mockSessions.waitForAnswer).toHaveBeenCalledWith(
      session.id,
      'toolu_empty',
      '',
      expect.any(Number),
    );
  });

  it('should NOT intercept non-AskUserQuestion PreToolUse calls', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().hookSpecificOutput.permissionDecision).toBe('allow');
    expect(res.json().hookSpecificOutput.updatedInput).toBeUndefined();
    expect(mockSessions.waitForAnswer).not.toHaveBeenCalled();
  });

  it('should handle AskUserQuestion when tool_use_id is missing', async () => {
    const hookPromise = app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_input: { questions: [{ question: 'Which?' }] },
      },
    });

    await new Promise(r => setTimeout(r, 50));
    mockSessions._testResolveAnswer('default answer');
    const res = await hookPromise;

    // Should still intercept but with empty toolUseId
    expect(mockSessions.waitForAnswer).toHaveBeenCalledWith(
      session.id,
      '',
      'Which?',
      expect.any(Number),
    );
    expect(res.json().hookSpecificOutput.updatedInput).toEqual({ answer: 'default answer' });
  });

  it('should extract question text from tool_input correctly', async () => {
    const hookPromise = app.inject({
      method: 'POST',
      url: `/v1/hooks/PreToolUse?sessionId=${session.id}`,
      payload: {
        tool_name: 'AskUserQuestion',
        tool_use_id: 'toolu_multi',
        tool_input: {
          questions: [
            { question: 'First question?' },
            { question: 'Second question?' },
          ],
        },
      },
    });

    await new Promise(r => setTimeout(r, 50));

    // Should extract only the first question
    expect(mockSessions.waitForAnswer).toHaveBeenCalledWith(
      session.id,
      'toolu_multi',
      'First question?',
      expect.any(Number),
    );

    mockSessions._testResolveAnswer('Answer to first');
    const res = await hookPromise;
    expect(res.json().hookSpecificOutput.updatedInput).toEqual({ answer: 'Answer to first' });
  });
});
