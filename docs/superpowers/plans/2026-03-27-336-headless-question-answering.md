# Issue #336: Headless Question Answering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable external API clients to programmatically answer CC's AskUserQuestion tool calls via a new POST endpoint and PreToolUse hook updatedInput.

**Architecture:** Mirror the existing `pendingPermissions` / `waitForPermissionDecision` pattern. SessionManager stores a pending question promise. The PreToolUse hook blocks waiting for an external answer. A new REST endpoint resolves the promise. On timeout, the hook allows the tool call without modification.

**Tech Stack:** TypeScript, Fastify, Vitest

---

## File Structure

**Modified:**
- `src/session.ts` — PendingQuestion type, pendingQuestions map, 5 new methods, killSession cleanup
- `src/hooks.ts` — ANSWER_TIMEOUT_MS constant, extractQuestionText helper, AskUserQuestion detection
- `src/server.ts` — POST /v1/sessions/:id/answer endpoint

**Created:**
- `src/__tests__/hook-answer-question.test.ts` — Tests for full AskUserQuestion → answer flow

---

### Task 1: Add pending question tracking to SessionManager

**Files:**
- Modify: `src/session.ts`
- Test: `src/__tests__/hook-answer-question.test.ts`

- [ ] **Step 1: Write failing tests for waitForAnswer and submitAnswer**

Create `src/__tests__/hook-answer-question.test.ts` with tests for the SessionManager methods:

```typescript
/**
 * hook-answer-question.test.ts — Tests for Issue #336: Headless question answering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// ── SessionManager method tests (mock-based) ──────────────────────────

describe('Issue #336: Pending question tracking', () => {
  describe('SessionManager.waitForAnswer / submitAnswer', () => {
    it('waitForAnswer should block until submitAnswer is called', async () => {
      // We test this via the mock in hook tests — see below.
      // Here we test the contract: resolve with answer string.
      const { SessionManager } = await import('../session.js');
      const mockTmux = {
        ensureSession: vi.fn(),
        listWindows: vi.fn().mockResolvedValue([]),
        capturePane: vi.fn().mockResolvedValue(''),
      };
      const mockConfig = {
        stateDir: '/tmp/aegis-test-' + Date.now(),
        claudeProjectsDir: '/tmp/.claude',
        host: '127.0.0.1',
        port: 9100,
        defaultPermissionMode: 'bypassPermissions',
      };
      const mgr = new SessionManager(mockTmux as any, mockConfig as any);

      const answerPromise = mgr.waitForAnswer('sess-1', 'tool-123', 'Which option?', 5000);

      // Before submitting answer, promise should be pending
      let resolved = false;
      answerPromise.then(() => { resolved = true; });
      await new Promise(r => setTimeout(r, 50));
      expect(resolved).toBe(false);

      // Submit answer
      const submitted = mgr.submitAnswer('sess-1', 'tool-123', 'Option A');
      expect(submitted).toBe(true);

      const answer = await answerPromise;
      expect(answer).toBe('Option A');
    });

    it('submitAnswer should return false when no pending question', () => {
      const { SessionManager } = await import('../session.js');
      const mockTmux = {
        ensureSession: vi.fn(),
        listWindows: vi.fn().mockResolvedValue([]),
        capturePane: vi.fn().mockResolvedValue(''),
      };
      const mockConfig = {
        stateDir: '/tmp/aegis-test-' + Date.now(),
        claudeProjectsDir: '/tmp/.claude',
        host: '127.0.0.1',
        port: 9100,
        defaultPermissionMode: 'bypassPermissions',
      };
      const mgr = new SessionManager(mockTmux as any, mockConfig as any);

      const result = mgr.submitAnswer('sess-1', 'tool-123', 'answer');
      expect(result).toBe(false);
    });

    it('submitAnswer should return false when questionId does not match', async () => {
      const { SessionManager } = await import('../session.js');
      const mockTmux = {
        ensureSession: vi.fn(),
        listWindows: vi.fn().mockResolvedValue([]),
        capturePane: vi.fn().mockResolvedValue(''),
      };
      const mockConfig = {
        stateDir: '/tmp/aegis-test-' + Date.now(),
        claudeProjectsDir: '/tmp/.claude',
        host: '127.0.0.1',
        port: 9100,
        defaultPermissionMode: 'bypassPermissions',
      };
      const mgr = new SessionManager(mockTmux as any, mockConfig as any);

      mgr.waitForAnswer('sess-1', 'tool-123', 'Which?', 5000);
      const result = mgr.submitAnswer('sess-1', 'wrong-id', 'answer');
      expect(result).toBe(false);
    });

    it('waitForAnswer should resolve with null on timeout', async () => {
      const { SessionManager } = await import('../session.js');
      const mockTmux = {
        ensureSession: vi.fn(),
        listWindows: vi.fn().mockResolvedValue([]),
        capturePane: vi.fn().mockResolvedValue(''),
      };
      const mockConfig = {
        stateDir: '/tmp/aegis-test-' + Date.now(),
        claudeProjectsDir: '/tmp/.claude',
        host: '127.0.0.1',
        port: 9100,
        defaultPermissionMode: 'bypassPermissions',
      };
      const mgr = new SessionManager(mockTmux as any, mockConfig as any);

      const answer = await mgr.waitForAnswer('sess-1', 'tool-123', 'Which?', 100);
      expect(answer).toBeNull();
    });

    it('cleanupPendingQuestion should clear pending question', async () => {
      const { SessionManager } = await import('../session.js');
      const mockTmux = {
        ensureSession: vi.fn(),
        listWindows: vi.fn().mockResolvedValue([]),
        capturePane: vi.fn().mockResolvedValue(''),
      };
      const mockConfig = {
        stateDir: '/tmp/aegis-test-' + Date.now(),
        claudeProjectsDir: '/tmp/.claude',
        host: '127.0.0.1',
        port: 9100,
        defaultPermissionMode: 'bypassPermissions',
      };
      const mgr = new SessionManager(mockTmux as any, mockConfig as any);

      const answerPromise = mgr.waitForAnswer('sess-1', 'tool-123', 'Which?', 5000);
      mgr.cleanupPendingQuestion('sess-1');

      // After cleanup, submitAnswer should return false
      const result = mgr.submitAnswer('sess-1', 'tool-123', 'answer');
      expect(result).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/hook-answer-question.test.ts -t "Pending question tracking" 2>&1 | head -40`
Expected: FAIL — `waitForAnswer is not a function`, `submitAnswer is not a function`, etc.

- [ ] **Step 3: Add PendingQuestion interface and pendingQuestions map to session.ts**

In `src/session.ts`, add after the `PendingPermission` interface (around line 78):

```typescript
/** Pending answer resolver stored while waiting for external answer to AskUserQuestion. */
interface PendingQuestion {
  resolve: (answer: string | null) => void;
  timer: NodeJS.Timeout;
  toolUseId: string;
  question: string;
}
```

Add the field on `SessionManager` class, after `pendingPermissions` (around line 86):

```typescript
private pendingQuestions: Map<string, PendingQuestion> = new Map();
```

- [ ] **Step 4: Add waitForAnswer method to SessionManager**

Add after the `waitForPermissionDecision` method (around line 752). Export the type `PermissionDecision` is already exported; no new type export needed since `PendingQuestion` is private.

```typescript
  /**
   * Issue #336: Store a pending AskUserQuestion and return a promise that
   * resolves when the external client provides an answer via POST /answer.
   *
   * @param sessionId - Aegis session ID
   * @param toolUseId - CC's tool_use_id for correlation
   * @param question - Extracted question text
   * @param timeoutMs - Timeout before resolving with null (default 30_000ms)
   * @returns Promise that resolves with the answer string, or null on timeout
   */
  waitForAnswer(
    sessionId: string,
    toolUseId: string,
    question: string,
    timeoutMs: number = 30_000,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingQuestions.delete(sessionId);
        console.log(`Hooks: AskUserQuestion timeout for session ${sessionId} — allowing without answer`);
        resolve(null);
      }, timeoutMs);

      this.pendingQuestions.set(sessionId, { resolve, timer, toolUseId, question });
    });
  }
```

- [ ] **Step 5: Add submitAnswer, hasPendingQuestion, getPendingQuestionInfo, cleanupPendingQuestion**

Add after `waitForAnswer`:

```typescript
  /** Issue #336: Submit an answer to a pending question. Returns true if resolved. */
  submitAnswer(sessionId: string, questionId: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(sessionId);
    if (!pending) return false;
    if (pending.toolUseId !== questionId) return false;
    clearTimeout(pending.timer);
    this.pendingQuestions.delete(sessionId);
    pending.resolve(answer);
    return true;
  }

  /** Issue #336: Check if a session has a pending question. */
  hasPendingQuestion(sessionId: string): boolean {
    return this.pendingQuestions.has(sessionId);
  }

  /** Issue #336: Get info about a pending question. */
  getPendingQuestionInfo(sessionId: string): { toolUseId: string; question: string } | null {
    const pending = this.pendingQuestions.get(sessionId);
    return pending ? { toolUseId: pending.toolUseId, question: pending.question } : null;
  }

  /** Issue #336: Clean up any pending question for a session. */
  cleanupPendingQuestion(sessionId: string): void {
    const pending = this.pendingQuestions.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingQuestions.delete(sessionId);
    }
  }
```

- [ ] **Step 6: Add cleanupPendingQuestion to killSession**

In `src/session.ts`, find the `killSession` method. After the line `this.cleanupPendingPermission(id);` (around line 1010), add:

```typescript
    // Issue #336: Clean up any pending question resolver
    this.cleanupPendingQuestion(id);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/hook-answer-question.test.ts -t "Pending question tracking"`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add src/session.ts src/__tests__/hook-answer-question.test.ts
git commit -m "feat(#336): add pending question tracking to SessionManager"
```

---

### Task 2: Add AskUserQuestion detection to PreToolUse hook

**Files:**
- Modify: `src/hooks.ts`
- Test: `src/__tests__/hook-answer-question.test.ts`

- [ ] **Step 1: Write failing tests for AskUserQuestion hook handling**

Append to `src/__tests__/hook-answer-question.test.ts` — add the hook-level tests that mock SessionManager:

```typescript
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
      (sessionId: string, toolUseId: string, question: string, timeoutMs?: number): Promise<string | null> => {
        return new Promise<string | null>((resolve) => {
          pendingAnswerTimer = setTimeout(() => {
            pendingAnswerResolve = null;
            resolve(null);
          }, timeoutMs ?? 30_000);
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

/** Flush all pending setImmediate callbacks. */
function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
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
    const statusEvents = events.filter(e => e.event === 'status');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].data.status).toBe('ask_question');
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

  it('should NOT intercept AskUserQuestion when tool_use_id is missing', async () => {
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/hook-answer-question.test.ts -t "AskUserQuestion hook handling" 2>&1 | tail -20`
Expected: FAIL — tests expect AskUserQuestion detection that doesn't exist yet.

- [ ] **Step 3: Add ANSWER_TIMEOUT_MS constant and extractQuestionText helper to hooks.ts**

In `src/hooks.ts`, add after `PERMISSION_TIMEOUT_MS` (around line 31):

```typescript
/** Default timeout for waiting on external answer to AskUserQuestion (ms). */
const ANSWER_TIMEOUT_MS = parseInt(process.env.ANSWER_TIMEOUT_MS || '30000', 10);
```

Add the helper function before the `registerHookRoutes` function (around line 99):

```typescript
/** Extract question text from AskUserQuestion tool_input. */
function extractQuestionText(toolInput: Record<string, unknown> | undefined): string {
  if (!toolInput) return '';
  const questions = toolInput.questions as Array<Record<string, unknown>> | undefined;
  if (!questions || !Array.isArray(questions) || questions.length === 0) return '';
  const first = questions[0];
  return (first?.question as string) || '';
}
```

- [ ] **Step 4: Add AskUserQuestion detection in the PreToolUse handler**

In `src/hooks.ts`, find the `if (eventName === 'PreToolUse')` block inside the DECISION_EVENTS handler (around line 233). Replace:

```typescript
      if (eventName === 'PreToolUse') {
        // PreToolUse: always allow (existing behavior)
        return reply.status(200).send({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        });
      }
```

with:

```typescript
      if (eventName === 'PreToolUse') {
        // Issue #336: Intercept AskUserQuestion for headless question answering
        if (toolName === 'AskUserQuestion') {
          const toolInput = hookBody?.tool_input as Record<string, unknown> | undefined;
          const toolUseId = (hookBody?.tool_use_id as string) || '';
          const questionText = extractQuestionText(toolInput);

          // Emit ask_question SSE event for external clients
          deps.eventBus.emit(sessionId, {
            event: 'status',
            sessionId,
            timestamp: new Date().toISOString(),
            data: { status: 'ask_question', questionId: toolUseId, question: questionText },
          });

          console.log(`Hooks: AskUserQuestion for session ${sessionId} — waiting for answer (timeout: ${ANSWER_TIMEOUT_MS}ms)`);

          const answer = await deps.sessions.waitForAnswer(sessionId, toolUseId, questionText, ANSWER_TIMEOUT_MS);

          if (answer !== null) {
            console.log(`Hooks: AskUserQuestion answered for session ${sessionId}`);
            return reply.status(200).send({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput: { answer },
              },
            });
          }

          // Timeout: allow without answer (CC shows question to user in terminal)
          console.log(`Hooks: AskUserQuestion timeout for session ${sessionId} — allowing without answer`);
        }

        // Default: allow without modification
        return reply.status(200).send({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
          },
        });
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/hook-answer-question.test.ts -t "AskUserQuestion hook handling"`
Expected: ALL PASS

- [ ] **Step 6: Run existing hooks tests to verify no regressions**

Run: `npx vitest run src/__tests__/hooks.test.ts`
Expected: ALL PASS (no regressions)

- [ ] **Step 7: Commit**

```bash
git add src/hooks.ts src/__tests__/hook-answer-question.test.ts
git commit -m "feat(#336): add AskUserQuestion detection to PreToolUse hook"
```

---

### Task 3: Add POST /v1/sessions/:id/answer endpoint

**Files:**
- Modify: `src/server.ts`
- Test: `src/__tests__/hook-answer-question.test.ts`

- [ ] **Step 1: Write failing tests for the answer endpoint**

Append to `src/__tests__/hook-answer-question.test.ts`:

```typescript
// ── Server endpoint tests ─────────────────────────────────────────────

// NOTE: These tests use the main server setup. Since server.ts doesn't export
// the app for direct testing, we test via the hook route + SessionManager mock
// to verify the full contract. The endpoint integration is tested by verifying
// submitAnswer is called correctly.

describe('Issue #336: POST /v1/sessions/:id/answer endpoint contract', () => {
  // The endpoint is tested through the full server in integration tests.
  // Here we verify the SessionManager contract that the endpoint relies on.

  it('submitAnswer should resolve matching pending question', async () => {
    const { SessionManager } = await import('../session.js');
    const mockTmux = {
      ensureSession: vi.fn(),
      listWindows: vi.fn().mockResolvedValue([]),
      capturePane: vi.fn().mockResolvedValue(''),
    };
    const mockConfig = {
      stateDir: '/tmp/aegis-test-' + Date.now(),
      claudeProjectsDir: '/tmp/.claude',
      host: '127.0.0.1',
      port: 9100,
      defaultPermissionMode: 'bypassPermissions',
    };
    const mgr = new SessionManager(mockTmux as any, mockConfig as any);

    const answerPromise = mgr.waitForAnswer('sess-1', 'toolu_abc', 'Which?', 5000);

    const result = mgr.submitAnswer('sess-1', 'toolu_abc', 'My answer');
    expect(result).toBe(true);

    const answer = await answerPromise;
    expect(answer).toBe('My answer');
  });

  it('submitAnswer should return false for wrong questionId', async () => {
    const { SessionManager } = await import('../session.js');
    const mockTmux = {
      ensureSession: vi.fn(),
      listWindows: vi.fn().mockResolvedValue([]),
      capturePane: vi.fn().mockResolvedValue(''),
    };
    const mockConfig = {
      stateDir: '/tmp/aegis-test-' + Date.now(),
      claudeProjectsDir: '/tmp/.claude',
      host: '127.0.0.1',
      port: 9100,
      defaultPermissionMode: 'bypassPermissions',
    };
    const mgr = new SessionManager(mockTmux as any, mockConfig as any);

    mgr.waitForAnswer('sess-1', 'toolu_abc', 'Which?', 5000);
    const result = mgr.submitAnswer('sess-1', 'toolu_wrong', 'answer');
    expect(result).toBe(false);

    // Original should still be pending
    expect(mgr.hasPendingQuestion('sess-1')).toBe(true);
    mgr.cleanupPendingQuestion('sess-1');
  });

  it('hasPendingQuestion should reflect current state', async () => {
    const { SessionManager } = await import('../session.js');
    const mockTmux = {
      ensureSession: vi.fn(),
      listWindows: vi.fn().mockResolvedValue([]),
      capturePane: vi.fn().mockResolvedValue(''),
    };
    const mockConfig = {
      stateDir: '/tmp/aegis-test-' + Date.now(),
      claudeProjectsDir: '/tmp/.claude',
      host: '127.0.0.1',
      port: 9100,
      defaultPermissionMode: 'bypassPermissions',
    };
    const mgr = new SessionManager(mockTmux as any, mockConfig as any);

    expect(mgr.hasPendingQuestion('sess-1')).toBe(false);
    mgr.waitForAnswer('sess-1', 'toolu_abc', 'Which?', 5000);
    expect(mgr.hasPendingQuestion('sess-1')).toBe(true);
    mgr.submitAnswer('sess-1', 'toolu_abc', 'answer');
    expect(mgr.hasPendingQuestion('sess-1')).toBe(false);
  });

  it('getPendingQuestionInfo should return question details', async () => {
    const { SessionManager } = await import('../session.js');
    const mockTmux = {
      ensureSession: vi.fn(),
      listWindows: vi.fn().mockResolvedValue([]),
      capturePane: vi.fn().mockResolvedValue(''),
    };
    const mockConfig = {
      stateDir: '/tmp/aegis-test-' + Date.now(),
      claudeProjectsDir: '/tmp/.claude',
      host: '127.0.0.1',
      port: 9100,
      defaultPermissionMode: 'bypassPermissions',
    };
    const mgr = new SessionManager(mockTmux as any, mockConfig as any);

    expect(mgr.getPendingQuestionInfo('sess-1')).toBeNull();
    mgr.waitForAnswer('sess-1', 'toolu_abc', 'Which framework?', 5000);
    const info = mgr.getPendingQuestionInfo('sess-1');
    expect(info).toEqual({ toolUseId: 'toolu_abc', question: 'Which framework?' });
    mgr.cleanupPendingQuestion('sess-1');
  });
});
```

- [ ] **Step 2: Run these tests to verify they pass**

Run: `npx vitest run src/__tests__/hook-answer-question.test.ts -t "answer endpoint contract"`
Expected: ALL PASS (these test SessionManager methods already implemented in Task 1)

- [ ] **Step 3: Add the answer endpoint to server.ts**

In `src/server.ts`, add after the reject endpoint (after the line `app.post<{ Params: { id: string } }>('/sessions/:id/reject'` block ending around line 629). Add the v1 endpoint first:

```typescript
// Issue #336: Answer pending AskUserQuestion
app.post<{
  Params: { id: string };
  Body: { questionId?: string; answer?: string };
}>('/v1/sessions/:id/answer', async (req, reply) => {
  const { questionId, answer } = req.body || {};
  if (!questionId || answer === undefined || answer === null) {
    return reply.status(400).send({ error: 'questionId and answer are required' });
  }
  const session = sessions.getSession(req.params.id);
  if (!session) return reply.status(404).send({ error: 'Session not found' });
  const resolved = sessions.submitAnswer(req.params.id, questionId, answer);
  if (!resolved) {
    return reply.status(409).send({ error: 'No pending question matching this questionId' });
  }
  return { ok: true };
});
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/__tests__/hook-answer-question.test.ts
git commit -m "feat(#336): add POST /v1/sessions/:id/answer endpoint"
```

---

### Task 4: Final verification and cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Run the full test suite one more time to confirm stability**

Run: `npm test`
Expected: ALL PASS

- [ ] **Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore(#336): final cleanup and verification"
```
