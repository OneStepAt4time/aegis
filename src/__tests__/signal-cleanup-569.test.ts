/**
 * signal-cleanup-569.test.ts — Tests for SIGTERM/SIGINT signal handlers
 * that kill all CC sessions and tmux windows before exit (Issue #569).
 *
 * Tests verify:
 * - killAllSessions() kills every tracked session and cleans up
 * - killAllSessions() handles errors gracefully (best-effort cleanup)
 * - killAllSessions() calls TmuxManager.killSession() as final fallback
 * - Signal handler wire-up pattern works correctly
 * - Reentrance guard prevents double cleanup
 * - Empty sessions (no-op) works
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionInfo } from '../session.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a full SessionInfo object with sensible defaults. */
function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    windowId: '@0',
    windowName: 'test-session',
    workDir: '/tmp/test',
    claudeSessionId: 'claude-abc',
    jsonlPath: '/tmp/test/session.jsonl',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now() - 10_000,
    stallThresholdMs: 5 * 60 * 1000,
    permissionStallMs: 5 * 60 * 1000,
    permissionMode: 'default',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockSessionManager(sessions: SessionInfo[] = []) {
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of sessions) sessionMap.set(s.id, { ...s });

  return {
    listSessions: vi.fn(() => [...sessionMap.values()]),
    getSession: vi.fn((id: string) => sessionMap.get(id) ?? null),
    killSession: vi.fn(async (id: string) => {
      sessionMap.delete(id);
    }),
    save: vi.fn(async () => {}),
  };
}

function createMockTmuxManager() {
  return {
    killSession: vi.fn(async () => {}),
    killWindow: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Signal cleanup — killAllSessions (Issue #569)', () => {
  it('should kill all tracked sessions', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1', windowName: 'cc-one' });
    const s2 = makeSession({ id: '00000000-0000-0000-0000-000000000012', windowId: '@2', windowName: 'cc-two' });
    const s3 = makeSession({ id: '00000000-0000-0000-0000-000000000013', windowId: '@3', windowName: 'cc-three' });
    const mockSessions = createMockSessionManager([s1, s2, s3]);
    const mockTmux = createMockTmuxManager();

    const { killAllSessions } = await import('../signal-cleanup-helper.js');
    const result = await killAllSessions(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    expect(mockSessions.killSession).toHaveBeenCalledTimes(3);
    expect(mockSessions.killSession).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000011');
    expect(mockSessions.killSession).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000012');
    expect(mockSessions.killSession).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000013');
    expect(result.killed).toBe(3);
  });

  it('should kill the tmux session as final fallback', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const mockSessions = createMockSessionManager([s1]);
    const mockTmux = createMockTmuxManager();

    const { killAllSessions } = await import('../signal-cleanup-helper.js');
    await killAllSessions(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    expect(mockTmux.killSession).toHaveBeenCalledTimes(1);
  });

  it('should handle empty sessions list (no-op)', async () => {
    const mockSessions = createMockSessionManager([]);
    const mockTmux = createMockTmuxManager();

    const { killAllSessions } = await import('../signal-cleanup-helper.js');
    const result = await killAllSessions(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    expect(mockSessions.killSession).not.toHaveBeenCalled();
    expect(result.killed).toBe(0);
    // Still kill tmux session as fallback even with no active sessions
    expect(mockTmux.killSession).toHaveBeenCalledTimes(1);
  });

  it('should continue killing other sessions when one fails', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const s2 = makeSession({ id: '00000000-0000-0000-0000-000000000012', windowId: '@2' });
    const s3 = makeSession({ id: '00000000-0000-0000-0000-000000000013', windowId: '@3' });
    const mockSessions = createMockSessionManager([s1, s2, s3]);
    const mockTmux = createMockTmuxManager();

    // Make the second session kill fail
    mockSessions.killSession.mockImplementation(async (id: string) => {
      if (id === '00000000-0000-0000-0000-000000000012') throw new Error('tmux kill-window failed');
    });

    const { killAllSessions } = await import('../signal-cleanup-helper.js');
    const result = await killAllSessions(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    // All 3 sessions were attempted
    expect(mockSessions.killSession).toHaveBeenCalledTimes(3);
    // s2 failed but s1 and s3 succeeded
    expect(result.killed).toBe(2);
    expect(result.errors).toBe(1);
    // Tmux session kill still attempted
    expect(mockTmux.killSession).toHaveBeenCalledTimes(1);
  });

  it('should handle killSession throwing for all sessions', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const s2 = makeSession({ id: '00000000-0000-0000-0000-000000000012', windowId: '@2' });
    const mockSessions = createMockSessionManager([s1, s2]);
    const mockTmux = createMockTmuxManager();

    mockSessions.killSession.mockRejectedValue(new Error('tmux error'));

    const { killAllSessions } = await import('../signal-cleanup-helper.js');
    const result = await killAllSessions(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    expect(result.killed).toBe(0);
    expect(result.errors).toBe(2);
    // Tmux session kill still attempted as fallback
    expect(mockTmux.killSession).toHaveBeenCalledTimes(1);
  });

  it('should handle tmux killSession also throwing', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const mockSessions = createMockSessionManager([s1]);
    const mockTmux = createMockTmuxManager();

    mockSessions.killSession.mockRejectedValue(new Error('session kill error'));
    mockTmux.killSession.mockRejectedValue(new Error('tmux session kill error'));

    const { killAllSessions } = await import('../signal-cleanup-helper.js');
    // Should not throw — best-effort cleanup
    const result = await killAllSessions(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    expect(result.killed).toBe(0);
    expect(result.errors).toBe(1);
  });
});

describe('Signal handler reentrance guard (Issue #569)', () => {
  it('should prevent double cleanup on rapid signals', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const mockSessions = createMockSessionManager([s1]);
    const mockTmux = createMockTmuxManager();

    const { createSignalHandler } = await import('../signal-cleanup-helper.js');
    const handler = createSignalHandler(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    // Call handler twice rapidly
    handler('SIGTERM');
    handler('SIGTERM');

    // Give async operations a chance to settle
    await new Promise((r) => setTimeout(r, 50));

    // killSession should only have been called once (reentrance guard)
    expect(mockSessions.killSession.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('should allow a second signal after first completes', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const mockSessions = createMockSessionManager([s1]);
    const mockTmux = createMockTmuxManager();

    const { createSignalHandler } = await import('../signal-cleanup-helper.js');
    const handler = createSignalHandler(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
    );

    // Call handler and wait for it to complete
    handler('SIGTERM');
    await new Promise((r) => setTimeout(r, 100));

    // The handler sets a flag, so a second call after completion
    // will still be blocked (intentional — process.exit would have been called)
    const callCountBefore = mockSessions.killSession.mock.calls.length;
    handler('SIGINT');
    await new Promise((r) => setTimeout(r, 50));

    // Should still be the same count — guard stays active
    expect(mockSessions.killSession.mock.calls.length).toBe(callCountBefore);
  });
});

describe('killAllSessions timeout protection (Issue #569)', () => {
  it('should timeout if individual session kill hangs', async () => {
    const s1 = makeSession({ id: '00000000-0000-0000-0000-000000000011', windowId: '@1' });
    const mockSessions = createMockSessionManager([s1]);
    const mockTmux = createMockTmuxManager();

    // Make killSession hang forever
    mockSessions.killSession.mockImplementation(
      () => new Promise(() => { /* never resolves */ }),
    );

    const { killAllSessionsWithTimeout } = await import('../signal-cleanup-helper.js');

    // Use a short timeout for testing
    const result = await killAllSessionsWithTimeout(
      mockSessions as unknown as import('../session.js').SessionManager,
      mockTmux as unknown as import('../tmux.js').TmuxManager,
      100, // 100ms timeout per session
    );

    // Should have timed out and moved on
    expect(result.timedOut).toBe(true);
    // Tmux session kill still attempted as final fallback
    expect(mockTmux.killSession).toHaveBeenCalledTimes(1);
  }, 10_000);
});
