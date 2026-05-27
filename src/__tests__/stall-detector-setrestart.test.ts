/**
 * Tests for StallDetector.setRestartSession — state preservation when
 * updating the restartSession callback (the setAcpBackend state loss fix).
 */
import { describe, it, expect, vi } from 'vitest';
import { StallDetector, type StallDetectorConfig, type StallDetectorDeps } from '../stall-detector.js';

function makeConfig(): StallDetectorConfig {
  return {
    stallThresholdMs: 60_000,
    permissionStallMs: 300_000,
    unknownStallMs: 120_000,
    permissionTimeoutMs: 600_000,
    stallRecoveryEnabled: true,
    stallRecoveryMaxRetries: 3,
  };
}

function makeDeps(): StallDetectorDeps {
  return {
    rejectSession: vi.fn(),
    emitStall: vi.fn(),
    statusChange: vi.fn(),
    makePayload: vi.fn().mockReturnValue({}),
  };
}

describe('StallDetector.setRestartSession', () => {
  it('preserves stall state when restartSession is updated', () => {
    const detector = new StallDetector(makeConfig(), makeDeps());

    // Accumulate some state
    detector.stallAdd('sess-1', 'jsonl');
    expect(detector.stallHas('sess-1', 'jsonl')).toBe(true);

    // Update restartSession callback (simulates setAcpBackend)
    const newRestart = vi.fn().mockResolvedValue({ backoffDelayMs: 1000 });
    detector.setRestartSession(newRestart);

    // State should NOT be lost
    expect(detector.stallHas('sess-1', 'jsonl')).toBe(true);
  });

  it('allows updating restartSession from undefined to a function', () => {
    const deps = makeDeps();
    // Initially no restartSession
    expect(deps.restartSession).toBeUndefined();

    const detector = new StallDetector(makeConfig(), deps);
    const restartFn = vi.fn().mockResolvedValue({ backoffDelayMs: 500 });
    detector.setRestartSession(restartFn);

    // Now the callback should be set
    expect(deps.restartSession).toBe(restartFn);
  });

  it('preserves multiple stall types across update', () => {
    const detector = new StallDetector(makeConfig(), makeDeps());

    detector.stallAdd('sess-1', 'jsonl');
    detector.stallAdd('sess-1', 'permission');
    detector.stallAdd('sess-2', 'unknown');

    detector.setRestartSession(vi.fn().mockResolvedValue({ backoffDelayMs: 0 }));

    expect(detector.stallHas('sess-1', 'jsonl')).toBe(true);
    expect(detector.stallHas('sess-1', 'permission')).toBe(true);
    expect(detector.stallHas('sess-2', 'unknown')).toBe(true);
  });

  it('can be called multiple times without state loss', () => {
    const detector = new StallDetector(makeConfig(), makeDeps());

    detector.stallAdd('sess-1', 'jsonl');

    // First update
    detector.setRestartSession(vi.fn());
    expect(detector.stallHas('sess-1', 'jsonl')).toBe(true);

    // Add more state
    detector.stallAdd('sess-2', 'permission');

    // Second update
    detector.setRestartSession(vi.fn());
    expect(detector.stallHas('sess-1', 'jsonl')).toBe(true);
    expect(detector.stallHas('sess-2', 'permission')).toBe(true);
  });
});
