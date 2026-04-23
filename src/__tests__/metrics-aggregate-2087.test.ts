/**
 * @fileoverview Tests for Issue #2087: Metrics aggregation endpoint.
 *
 * Tests the pure `computeAggregateMetrics` function directly,
 * covering time-range filtering, grouping, per-key breakdown,
 * and anomaly detection.
 */

import { describe, it, expect } from 'vitest';
import { computeAggregateMetrics, type SessionForAggregation } from '../metrics.js';
import type { AggregateMetricsByKey } from '../api-contracts.js';
import type { SessionMetrics } from '../metrics.js';

function makeSession(overrides: Partial<SessionForAggregation> & { id: string }): SessionForAggregation {
  return {
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    durationSec: 0,
    messages: 0,
    toolCalls: 0,
    approvals: 0,
    autoApprovals: 0,
    statusChanges: [],
    ...overrides,
  };
}

// Use a fixed reference time (noon UTC on 2026-04-22) for deterministic day/hour grouping
const REF = new Date('2026-04-22T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('computeAggregateMetrics', () => {
  it('returns zeros for empty input', () => {
    const result = computeAggregateMetrics(
      [],
      new Map(),
      new Map(),
      new Map(),
      REF - 7 * DAY,
      REF,
    );

    expect(result.summary.totalSessions).toBe(0);
    expect(result.summary.avgDurationSeconds).toBe(0);
    expect(result.summary.totalTokenCostUsd).toBe(0);
    expect(result.summary.totalMessages).toBe(0);
    expect(result.summary.totalToolCalls).toBe(0);
    expect(result.summary.permissionsApproved).toBe(0);
    expect(result.summary.permissionApprovalRate).toBeNull();
    expect(result.summary.stalls).toBe(0);
    expect(result.timeSeries).toEqual([]);
    expect(result.byKey).toEqual([]);
    expect(result.anomalies).toEqual([]);
  });

  it('filters sessions by time range', () => {
    const sessions = [
      makeSession({ id: 's1', createdAt: REF - 3 * DAY }),
      makeSession({ id: 's2', createdAt: REF - 10 * DAY }),
      makeSession({ id: 's3', createdAt: REF - DAY }),
    ];
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics({ messages: 10 })],
      ['s2', makeMetrics({ messages: 20 })],
      ['s3', makeMetrics({ messages: 30 })],
    ]);
    const startTimes = new Map([
      ['s1', REF - 3 * DAY],
      ['s2', REF - 10 * DAY],
      ['s3', REF - DAY],
    ]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - 5 * DAY, REF);

    // s2 is outside the range
    expect(result.summary.totalSessions).toBe(2);
    expect(result.summary.totalMessages).toBe(40);
  });

  it('groups by day by default', () => {
    const sessions = [
      makeSession({ id: 's1', createdAt: REF - 2 * DAY + HOUR }),
      makeSession({ id: 's2', createdAt: REF - 2 * DAY + 3 * HOUR }),
      makeSession({ id: 's3', createdAt: REF - DAY }),
    ];
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics()],
      ['s2', makeMetrics()],
      ['s3', makeMetrics()],
    ]);
    const startTimes = new Map([
      ['s1', REF - 2 * DAY],
      ['s2', REF - 2 * DAY],
      ['s3', REF - DAY],
    ]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - 3 * DAY, REF, 'day');

    expect(result.timeSeries).toHaveLength(2);
    // First bucket has 2 sessions, second has 1
    expect(result.timeSeries[0].sessions).toBe(2);
    expect(result.timeSeries[1].sessions).toBe(1);
  });

  it('groups by hour when specified', () => {
    const sessions = [
      makeSession({ id: 's1', createdAt: REF - 3 * HOUR }),
      makeSession({ id: 's2', createdAt: REF - HOUR }),
    ];
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics()],
      ['s2', makeMetrics()],
    ]);
    const startTimes = new Map([
      ['s1', REF - 3 * HOUR],
      ['s2', REF - HOUR],
    ]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - 4 * HOUR, REF, 'hour');

    expect(result.timeSeries).toHaveLength(2);
  });

  it('skips time series when groupBy is key', () => {
    const sessions = [makeSession({ id: 's1', createdAt: REF - HOUR })];
    const perSessionMetrics = new Map<string, SessionMetrics>([['s1', makeMetrics()]]);
    const startTimes = new Map([['s1', REF - HOUR]]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - DAY, REF, 'key');

    expect(result.timeSeries).toEqual([]);
  });

  it('aggregates per API key', () => {
    const sessions = [
      makeSession({ id: 's1', createdAt: REF - HOUR, ownerKeyId: 'key-a' }),
      makeSession({ id: 's2', createdAt: REF - HOUR, ownerKeyId: 'key-b' }),
      makeSession({ id: 's3', createdAt: REF - HOUR, ownerKeyId: 'key-a' }),
      makeSession({ id: 's4', createdAt: REF - HOUR }),
    ];
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics({ tokenUsage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 1.0 } })],
      ['s2', makeMetrics({ tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 2.0 } })],
      ['s3', makeMetrics({ tokenUsage: { inputTokens: 50, outputTokens: 25, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.5 } })],
      ['s4', makeMetrics()],
    ]);
    const startTimes = new Map([
      ['s1', REF - HOUR], ['s2', REF - HOUR], ['s3', REF - HOUR], ['s4', REF - HOUR],
    ]);
    const keyNameMap = new Map([['key-a', 'CI Bot'], ['key-b', 'Review Bot']]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, keyNameMap, REF - DAY, REF);

    expect(result.byKey).toHaveLength(3); // key-a, key-b, __none__
    // key-a has 2 sessions with $1.50 total
    const keyA = result.byKey.find((k: AggregateMetricsByKey) => k.keyId === 'key-a');
    expect(keyA).toBeDefined();
    expect(keyA!.sessions).toBe(2);
    expect(keyA!.tokenCostUsd).toBe(1.5);
    expect(keyA!.keyName).toBe('CI Bot');

    // key-b has 1 session with $2.00
    const keyB = result.byKey.find((k: AggregateMetricsByKey) => k.keyId === 'key-b');
    expect(keyB!.tokenCostUsd).toBe(2.0);
    expect(keyB!.keyName).toBe('Review Bot');
  });

  it('computes summary correctly', () => {
    const sessions = [
      makeSession({ id: 's1', createdAt: REF - 2 * HOUR }),
      makeSession({ id: 's2', createdAt: REF - HOUR }),
    ];
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics({ durationSec: 300, messages: 10, toolCalls: 5, approvals: 3, autoApprovals: 2 })],
      ['s2', makeMetrics({ durationSec: 600, messages: 20, toolCalls: 10, approvals: 7, autoApprovals: 7 })],
    ]);
    const startTimes = new Map([['s1', REF - 2 * HOUR], ['s2', REF - HOUR]]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - 3 * HOUR, REF);

    expect(result.summary.totalSessions).toBe(2);
    expect(result.summary.avgDurationSeconds).toBe(450); // (300+600)/2
    expect(result.summary.totalMessages).toBe(30);
    expect(result.summary.totalToolCalls).toBe(15);
    expect(result.summary.permissionsApproved).toBe(10);
    // 9 auto-approvals out of 10 total approvals = 90%
    expect(result.summary.permissionApprovalRate).toBe(90);
  });

  it('detects anomalies exceeding p95 by 3x', () => {
    // Create 20 sessions with cost $1-$20 each
    const sessions: SessionForAggregation[] = [];
    const perSessionMetrics = new Map<string, SessionMetrics>();
    const startTimes = new Map<string, number>();

    for (let i = 0; i < 20; i++) {
      const id = `s${i}`;
      sessions.push(makeSession({ id, createdAt: REF - (20 - i) * HOUR }));
      perSessionMetrics.set(id, makeMetrics({
        tokenUsage: {
          inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0,
          estimatedCostUsd: i + 1, // $1 through $20
        },
      }));
      startTimes.set(id, REF - (20 - i) * HOUR);
    }

    // p95 of costs $1-$20 is ~$19 (index ceil(20*0.95)-1 = 18 -> $19)
    // 3 * p95 = 57, nothing exceeds -> no anomalies
    let result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - 21 * HOUR, REF);
    expect(result.anomalies).toEqual([]);

    // Add a session with cost $100 -> should be anomaly
    const outlier = makeSession({ id: 'outlier', createdAt: REF - HOUR });
    sessions.push(outlier);
    perSessionMetrics.set('outlier', makeMetrics({
      tokenUsage: {
        inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0,
        estimatedCostUsd: 100,
      },
    }));
    startTimes.set('outlier', REF - HOUR);

    result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - 21 * HOUR, REF);
    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0].sessionId).toBe('outlier');
    expect(result.anomalies[0].tokenCostUsd).toBe(100);
    expect(result.anomalies[0].reason).toContain('exceeds_p95');
  });

  it('handles single session without anomalies', () => {
    const sessions = [makeSession({ id: 's1', createdAt: REF - HOUR })];
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics({ tokenUsage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 5 } })],
    ]);
    const startTimes = new Map([['s1', REF - HOUR]]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), REF - DAY, REF);

    expect(result.anomalies).toEqual([]); // need >= 2 sessions for p95
  });

  it('uses elapsed time for sessions without finalized duration', () => {
    // Use a start time close to now so Date.now() inside the function gives a reasonable elapsed time
    const startedAt = Date.now() - 3600_000; // 1 hour ago (real time)
    const sessions = [makeSession({ id: 's1', createdAt: startedAt })];
    // durationSec is 0 (still running)
    const perSessionMetrics = new Map<string, SessionMetrics>([
      ['s1', makeMetrics({ durationSec: 0 })],
    ]);
    const startTimes = new Map([['s1', startedAt]]);

    const result = computeAggregateMetrics(sessions, perSessionMetrics, startTimes, new Map(), startedAt - 1000, Date.now() + 1000);

    // Duration should be computed from start time, at least 3000 seconds (allowing for test execution time)
    expect(result.summary.avgDurationSeconds).toBeGreaterThan(3000);
  });
});
