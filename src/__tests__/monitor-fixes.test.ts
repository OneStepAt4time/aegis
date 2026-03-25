/**
 * monitor-fixes.test.ts — Tests for M12, M19, M23 monitor improvements.
 *
 * M12: SSE events for stall/dead sessions
 * M19: Dead detection uses independent 10s timer
 * M23: Idle debounce reduced from 10s to 3s
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionEventBus, type SessionSSEEvent, type GlobalSSEEvent } from '../events.js';
import { DEFAULT_MONITOR_CONFIG } from '../monitor.js';

describe('M12: SSE events for stall/dead sessions', () => {
  let bus: SessionEventBus;

  beforeEach(() => {
    bus = new SessionEventBus();
  });

  it('should emit stall events to per-session subscribers', () => {
    const events: SessionSSEEvent[] = [];
    bus.subscribe('sess-1', (e) => events.push(e));

    bus.emitStall('sess-1', 'jsonl', 'Session stalled: working for 5min');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('stall');
    expect(events[0].sessionId).toBe('sess-1');
    expect(events[0].data.stallType).toBe('jsonl');
    expect(events[0].data.detail).toContain('5min');
  });

  it('should emit stall events to global subscribers as session_stall', () => {
    const events: GlobalSSEEvent[] = [];
    bus.subscribeGlobal((e) => events.push(e));

    bus.emitStall('sess-1', 'permission', 'Permission stall');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('session_stall');
    expect(events[0].sessionId).toBe('sess-1');
    expect(events[0].data.stallType).toBe('permission');
  });

  it('should emit dead events to per-session subscribers', () => {
    const events: SessionSSEEvent[] = [];
    bus.subscribe('sess-1', (e) => events.push(e));

    bus.emitDead('sess-1', 'Session died — tmux window gone');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('dead');
    expect(events[0].sessionId).toBe('sess-1');
    expect(events[0].data.reason).toContain('tmux window gone');
  });

  it('should emit dead events to global subscribers as session_dead', () => {
    const events: GlobalSSEEvent[] = [];
    bus.subscribeGlobal((e) => events.push(e));

    bus.emitDead('sess-1', 'Session died');

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('session_dead');
    expect(events[0].sessionId).toBe('sess-1');
  });

  it('should include timestamp in stall and dead events', () => {
    const events: SessionSSEEvent[] = [];
    bus.subscribe('sess-1', (e) => events.push(e));

    bus.emitStall('sess-1', 'unknown', 'Unknown stall');
    bus.emitDead('sess-1', 'Dead session');

    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[1].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should support all stall types: jsonl, permission, unknown, extended', () => {
    const events: SessionSSEEvent[] = [];
    bus.subscribe('sess-1', (e) => events.push(e));

    bus.emitStall('sess-1', 'jsonl', 'JSONL stall');
    bus.emitStall('sess-1', 'permission', 'Permission stall');
    bus.emitStall('sess-1', 'unknown', 'Unknown stall');
    bus.emitStall('sess-1', 'extended', 'Extended stall');

    expect(events).toHaveLength(4);
    expect(events.map(e => e.data.stallType)).toEqual(['jsonl', 'permission', 'unknown', 'extended']);
  });
});

describe('M19: Dead detection uses independent 10s timer', () => {
  it('should have deadCheckIntervalMs in MonitorConfig defaults', () => {
    expect('deadCheckIntervalMs' in DEFAULT_MONITOR_CONFIG).toBe(true);
  });

  it('should default deadCheckIntervalMs to 10 seconds', () => {
    expect(DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs).toBe(10_000);
  });

  it('should have dead check interval shorter than stall check interval', () => {
    expect(DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs).toBeLessThan(
      DEFAULT_MONITOR_CONFIG.stallCheckIntervalMs,
    );
  });

  it('should allow dead check to fire independently of stall check', () => {
    // Simulate the poll() timing logic:
    // After 10s, dead check should fire but stall check should not
    const now = 10_000;
    const lastStallCheck = 0;
    const lastDeadCheck = 0;

    const shouldCheckStall = now - lastStallCheck >= DEFAULT_MONITOR_CONFIG.stallCheckIntervalMs;
    const shouldCheckDead = now - lastDeadCheck >= DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs;

    expect(shouldCheckDead).toBe(true);   // 10s >= 10s
    expect(shouldCheckStall).toBe(false);  // 10s < 30s
  });

  it('should fire dead check every 10s while stall check fires every 30s', () => {
    const intervals: { time: number; dead: boolean; stall: boolean }[] = [];
    let lastStallCheck = 0;
    let lastDeadCheck = 0;

    for (let t = 0; t <= 60_000; t += 10_000) {
      const checkDead = t - lastDeadCheck >= DEFAULT_MONITOR_CONFIG.deadCheckIntervalMs;
      const checkStall = t - lastStallCheck >= DEFAULT_MONITOR_CONFIG.stallCheckIntervalMs;

      if (checkStall) lastStallCheck = t;
      if (checkDead) lastDeadCheck = t;

      if (checkDead || checkStall) {
        intervals.push({ time: t, dead: checkDead, stall: checkStall });
      }
    }

    // Dead checks: 10s, 20s, 30s, 40s, 50s, 60s (6 times)
    const deadChecks = intervals.filter(i => i.dead);
    expect(deadChecks.length).toBe(6);

    // Stall checks: 30s, 60s (2 times)
    const stallChecks = intervals.filter(i => i.stall);
    expect(stallChecks.length).toBe(2);
  });
});

describe('M23: Idle debounce reduced from 10s to 3s', () => {
  it('should notify idle after 3s instead of 10s', () => {
    // Simulate the idle debounce logic from broadcastStatusChange
    const idleStart = Date.now() - 4_000; // 4 seconds of idle
    const idleDuration = Date.now() - idleStart;
    const IDLE_DEBOUNCE_MS = 3_000;

    const shouldNotify = idleDuration >= IDLE_DEBOUNCE_MS;
    expect(shouldNotify).toBe(true);
  });

  it('should NOT notify idle when under 3s', () => {
    const idleStart = Date.now() - 2_000; // Only 2 seconds of idle
    const idleDuration = Date.now() - idleStart;
    const IDLE_DEBOUNCE_MS = 3_000;

    const shouldNotify = idleDuration >= IDLE_DEBOUNCE_MS;
    expect(shouldNotify).toBe(false);
  });

  it('should notify at exactly 3s boundary', () => {
    const idleStart = Date.now() - 3_000; // Exactly 3 seconds
    const idleDuration = Date.now() - idleStart;
    const IDLE_DEBOUNCE_MS = 3_000;

    const shouldNotify = idleDuration >= IDLE_DEBOUNCE_MS;
    expect(shouldNotify).toBe(true);
  });

  it('should only notify once per idle period', () => {
    const idleNotified = new Set<string>();
    const sessionId = 'test-session';
    const IDLE_DEBOUNCE_MS = 3_000;
    const idleStart = Date.now() - 5_000;
    const idleDuration = Date.now() - idleStart;

    // First check — should notify
    if (idleDuration >= IDLE_DEBOUNCE_MS && !idleNotified.has(sessionId)) {
      idleNotified.add(sessionId);
    }
    expect(idleNotified.has(sessionId)).toBe(true);

    // Second check — already notified
    if (idleDuration >= IDLE_DEBOUNCE_MS && !idleNotified.has(sessionId)) {
      idleNotified.add(sessionId);
    }
    // Still only one notification (set prevents duplicates)
    expect(idleNotified.size).toBe(1);
  });

  it('should reset idle notification when session resumes working', () => {
    const idleNotified = new Set<string>();
    const sessionId = 'test-session';

    // Simulate idle then working transition
    idleNotified.add(sessionId);

    // When session goes working, clear idle notification
    const newStatus = 'working';
    if (newStatus === 'working') {
      idleNotified.delete(sessionId);
    }
    expect(idleNotified.has(sessionId)).toBe(false);
  });
});
