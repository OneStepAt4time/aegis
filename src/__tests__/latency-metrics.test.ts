import { describe, it, expect } from 'vitest';
import { computeLatencyMetrics } from '../services/session/latency-metrics.js';
import type { SessionInfo } from '../session-types.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-id',
    windowId: '',
    displayName: 'test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    latestActivityText: 'ok',
    stallThresholdMs: 120000,
    permissionStallMs: 300000,
    ...overrides,
  } as SessionInfo;
}

describe('computeLatencyMetrics', () => {
  it('returns null metrics when no timing data', () => {
    const session = makeSession();
    const metrics = computeLatencyMetrics(session);
    expect(metrics).toEqual({
      hook_latency_ms: null,
      state_change_detection_ms: null,
      permission_response_ms: null,
    });
  });

  it('computes hook latency from hook timestamps', () => {
    const session = makeSession({
      lastHookEventAt: 1000,
      lastHookReceivedAt: 1050,
    });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.hook_latency_ms).toBe(50);
    expect(metrics.state_change_detection_ms).toBe(50);
  });

  it('returns null hook latency when clock skew (negative)', () => {
    const session = makeSession({
      lastHookEventAt: 2000,
      lastHookReceivedAt: 1000, // received before event
    });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.hook_latency_ms).toBeNull();
    expect(metrics.state_change_detection_ms).toBeNull();
  });

  it('returns null hook latency when only eventAt is set', () => {
    const session = makeSession({ lastHookEventAt: 1000 });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.hook_latency_ms).toBeNull();
  });

  it('returns null hook latency when only receivedAt is set', () => {
    const session = makeSession({ lastHookReceivedAt: 1000 });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.hook_latency_ms).toBeNull();
  });

  it('computes permission response latency', () => {
    const session = makeSession({
      permissionPromptAt: 1000,
      permissionRespondedAt: 3500,
    });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.permission_response_ms).toBe(2500);
  });

  it('returns null permission response when only promptAt is set', () => {
    const session = makeSession({ permissionPromptAt: 1000 });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.permission_response_ms).toBeNull();
  });

  it('returns null permission response when only respondedAt is set', () => {
    const session = makeSession({ permissionRespondedAt: 1000 });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.permission_response_ms).toBeNull();
  });

  it('computes both latencies simultaneously', () => {
    const session = makeSession({
      lastHookEventAt: 1000,
      lastHookReceivedAt: 1050,
      permissionPromptAt: 2000,
      permissionRespondedAt: 4500,
    });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.hook_latency_ms).toBe(50);
    expect(metrics.state_change_detection_ms).toBe(50);
    expect(metrics.permission_response_ms).toBe(2500);
  });

  it('handles zero latency (simultaneous event)', () => {
    const session = makeSession({
      lastHookEventAt: 1000,
      lastHookReceivedAt: 1000,
    });
    const metrics = computeLatencyMetrics(session);
    expect(metrics.hook_latency_ms).toBe(0);
    expect(metrics.state_change_detection_ms).toBe(0);
  });
});
