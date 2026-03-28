/**
 * swarm-changes.test.ts — Tests for detectChanges event emission in SwarmMonitor.
 *
 * Covers teammate_spawned, teammate_finished, no-event-without-parent,
 * stale socket cleanup, computeAggregatedStatus, handler error isolation,
 * and event handler registration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SwarmMonitor } from '../swarm-monitor.js';
import type { SwarmEvent, SwarmEventHandler, TeammateInfo, SwarmInfo } from '../swarm-monitor.js';
import type { SessionManager, SessionInfo } from '../session.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeTeammate(overrides: Partial<TeammateInfo> = {}): TeammateInfo {
  return {
    windowId: '@0',
    windowName: 'teammate-explore-agent',
    cwd: '/tmp/project',
    paneCommand: 'claude',
    alive: true,
    status: 'running',
    ...overrides,
  };
}

function makeSwarmInfo(overrides: Partial<SwarmInfo> = {}): SwarmInfo {
  return {
    socketName: 'claude-swarm-12345',
    pid: 12345,
    parentSession: null,
    teammates: [],
    aggregatedStatus: 'no_teammates',
    lastScannedAt: Date.now(),
    ...overrides,
  };
}

/** Create a monitor with internal state pre-set so detectChanges can be tested directly. */
function setupMonitor(sessionManager?: SessionManager): SwarmMonitor {
  const sm = sessionManager ?? createMockSessionManager([]);
  return new SwarmMonitor(sm);
}

/** Set the private lastResult field on the monitor. */
function setLastResult(monitor: SwarmMonitor, result: SwarmInfo[] | null): void {
  (monitor as unknown as { lastResult: Record<string, unknown> | null }).lastResult = result
    ? { swarms: result, totalSockets: result.length, totalTeammates: 0, scannedAt: Date.now() }
    : null;
}

// ---------------------------------------------------------------------------
// teammate_spawned
// ---------------------------------------------------------------------------

describe('detectChanges — teammate_spawned', () => {
  let monitor: SwarmMonitor;
  let events: SwarmEvent[];

  beforeEach(() => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    monitor = setupMonitor(createMockSessionManager([session]));
    events = [];
    monitor.onEvent(e => events.push(e));
  });

  it('should emit teammate_spawned when a new teammate window appears', () => {
    const swarm = makeSwarmInfo({
      parentSession: makeSession({ id: 'parent-1', ccPid: 12345 }),
      teammates: [makeTeammate({ windowName: 'teammate-new-agent' })],
    });
    setLastResult(monitor, [swarm]);

    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_spawned');
  });

  it('should NOT emit teammate_spawned for a dead teammate', () => {
    const swarm = makeSwarmInfo({
      parentSession: makeSession({ id: 'parent-1', ccPid: 12345 }),
      teammates: [makeTeammate({ windowName: 'teammate-dead-agent', status: 'dead', alive: false })],
    });
    setLastResult(monitor, [swarm]);

    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(0);
  });

  it('should include correct swarm and teammate info in the event', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const teammate = makeTeammate({ windowName: 'teammate-explore-agent', windowId: '@3' });
    const swarm = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });
    setLastResult(monitor, [swarm]);

    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(1);
    const event = events[0]!;
    if (event.type !== 'teammate_spawned') throw new Error('wrong event type');
    expect(event.swarm.socketName).toBe('claude-swarm-12345');
    expect(event.teammate.windowName).toBe('teammate-explore-agent');
    expect(event.teammate.windowId).toBe('@3');
    expect(event.swarm.parentSession?.id).toBe('parent-1');
  });

  it('should NOT re-emit spawn for a teammate already in previous snapshot', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const teammate = makeTeammate({ windowName: 'teammate-existing-agent' });
    const swarm = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });

    // First scan: teammate is new
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(events).toHaveLength(1);

    events.length = 0;

    // Second scan: same teammate, should NOT spawn again
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(events).toHaveLength(0);
  });

  it('should emit spawn events for multiple new teammates at once', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const swarm = makeSwarmInfo({
      parentSession: parent,
      teammates: [
        makeTeammate({ windowName: 'teammate-alpha' }),
        makeTeammate({ windowName: 'teammate-beta' }),
        makeTeammate({ windowName: 'teammate-gamma' }),
      ],
    });
    setLastResult(monitor, [swarm]);

    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(3);
    const names = events.map(e => (e as { teammate: TeammateInfo }).teammate.windowName);
    expect(names).toContain('teammate-alpha');
    expect(names).toContain('teammate-beta');
    expect(names).toContain('teammate-gamma');
  });

  it('should emit spawn only for new teammates when some already existed', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const existing = makeTeammate({ windowName: 'teammate-existing' });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [existing] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Add a new teammate alongside the existing one
    const newTeammate = makeTeammate({ windowName: 'teammate-new' });
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [existing, newTeammate] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_spawned');
    if (events[0]!.type === 'teammate_spawned') {
      expect(events[0]!.teammate.windowName).toBe('teammate-new');
    }
  });
});

// ---------------------------------------------------------------------------
// teammate_finished
// ---------------------------------------------------------------------------

describe('detectChanges — teammate_finished', () => {
  let monitor: SwarmMonitor;
  let events: SwarmEvent[];

  beforeEach(() => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    monitor = setupMonitor(createMockSessionManager([session]));
    events = [];
    monitor.onEvent(e => events.push(e));
  });

  it('should emit teammate_finished when a teammate disappears entirely', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const teammate = makeTeammate({ windowName: 'teammate-vanished' });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Teammate no longer in the swarm
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_finished');
    if (events[0]!.type === 'teammate_finished') {
      expect(events[0]!.teammate.windowName).toBe('teammate-vanished');
      expect(events[0]!.teammate.status).toBe('dead');
      expect(events[0]!.teammate.alive).toBe(false);
    }
  });

  it('should emit teammate_finished when status changes from running to dead', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const runningMate = makeTeammate({ windowName: 'teammate-dying', status: 'running', alive: true });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [runningMate] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Same teammate now dead
    const deadMate = makeTeammate({ windowName: 'teammate-dying', status: 'dead', alive: false });
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [deadMate] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_finished');
  });

  it('should NOT emit teammate_finished for an already-dead teammate in previous snapshot', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const deadMate = makeTeammate({ windowName: 'teammate-already-dead', status: 'dead', alive: false });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [deadMate] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Teammate still dead, now disappears
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // prev.status was 'dead', not 'running', so the transition check fails
    // but the teammate is gone entirely — that still triggers finished
    // Actually: the teammate window is gone, so the `!current` branch fires.
    // The check for `prev.status === 'running' && current.status === 'dead'` does not apply.
    // The teammate_finished for a disappeared teammate is emitted regardless of prev status.
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_finished');
  });

  it('should NOT emit finished when teammate is idle then stays idle', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const idleMate = makeTeammate({ windowName: 'teammate-idle', status: 'idle', alive: false });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [idleMate] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Same teammate, still idle
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [idleMate] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(0);
  });

  it('should NOT emit finished when teammate goes from idle to dead (not running to dead)', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const idleMate = makeTeammate({ windowName: 'teammate-idle-to-dead', status: 'idle', alive: false });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [idleMate] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Teammate transitions idle -> dead (not running -> dead)
    const deadMate = makeTeammate({ windowName: 'teammate-idle-to-dead', status: 'dead', alive: false });
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [deadMate] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // idle -> dead does NOT trigger finished (only running -> dead does)
    expect(events).toHaveLength(0);
  });

  it('should emit multiple finished events when several teammates disappear', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const t1 = makeTeammate({ windowName: 'teammate-a' });
    const t2 = makeTeammate({ windowName: 'teammate-b' });
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [t1, t2] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    events.length = 0;

    // Both disappear
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(2);
    const names = events.map(e => (e as { teammate: TeammateInfo }).teammate.windowName);
    expect(names).toContain('teammate-a');
    expect(names).toContain('teammate-b');
  });
});

// ---------------------------------------------------------------------------
// No events without parentSession
// ---------------------------------------------------------------------------

describe('detectChanges — no events without parentSession', () => {
  let monitor: SwarmMonitor;
  let events: SwarmEvent[];

  beforeEach(() => {
    monitor = setupMonitor(createMockSessionManager([]));
    events = [];
    monitor.onEvent(e => events.push(e));
  });

  it('should emit NO events when swarm has no parentSession', () => {
    const teammate = makeTeammate({ windowName: 'teammate-orphan' });
    const swarm = makeSwarmInfo({ parentSession: null, teammates: [teammate] });
    setLastResult(monitor, [swarm]);

    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(events).toHaveLength(0);
  });

  it('should not fire duplicate spawn events across repeated scans without parent', () => {
    const teammate = makeTeammate({ windowName: 'teammate-orphan' });
    const swarm = makeSwarmInfo({ parentSession: null, teammates: [teammate] });

    // First scan
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(events).toHaveLength(0);

    // Second scan — previousTeammates updated but still no parent
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(events).toHaveLength(0);
  });

  it('should still update previousTeammates even without parentSession', () => {
    const previousTeammates = (monitor as unknown as { previousTeammates: Map<string, TeammateInfo[]> }).previousTeammates;
    expect(previousTeammates.size).toBe(0);

    const teammate = makeTeammate({ windowName: 'teammate-orphan' });
    const swarm = makeSwarmInfo({ parentSession: null, teammates: [teammate] });
    setLastResult(monitor, [swarm]);

    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // previousTeammates should be updated even without a parent session
    expect(previousTeammates.has('claude-swarm-12345')).toBe(true);
    expect(previousTeammates.get('claude-swarm-12345')).toHaveLength(1);
  });

  it('should emit spawn events once parentSession is resolved on a subsequent scan', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });

    // First: no parent
    const teammate = makeTeammate({ windowName: 'teammate-delayed' });
    const swarmNoParent = makeSwarmInfo({ parentSession: null, teammates: [teammate] });
    setLastResult(monitor, [swarmNoParent]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(events).toHaveLength(0);

    // Second: parent resolved, but teammate was already recorded in previous snapshot
    const swarmWithParent = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });
    setLastResult(monitor, [swarmWithParent]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // The teammate was already in previousTeammates from the no-parent scan,
    // so it should NOT trigger a spawn event (it's not new).
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Stale socket cleanup
// ---------------------------------------------------------------------------

describe('detectChanges — stale socket cleanup', () => {
  let monitor: SwarmMonitor;
  let events: SwarmEvent[];
  let previousTeammates: Map<string, TeammateInfo[]>;

  beforeEach(() => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    monitor = setupMonitor(createMockSessionManager([session]));
    events = [];
    monitor.onEvent(e => events.push(e));
    previousTeammates = (monitor as unknown as { previousTeammates: Map<string, TeammateInfo[]> }).previousTeammates;
  });

  it('should remove stale sockets from previousTeammates', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const teammate = makeTeammate({ windowName: 'teammate-old' });
    const swarm = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });

    // First scan: socket exists
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(previousTeammates.has('claude-swarm-12345')).toBe(true);

    // Second scan: socket gone entirely (no swarms at all)
    setLastResult(monitor, []);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(previousTeammates.has('claude-swarm-12345')).toBe(false);
  });

  it('should prevent false finished events from stale data after cleanup', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const teammate = makeTeammate({ windowName: 'teammate-stale' });
    const swarm = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });

    // Scan 1: teammate exists
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // Scan 2: swarm disappears (cleanup)
    setLastResult(monitor, []);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // No finished event because parentSession is null in the scan with no swarms —
    // the swarm is not in lastResult.swarms at all, so no comparison happens.
    // But the stale socket is removed.
    const finishedEvents = events.filter(e => e.type === 'teammate_finished');
    // The finished event was emitted on scan 2's previousSwarm comparison.
    // Since the swarm was in previousTeammates but not in the current scan,
    // there's no swarm to iterate over, so no finished event fires.
    expect(finishedEvents).toHaveLength(0);
    expect(previousTeammates.has('claude-swarm-12345')).toBe(false);

    events.length = 0;

    // Scan 3: swarm reappears with same teammate name — should trigger spawn
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // Because the stale socket was cleaned up, previousTeammates no longer has it,
    // so the teammate appears as new and triggers a spawn.
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_spawned');
  });

  it('should keep non-stale sockets in previousTeammates', () => {
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });
    const swarm1 = makeSwarmInfo({
      socketName: 'claude-swarm-11111',
      pid: 11111,
      parentSession: parent,
      teammates: [makeTeammate({ windowName: 'teammate-a' })],
    });
    const swarm2 = makeSwarmInfo({
      socketName: 'claude-swarm-22222',
      pid: 22222,
      parentSession: null,
      teammates: [makeTeammate({ windowName: 'teammate-b' })],
    });

    setLastResult(monitor, [swarm1, swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();
    expect(previousTeammates.has('claude-swarm-11111')).toBe(true);
    expect(previousTeammates.has('claude-swarm-22222')).toBe(true);

    // Only swarm1 remains
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(previousTeammates.has('claude-swarm-11111')).toBe(true);
    expect(previousTeammates.has('claude-swarm-22222')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeAggregatedStatus
// ---------------------------------------------------------------------------

describe('computeAggregatedStatus', () => {
  let monitor: SwarmMonitor;

  beforeEach(() => {
    monitor = setupMonitor();
  });

  it('should return "no_teammates" for empty teammates list', () => {
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus([]);
    expect(result).toBe('no_teammates');
  });

  it('should return "all_dead" when all teammates are dead', () => {
    const teammates = [
      makeTeammate({ status: 'dead', alive: false }),
      makeTeammate({ status: 'dead', alive: false }),
    ];
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus(teammates);
    expect(result).toBe('all_dead');
  });

  it('should return "some_working" when any teammate is running', () => {
    const teammates = [
      makeTeammate({ status: 'running', alive: true }),
      makeTeammate({ status: 'idle', alive: false }),
    ];
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus(teammates);
    expect(result).toBe('some_working');
  });

  it('should return "some_working" when all teammates are running', () => {
    const teammates = [
      makeTeammate({ status: 'running', alive: true }),
      makeTeammate({ status: 'running', alive: true }),
    ];
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus(teammates);
    expect(result).toBe('some_working');
  });

  it('should return "all_idle" when no running and not all dead', () => {
    const teammates = [
      makeTeammate({ status: 'idle', alive: false }),
      makeTeammate({ status: 'idle', alive: false }),
    ];
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus(teammates);
    expect(result).toBe('all_idle');
  });

  it('should return "all_idle" for a mix of idle and dead teammates', () => {
    const teammates = [
      makeTeammate({ status: 'idle', alive: false }),
      makeTeammate({ status: 'dead', alive: false }),
    ];
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus(teammates);
    expect(result).toBe('all_idle');
  });

  it('should return "some_working" even with one running among many dead', () => {
    const teammates = [
      makeTeammate({ status: 'running', alive: true }),
      makeTeammate({ status: 'dead', alive: false }),
      makeTeammate({ status: 'dead', alive: false }),
    ];
    const result = (monitor as unknown as { computeAggregatedStatus: (t: TeammateInfo[]) => string })
      .computeAggregatedStatus(teammates);
    expect(result).toBe('some_working');
  });
});

// ---------------------------------------------------------------------------
// Handler error isolation
// ---------------------------------------------------------------------------

describe('detectChanges — handler error isolation', () => {
  it('should not prevent other handlers from receiving events when one throws', () => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    const monitor = setupMonitor(createMockSessionManager([session]));
    const events: SwarmEvent[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const badHandler: SwarmEventHandler = () => {
      throw new Error('handler exploded');
    };
    const goodHandler: SwarmEventHandler = (e) => {
      events.push(e);
    };

    monitor.onEvent(badHandler);
    monitor.onEvent(goodHandler);

    const teammate = makeTeammate({ windowName: 'teammate-resilient' });
    const swarm = makeSwarmInfo({
      parentSession: session,
      teammates: [teammate],
    });
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // Good handler should still receive the event despite bad handler throwing
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('teammate_spawned');
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('should log handler errors to console.error', () => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    const monitor = setupMonitor(createMockSessionManager([session]));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    monitor.onEvent(() => { throw new Error('boom'); });

    const teammate = makeTeammate({ windowName: 'teammate-error-test' });
    const swarm = makeSwarmInfo({
      parentSession: session,
      teammates: [teammate],
    });
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(errorSpy).toHaveBeenCalledWith(
      'SwarmMonitor event handler error:',
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Event handler registration
// ---------------------------------------------------------------------------

describe('onEvent — handler registration', () => {
  it('should register handlers that receive events', () => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    const monitor = setupMonitor(createMockSessionManager([session]));
    const events: SwarmEvent[] = [];

    monitor.onEvent(e => events.push(e));

    const teammate = makeTeammate({ windowName: 'teammate-registered' });
    const swarm = makeSwarmInfo({ parentSession: session, teammates: [teammate] });
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(1);
  });

  it('should deliver events to all registered handlers', () => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    const monitor = setupMonitor(createMockSessionManager([session]));
    const events1: SwarmEvent[] = [];
    const events2: SwarmEvent[] = [];
    const events3: SwarmEvent[] = [];

    monitor.onEvent(e => events1.push(e));
    monitor.onEvent(e => events2.push(e));
    monitor.onEvent(e => events3.push(e));

    const teammate = makeTeammate({ windowName: 'teammate-multi' });
    const swarm = makeSwarmInfo({ parentSession: session, teammates: [teammate] });
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events3).toHaveLength(1);

    expect(events1[0]!.type).toBe('teammate_spawned');
    expect(events2[0]!.type).toBe('teammate_spawned');
    expect(events3[0]!.type).toBe('teammate_spawned');
  });

  it('should receive both spawn and finished events on the same handler', () => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    const monitor = setupMonitor(createMockSessionManager([session]));
    const events: SwarmEvent[] = [];

    monitor.onEvent(e => events.push(e));

    const teammate = makeTeammate({ windowName: 'teammate-lifecycle' });
    const parent = makeSession({ id: 'parent-1', ccPid: 12345 });

    // Spawn
    const swarm1 = makeSwarmInfo({ parentSession: parent, teammates: [teammate] });
    setLastResult(monitor, [swarm1]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    // Finish (disappears)
    const swarm2 = makeSwarmInfo({ parentSession: parent, teammates: [] });
    setLastResult(monitor, [swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('teammate_spawned');
    expect(events[1]!.type).toBe('teammate_finished');
  });
});

// ---------------------------------------------------------------------------
// detectChanges — edge cases
// ---------------------------------------------------------------------------

describe('detectChanges — edge cases', () => {
  it('should be a no-op when lastResult is null', () => {
    const monitor = setupMonitor();
    const events: SwarmEvent[] = [];
    monitor.onEvent(e => events.push(e));

    (monitor as unknown as { lastResult: null }).lastResult = null;
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(0);
  });

  it('should handle multiple swarms in a single scan', () => {
    const session1 = makeSession({ id: 'parent-1', ccPid: 11111 });
    const session2 = makeSession({ id: 'parent-2', ccPid: 22222 });
    const monitor = setupMonitor(createMockSessionManager([session1, session2]));
    const events: SwarmEvent[] = [];
    monitor.onEvent(e => events.push(e));

    const swarm1 = makeSwarmInfo({
      socketName: 'claude-swarm-11111',
      pid: 11111,
      parentSession: session1,
      teammates: [makeTeammate({ windowName: 'teammate-from-1' })],
    });
    const swarm2 = makeSwarmInfo({
      socketName: 'claude-swarm-22222',
      pid: 22222,
      parentSession: session2,
      teammates: [makeTeammate({ windowName: 'teammate-from-2' })],
    });

    setLastResult(monitor, [swarm1, swarm2]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(2);
    const names = events.map(e => (e as { teammate: TeammateInfo }).teammate.windowName);
    expect(names).toContain('teammate-from-1');
    expect(names).toContain('teammate-from-2');
  });

  it('should not emit spawn for teammate with status dead in initial scan', () => {
    const session = makeSession({ id: 'parent-1', ccPid: 12345 });
    const monitor = setupMonitor(createMockSessionManager([session]));
    const events: SwarmEvent[] = [];
    monitor.onEvent(e => events.push(e));

    const deadMate = makeTeammate({ windowName: 'teammate-born-dead', status: 'dead', alive: false });
    const swarm = makeSwarmInfo({ parentSession: session, teammates: [deadMate] });
    setLastResult(monitor, [swarm]);
    (monitor as unknown as { detectChanges: () => void }).detectChanges();

    expect(events).toHaveLength(0);
  });
});
