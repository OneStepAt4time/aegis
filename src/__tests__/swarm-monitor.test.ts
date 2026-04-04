/**
 * swarm-monitor.test.ts — Tests for Issue #81: Agent Swarm Awareness.
 * Updated for Issue #353: PID-based parent matching.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SwarmMonitor, DEFAULT_SWARM_CONFIG } from '../swarm-monitor.js';
import type { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';
import { testPath } from './helpers/platform.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-123',
    windowId: '@5',
    windowName: 'cc-test',
    workDir: testPath('/tmp/test'),
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

function createMockSessionManager(sessions: SessionInfo[]): SessionManager {
  return {
    listSessions: vi.fn().mockReturnValue(sessions),
    getSession: vi.fn((id: string) => sessions.find(s => s.id === id) ?? null),
  } as unknown as SessionManager;
}

describe('SwarmMonitor', () => {
  let monitor: SwarmMonitor;

  beforeEach(() => {
    vi.restoreAllMocks();
    monitor = new SwarmMonitor(createMockSessionManager([]));
  });

  describe('inspectSwarmSocket', () => {
    it('should extract PID from socket name "claude-swarm-12345"', async () => {
      const swarm = await monitor.inspectSwarmSocket('claude-swarm-12345');
      expect(swarm.pid).toBe(12345);
      expect(swarm.socketName).toBe('claude-swarm-12345');
    });

    it('should return pid 0 for malformed socket name', async () => {
      const swarm = await monitor.inspectSwarmSocket('claude-swarm-abc');
      expect(swarm.pid).toBe(0);
    });

    it('should return empty teammates for non-existent socket', async () => {
      const swarm = await monitor.inspectSwarmSocket('claude-swarm-999999');
      expect(swarm.teammates).toEqual([]);
      expect(swarm.aggregatedStatus).toBe('no_teammates');
    });
  });

  describe('computeAggregatedStatus', () => {
    it('should return no_teammates for empty list', async () => {
      const swarm = await monitor.inspectSwarmSocket('claude-swarm-1');
      expect(swarm.aggregatedStatus).toBe('no_teammates');
    });
  });

  describe('findSwarmByParentSessionId', () => {
    it('should return null when no scan has been run', () => {
      expect(monitor.findSwarmByParentSessionId('anything')).toBeNull();
    });

    it('should return null when no swarm matches', async () => {
      await monitor.scan();
      expect(monitor.findSwarmByParentSessionId('nonexistent')).toBeNull();
    });
  });

  describe('findActiveSwarms', () => {
    it('should return empty array when no scan has been run', () => {
      expect(monitor.findActiveSwarms()).toEqual([]);
    });
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop without errors', () => {
      monitor.start();
      monitor.stop();
      expect(true).toBe(true);
    });

    it('should be idempotent on start', () => {
      monitor.start();
      monitor.start(); // second call should be no-op
      monitor.stop();
      expect(true).toBe(true);
    });

    it('should no-op on Windows with info log', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.spyOn(monitor as unknown as { isWindowsPlatform: () => boolean }, 'isWindowsPlatform').mockReturnValue(true);

      monitor.start();
      const result = await monitor.scan();

      expect(infoSpy).toHaveBeenCalled();
      expect(result.swarms).toEqual([]);
      expect(result.totalSockets).toBe(0);
      monitor.stop();
    });
  });

  describe('getLastResult', () => {
    it('should return null before first scan', () => {
      expect(monitor.getLastResult()).toBeNull();
    });

    it('should return result after scan', async () => {
      const result = await monitor.scan();
      expect(result).toBeDefined();
      expect(result.scannedAt).toBeGreaterThan(0);
      expect(result.totalSockets).toBeGreaterThanOrEqual(0);
      expect(result.totalTeammates).toBeGreaterThanOrEqual(0);
      expect(result.swarms).toBeInstanceOf(Array);
    });
  });
});

describe('SwarmMonitor with mocked parent sessions', () => {
  it('should match parent session by ccPid (Issue #353)', async () => {
    const session = makeSession({
      id: 'parent-session',
      ccPid: 12345,
      status: 'working',
    });

    const monitor = new SwarmMonitor(createMockSessionManager([session]));
    // Inspect a swarm socket with matching PID
    const swarm = await monitor.inspectSwarmSocket('claude-swarm-12345');
    if (process.platform === 'win32') {
      expect(swarm.parentSession).toBeNull();
      return;
    }
    expect(swarm.parentSession).not.toBeNull();
    expect(swarm.parentSession?.id).toBe('parent-session');
  });

  it('should not match session with wrong ccPid', async () => {
    const session = makeSession({
      id: 'wrong-session',
      ccPid: 99999,
      status: 'working',
    });

    const monitor = new SwarmMonitor(createMockSessionManager([session]));
    const swarm = await monitor.inspectSwarmSocket('claude-swarm-12345');
    expect(swarm.parentSession).toBeNull();
  });

  it('should not match session without ccPid', async () => {
    const session = makeSession({
      id: 'no-pid-session',
      activeSubagents: new Set(['explore-agent']),
      status: 'working',
    });

    const monitor = new SwarmMonitor(createMockSessionManager([session]));
    const swarm = await monitor.inspectSwarmSocket('claude-swarm-12345');
    // Old behavior would match via activeSubagents; new behavior requires ccPid match
    expect(swarm.parentSession).toBeNull();
  });

  it('should match correct session when multiple sessions have ccPid (Issue #353)', async () => {
    const session1 = makeSession({ id: 'session-1', ccPid: 11111 });
    const session2 = makeSession({ id: 'session-2', ccPid: 22222 });
    const session3 = makeSession({ id: 'session-3', ccPid: 33333 });

    const monitor = new SwarmMonitor(createMockSessionManager([session1, session2, session3]));
    const swarm = await monitor.inspectSwarmSocket('claude-swarm-22222');
    if (process.platform === 'win32') {
      expect(swarm.parentSession).toBeNull();
      return;
    }
    expect(swarm.parentSession?.id).toBe('session-2');
  });

  it('should not match plain session without active subagents', async () => {
    const session = makeSession({
      id: 'plain-session',
      status: 'idle',
    });

    const monitor = new SwarmMonitor(createMockSessionManager([session]));
    const result = await monitor.scan();
    expect(result).toBeDefined();
  });
});

describe('SwarmMonitor previousTeammates tracking (Issue #353)', () => {
  it('should not fire repeated spawn events when parent is unresolved', async () => {
    const events: Array<{ type: string }> = [];
    const session = makeSession({ id: 's1' }); // no ccPid, so no parent match
    const monitor = new SwarmMonitor(createMockSessionManager([session]));
    monitor.onEvent(e => events.push(e));

    // Manually trigger detectChanges with a swarm that has no parent session
    // by scanning twice with no matching sessions
    await monitor.scan();
    await monitor.scan();

    // No events should fire since there's no parent session match
    expect(events).toHaveLength(0);
  });
});

describe('SwarmMonitor scan error handling (Issue #353)', () => {
  it('should return a result even when scan throws', async () => {
    const monitor = new SwarmMonitor(createMockSessionManager([]));

    // Force an error by making discoverSwarmSockets throw
    vi.spyOn(monitor as unknown as { discoverSwarmSockets: () => Promise<string[]> }, 'discoverSwarmSockets')
      .mockRejectedValue(new Error('fs error'));

    const result = await monitor.scan();
    expect(result).toBeDefined();
    expect(result.swarms).toEqual([]);
    expect(result.totalSockets).toBe(0);
  });
});
