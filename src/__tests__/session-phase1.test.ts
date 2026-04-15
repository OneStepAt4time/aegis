/**
 * session-phase1.test.ts — Tests for Issue #1879 Phase 1: session.ts unit tests.
 * Covers: kill error path, escape(), submitAnswer(), getLatencyMetrics(), getSummary()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

function makeSession(overrides: Partial<SessionInfo> & { workDir: string; status: SessionInfo['status'] }): SessionInfo {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    windowId: overrides.windowId ?? '@1',
    windowName: overrides.windowName ?? 'test-session',
    workDir: overrides.workDir,
    claudeSessionId: overrides.claudeSessionId,
    byteOffset: 0,
    monitorOffset: 0,
    status: overrides.status,
    createdAt: overrides.createdAt ?? Date.now() - 60_000,
    lastActivity: overrides.lastActivity ?? Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
  };
}

function createSessionManager(tmuxOverrides: Record<string, unknown> = {}, sessions: SessionInfo[] = []) {
  const tmux = {
    windowExists: vi.fn(async () => true),
    listWindows: vi.fn(async () => []),
    isServerHealthy: vi.fn(async () => ({ healthy: true, error: null })),
    isTmuxServerError: vi.fn(() => false),
    killWindow: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    sendKeysVerified: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    capturePane: vi.fn(async () => ''),
    sendSpecialKey: vi.fn(async () => {}),
    listPanePid: vi.fn(async () => null),
    isPidAlive: vi.fn(() => true),
    ensureSession: vi.fn(async () => {}),
    createWindow: vi.fn(async () => ({ windowId: '@1', windowName: 'cc-test' })),
    killSession: vi.fn(async () => {}),
    getWindowHealth: vi.fn(async () => ({
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
    })),
    ...tmuxOverrides,
  } as any;

  const sm = new SessionManager(tmux, { stateDir: '/tmp/aegis-test-1879' } as any);
  (sm as any).state = { sessions: Object.fromEntries(sessions.map(s => [s.id, s])) };
  return sm;
}

describe('Issue #1879 Phase 1: session.ts unit tests', () => {
  describe('escape()', () => {
    it('should send Escape key to the session window', async () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'working' });
      const sm = createSessionManager({}, [session]);

      await sm.escape(session.id);

      expect(sm['tmux'].sendSpecialKey).toHaveBeenCalledWith(session.windowId, 'Escape');
    });

    it('should throw if session not found', async () => {
      const sm = createSessionManager();

      await expect(sm.escape('nonexistent-id')).rejects.toThrow('Session nonexistent-id not found');
    });
  });

  describe('getLatencyMetrics()', () => {
    it('should return null when session not found', () => {
      const sm = createSessionManager();
      const result = sm.getLatencyMetrics('nonexistent-id');
      expect(result).toBeNull();
    });

    it('should return null hook latency when no hook data', () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'idle' });
      const sm = createSessionManager({}, [session]);

      const result = sm.getLatencyMetrics(session.id);

      expect(result).not.toBeNull();
      expect(result!.hook_latency_ms).toBeNull();
      expect(result!.state_change_detection_ms).toBeNull();
      expect(result!.permission_response_ms).toBeNull();
    });

    it('should calculate hook latency from hook timestamps', () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'working' });
      session.lastHookEventAt = 1000;
      session.lastHookReceivedAt = 1050;
      const sm = createSessionManager({}, [session]);

      const result = sm.getLatencyMetrics(session.id);

      expect(result!.hook_latency_ms).toBe(50);
      expect(result!.state_change_detection_ms).toBe(50);
    });

    it('should return null for negative hook latency (clock skew)', () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'working' });
      session.lastHookEventAt = 1050;
      session.lastHookReceivedAt = 1000; // received before sent = clock skew
      const sm = createSessionManager({}, [session]);

      const result = sm.getLatencyMetrics(session.id);

      expect(result!.hook_latency_ms).toBeNull();
    });

    it('should calculate permission response time', () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'permission_prompt' });
      session.permissionPromptAt = 1000;
      session.permissionRespondedAt = 2500;
      const sm = createSessionManager({}, [session]);

      const result = sm.getLatencyMetrics(session.id);

      expect(result!.permission_response_ms).toBe(1500);
    });
  });

  describe('submitAnswer()', () => {
    it('should return false when no pending question', () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'working' });
      const sm = createSessionManager({}, [session]);

      const result = sm.submitAnswer(session.id, 'some-question-id', 'my answer');

      expect(result).toBe(false);
    });

    it('should return false when question ID does not match', () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'working' });
      const sm = createSessionManager({}, [session]);

      // Manually add a pending question with different ID
      sm['questions'].pendingQuestions.set(session.id, {
        toolUseId: 'correct-id',
        question: 'What?',
        resolve: vi.fn(),
        timer: setTimeout(() => {}, 1000),
      });

      const result = sm.submitAnswer(session.id, 'wrong-id', 'answer');

      expect(result).toBe(false);
    });
  });

  describe('killSession() error path', () => {
    it('should throw when tmux.killWindow fails', async () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'idle' });
      const killError = new Error('tmux session not found');
      const sm = createSessionManager({
        killWindow: vi.fn(async () => { throw killError; }),
      }, [session]);

      await expect(sm.killSession(session.id)).rejects.toThrow('tmux session not found');
    });

    it('should remove session from state after successful kill', async () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'idle' });
      const sm = createSessionManager({}, [session]);

      await sm.killSession(session.id);

      expect((sm as any).state.sessions[session.id]).toBeUndefined();
    });

    it('should call tmux.killWindow with correct windowId', async () => {
      const session = makeSession({ workDir: '/tmp/test', status: 'idle', windowId: '@42' });
      const sm = createSessionManager({}, [session]);

      await sm.killSession(session.id);

      expect(sm['tmux'].killWindow).toHaveBeenCalledWith('@42');
    });
  });

  describe('getSummary()', () => {
    it('should throw if session not found', async () => {
      const sm = createSessionManager();

      await expect(sm.getSummary('nonexistent-id')).rejects.toThrow('Session nonexistent-id not found');
    });
  });
});
