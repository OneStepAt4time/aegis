/**
 * Issue #3715 — session-cleanup.ts cleanupTerminatedSessionState
 *
 * Covers:
 * 1. Normal cleanup: all 3 deps called with correct sessionId
 * 2. Order of calls: monitor → metrics → toolRegistry
 * 3. Error propagation: if one dep throws, it propagates
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanupTerminatedSessionState, type SessionCleanupDeps } from '../session-cleanup.js';

function createMockDeps() {
  return {
    monitor: { removeSession: vi.fn<(s: string) => void>() },
    metrics: { cleanupSession: vi.fn<(s: string) => void>() },
    toolRegistry: { cleanupSession: vi.fn<(s: string) => void>() },
  };
}

describe('Issue #3715 — cleanupTerminatedSessionState', () => {
  it('calls all 3 deps with the correct sessionId', () => {
    const deps = createMockDeps();
    cleanupTerminatedSessionState('sess-123', deps);

    expect(deps.monitor.removeSession).toHaveBeenCalledWith('sess-123');
    expect(deps.metrics.cleanupSession).toHaveBeenCalledWith('sess-123');
    expect(deps.toolRegistry.cleanupSession).toHaveBeenCalledWith('sess-123');
  });

  it('calls deps in order: monitor → metrics → toolRegistry', () => {
    const order: string[] = [];
    const deps = {
      monitor: { removeSession: vi.fn<(s: string) => void>(() => { order.push('monitor'); }) },
      metrics: { cleanupSession: vi.fn<(s: string) => void>(() => { order.push('metrics'); }) },
      toolRegistry: { cleanupSession: vi.fn<(s: string) => void>(() => { order.push('toolRegistry'); }) },
    };

    cleanupTerminatedSessionState('sess-456', deps);

    expect(order).toEqual(['monitor', 'metrics', 'toolRegistry']);
  });

  it('propagates error if monitor.removeSession throws', () => {
    const deps = createMockDeps();
    deps.monitor.removeSession.mockImplementation(() => {
      throw new Error('monitor failed');
    });

    expect(() => cleanupTerminatedSessionState('sess-789', deps)).toThrow('monitor failed');

    // metrics and toolRegistry should NOT have been called (error propagated)
    expect(deps.metrics.cleanupSession).not.toHaveBeenCalled();
    expect(deps.toolRegistry.cleanupSession).not.toHaveBeenCalled();
  });

  it('propagates error if metrics.cleanupSession throws', () => {
    const deps = createMockDeps();
    deps.metrics.cleanupSession.mockImplementation(() => {
      throw new Error('metrics failed');
    });

    expect(() => cleanupTerminatedSessionState('sess-abc', deps)).toThrow('metrics failed');

    // monitor was called, toolRegistry was NOT
    expect(deps.monitor.removeSession).toHaveBeenCalled();
    expect(deps.toolRegistry.cleanupSession).not.toHaveBeenCalled();
  });

  it('propagates error if toolRegistry.cleanupSession throws', () => {
    const deps = createMockDeps();
    deps.toolRegistry.cleanupSession.mockImplementation(() => {
      throw new Error('toolRegistry failed');
    });

    expect(() => cleanupTerminatedSessionState('sess-def', deps)).toThrow('toolRegistry failed');

    // monitor and metrics were both called
    expect(deps.monitor.removeSession).toHaveBeenCalled();
    expect(deps.metrics.cleanupSession).toHaveBeenCalled();
  });

  it('works with empty sessionId', () => {
    const deps = createMockDeps();
    cleanupTerminatedSessionState('', deps);

    expect(deps.monitor.removeSession).toHaveBeenCalledWith('');
    expect(deps.metrics.cleanupSession).toHaveBeenCalledWith('');
    expect(deps.toolRegistry.cleanupSession).toHaveBeenCalledWith('');
  });
});
