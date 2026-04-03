/**
 * session-cleanup-405.test.ts — Regression tests for issue #405.
 *
 * Ensures terminated sessions are removed from all server-side
 * session-keyed tracking maps and stay clean under create/kill churn.
 */

import { describe, it, expect } from 'vitest';
import { cleanupTerminatedSessionState } from '../session-cleanup.js';

class MapBackedCleanup {
  readonly entries = new Map<string, number>();

  track(sessionId: string): void {
    this.entries.set(sessionId, Date.now());
  }

  cleanupSession(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}

class MonitorCleanup {
  readonly entries = new Map<string, number>();

  track(sessionId: string): void {
    this.entries.set(sessionId, Date.now());
  }

  removeSession(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}

describe('cleanupTerminatedSessionState (Issue #405)', () => {
  it('removes the killed session from every tracking map', () => {
    const monitor = new MonitorCleanup();
    const metrics = new MapBackedCleanup();
    const toolRegistry = new MapBackedCleanup();

    monitor.track('sess-1');
    monitor.track('sess-2');
    metrics.track('sess-1');
    metrics.track('sess-2');
    toolRegistry.track('sess-1');
    toolRegistry.track('sess-2');

    cleanupTerminatedSessionState('sess-1', { monitor, metrics, toolRegistry });

    expect(monitor.entries.has('sess-1')).toBe(false);
    expect(metrics.entries.has('sess-1')).toBe(false);
    expect(toolRegistry.entries.has('sess-1')).toBe(false);

    expect(monitor.entries.has('sess-2')).toBe(true);
    expect(metrics.entries.has('sess-2')).toBe(true);
    expect(toolRegistry.entries.has('sess-2')).toBe(true);
  });

  it('leaves no stale entries after repeated create/kill cycles', () => {
    const monitor = new MonitorCleanup();
    const metrics = new MapBackedCleanup();
    const toolRegistry = new MapBackedCleanup();

    for (let i = 0; i < 200; i++) {
      const sessionId = `sess-${i}`;
      monitor.track(sessionId);
      metrics.track(sessionId);
      toolRegistry.track(sessionId);

      cleanupTerminatedSessionState(sessionId, { monitor, metrics, toolRegistry });
    }

    expect(monitor.entries.size).toBe(0);
    expect(metrics.entries.size).toBe(0);
    expect(toolRegistry.entries.size).toBe(0);
  });
});
