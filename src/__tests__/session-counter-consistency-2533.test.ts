/**
 * session-counter-consistency-2533.test.ts — Cross-endpoint session counter consistency.
 *
 * Issue #2533: Verifies that /v1/analytics/summary, /v1/analytics/costs,
 * /v1/sessions/stats, and /v1/metrics all report consistent session counts.
 *
 * Root cause: MetricsCache recomputed from live sessions on every getMetrics()
 * call, losing historical data after restart.  /v1/analytics/costs summed
 * costTrends[].sessions (live only) instead of using the lifetime counter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCache, InMemoryBackend } from '../services/metrics-cache.js';
import type { SessionEventBus, GlobalSSEEvent } from '../events.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { MetricsCollector, SessionMetrics } from '../metrics.js';
import type { AuthManager } from '../services/auth/index.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<SessionInfo> & { id: string }): SessionInfo {
  return {
    windowName: 'test',
    windowId: '0',
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    workDir: '/tmp',
    ownerKeyId: undefined,
    model: undefined,
    ...overrides,
  } as SessionInfo;
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

function createMockDeps(lifetimeCreated = 0, lifetimeFailed = 0) {
  const sessionsMap = new Map<string, SessionInfo>();
  const metricsMap = new Map<string, SessionMetrics>();

  const sessions = {
    listSessions: () => [...sessionsMap.values()],
  } as unknown as SessionManager;

  const metrics = {
    getSessionMetrics: (id: string) => metricsMap.get(id) ?? null,
    getGlobalMetrics: (activeCount: number) => ({
      sessions: {
        total_created: lifetimeCreated,
        currently_active: activeCount,
        completed: lifetimeCreated - lifetimeFailed - activeCount,
        failed: lifetimeFailed,
      },
    }),
  } as unknown as MetricsCollector;

  const auth = {
    listKeys: () => [],
  } as unknown as AuthManager;

  const handlers: Array<(event: GlobalSSEEvent) => void> = [];
  const eventBus = {
    subscribeGlobal: (handler: (event: GlobalSSEEvent) => void) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    _emit(event: GlobalSSEEvent) {
      for (const h of handlers) h(event);
    },
  } as unknown as SessionEventBus & { _emit: (e: GlobalSSEEvent) => void };

  return { sessions, metrics, auth, eventBus, sessionsMap, metricsMap, handlers };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Session counter consistency (Issue #2533)', () => {
  describe('MetricsCache — lifetime counters vs live sessions', () => {
    it('totalSessionsCreated reflects lifetime counter, not live session count', async () => {
      // Simulate: 10 sessions created lifetime, but only 2 still live
      const deps = createMockDeps(/* lifetimeCreated */ 10, /* lifetimeFailed */ 1);
      deps.sessionsMap.set('s1', makeSession({ id: 's1' }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2' }));
      deps.metricsMap.set('s1', makeMetrics());
      deps.metricsMap.set('s2', makeMetrics());

      const backend = new InMemoryBackend();
      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();
      const result = cache.getMetrics();

      // Lifetime counter, not live count (2)
      expect(result.errorRates.totalSessions).toBe(10);
      expect(result.errorRates.failedSessions).toBe(1);

      await cache.stop();
    });

    it('preserves historical daily data when not dirty', async () => {
      const deps = createMockDeps(/* lifetimeCreated */ 5, /* lifetimeFailed */ 0);

      // Pre-populate with historical daily data
      const prePopulated = {
        daily: {
          '2026-04-28': { created: 3, cost: 0.5, durations: [60], messages: 10 },
          '2026-04-29': { created: 2, cost: 0.3, durations: [90], messages: 8 },
        },
        models: {},
        keys: {},
        totalPermissionPrompts: 0,
        totalApprovals: 0,
        totalAutoApprovals: 0,
        totalSessionsCreated: 5,
        totalSessionsFailed: 0,
        savedAt: Date.now(),
      };

      const backend = {
        load: async () => prePopulated,
        save: async () => {},
      };

      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();

      // No events fired — dirty should be false
      const result = cache.getMetrics();

      // Daily data preserved from cache, not cleared
      expect(result.sessionVolume).toHaveLength(2);
      expect(result.sessionVolume[0].created).toBe(3);
      expect(result.sessionVolume[1].created).toBe(2);

      // Lifetime counter refreshed from MetricsCollector
      expect(result.errorRates.totalSessions).toBe(5);

      await cache.stop();
    });

    it('recomputes daily data when dirty after session event', async () => {
      const deps = createMockDeps(/* lifetimeCreated */ 3, /* lifetimeFailed */ 0);
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: Date.now() }));
      deps.metricsMap.set('s1', makeMetrics({ messages: 5 }));

      const backend = new InMemoryBackend();
      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();

      // Emit event to mark dirty
      (deps.eventBus as unknown as { _emit: (e: GlobalSSEEvent) => void })._emit({
        event: 'session_created',
        sessionId: 's1',
        timestamp: new Date().toISOString(),
        data: {},
      });

      const result = cache.getMetrics();

      // Recomputed from live state (1 session)
      expect(result.sessionVolume).toHaveLength(1);
      expect(result.errorRates.totalSessions).toBe(3); // lifetime counter

      await cache.stop();
    });
  });

  describe('/v1/analytics/costs — totalSessions uses lifetime counter', () => {
    it('totalSessions equals errorRates.totalSessions, not sum of costTrends', async () => {
      // Simulate: lifetime has 10 sessions but only 3 are live across 2 days
      const deps = createMockDeps(/* lifetimeCreated */ 10, /* lifetimeFailed */ 2);
      const day1 = new Date('2026-04-28T10:00:00Z').getTime();
      const day2 = new Date('2026-04-29T10:00:00Z').getTime();

      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: day1 }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2', createdAt: day1 }));
      deps.sessionsMap.set('s3', makeSession({ id: 's3', createdAt: day2 }));
      deps.metricsMap.set('s1', makeMetrics({ tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.03 } }));
      deps.metricsMap.set('s2', makeMetrics({ tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.05 } }));
      deps.metricsMap.set('s3', makeMetrics({ tokenUsage: { inputTokens: 500, outputTokens: 250, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.02 } }));

      const backend = new InMemoryBackend();
      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();
      const metrics = cache.getMetrics();

      // Before the fix, totalSessions would be 3 (sum of costTrends sessions).
      // After the fix, it should be 10 (lifetime counter).
      const totalSessions = metrics.errorRates.totalSessions;
      const costTrendsSum = metrics.costTrends.reduce((sum, d) => sum + d.sessions, 0);

      expect(costTrendsSum).toBe(3); // only live sessions
      expect(totalSessions).toBe(10); // lifetime counter

      // This is what /v1/analytics/costs now returns
      expect(totalSessions).not.toBe(costTrendsSum);
      expect(totalSessions).toBe(10);

      await cache.stop();
    });
  });

  describe('Cross-source consistency after simulated restart', () => {
    it('lifetime counters stay consistent when MetricsCache is hydrated from disk', async () => {
      // Phase 1: Populate cache and persist
      const deps = createMockDeps(/* lifetimeCreated */ 15, /* lifetimeFailed */ 3);
      deps.sessionsMap.set('s1', makeSession({ id: 's1' }));
      deps.metricsMap.set('s1', makeMetrics({ messages: 5 }));

      const backend = new InMemoryBackend();
      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();
      cache.getMetrics();
      await cache.flush();
      await cache.stop();

      // Phase 2: Simulate restart — live sessions are gone, but persisted data exists
      const deps2 = createMockDeps(/* lifetimeCreated */ 15, /* lifetimeFailed */ 3);
      // No live sessions (lost on restart)

      const cache2 = new MetricsCache(
        deps2.sessions, deps2.metrics, deps2.auth, backend, deps2.eventBus,
      );

      await cache2.start();
      const result = cache2.getMetrics();

      // Lifetime counters still correct (from MetricsCollector, persisted)
      expect(result.errorRates.totalSessions).toBe(15);
      expect(result.errorRates.failedSessions).toBe(3);

      // Historical daily data preserved (not cleared by recompute)
      expect(result.sessionVolume).toHaveLength(1);
      expect(result.sessionVolume[0].created).toBe(1);

      await cache2.stop();
    });

    it('all endpoints return the same totalCreated after session churn', async () => {
      // Simulates what /v1/sessions/stats, /v1/metrics, and /v1/analytics/summary would compute
      const lifetimeCreated = 20;
      const lifetimeFailed = 4;
      const lifetimeCompleted = 12;

      // Live sessions (4 active)
      const deps = createMockDeps(lifetimeCreated, lifetimeFailed);
      for (let i = 0; i < 4; i++) {
        deps.sessionsMap.set(`s${i}`, makeSession({ id: `s${i}` }));
        deps.metricsMap.set(`s${i}`, makeMetrics({ messages: i }));
      }

      const backend = new InMemoryBackend();
      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();
      const analyticsSummary = cache.getMetrics();

      // Simulate /v1/sessions/stats response
      const allLive = deps.sessions.listSessions();
      const statsGlobal = deps.metrics.getGlobalMetrics(allLive.length);

      // Simulate /v1/metrics response
      const metricsGlobal = deps.metrics.getGlobalMetrics(allLive.length);

      // All should agree on lifetime totals
      expect(analyticsSummary.errorRates.totalSessions).toBe(lifetimeCreated);
      expect(statsGlobal.sessions.total_created).toBe(lifetimeCreated);
      expect(metricsGlobal.sessions.total_created).toBe(lifetimeCreated);

      expect(analyticsSummary.errorRates.failedSessions).toBe(lifetimeFailed);
      expect(statsGlobal.sessions.failed).toBe(lifetimeFailed);
      expect(metricsGlobal.sessions.failed).toBe(lifetimeFailed);

      // Active counts should match
      expect(statsGlobal.sessions.currently_active).toBe(4);
      expect(metricsGlobal.sessions.currently_active).toBe(4);

      await cache.stop();
    });
  });

  describe('MetricsCache refreshLifetimeCounters', () => {
    it('always reads fresh counters from MetricsCollector even when not dirty', async () => {
      const deps = createMockDeps(/* lifetimeCreated */ 8, /* lifetimeFailed */ 1);
      deps.sessionsMap.set('s1', makeSession({ id: 's1' }));
      deps.metricsMap.set('s1', makeMetrics());

      const backend = new InMemoryBackend();
      const cache = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth, backend, deps.eventBus,
      );

      await cache.start();
      const r1 = cache.getMetrics();
      expect(r1.errorRates.totalSessions).toBe(8);

      // Simulate MetricsCollector receiving new session (counter bumped externally)
      // Recreate mock to return updated value
      const origGetGlobal = deps.metrics.getGlobalMetrics;
      deps.metrics.getGlobalMetrics = (activeCount: number) => ({
        uptime: 100,
        sessions: {
          total_created: 9, // bumped
          currently_active: activeCount,
          completed: 6,
          failed: 1,
          avg_duration_sec: 0,
          avg_messages_per_session: 0,
        },
        auto_approvals: 0,
        webhooks_sent: 0,
        webhooks_failed: 0,
        screenshots_taken: 0,
        pipelines_created: 0,
        batches_created: 0,
        prompt_delivery: { sent: 0, delivered: 0, failed: 0, success_rate: null },
        latency: {
          hook_latency_ms: { min: null, max: null, avg: null, count: 0 },
          state_change_detection_ms: { min: null, max: null, avg: null, count: 0 },
          permission_response_ms: { min: null, max: null, avg: null, count: 0 },
          channel_delivery_ms: { min: null, max: null, avg: null, count: 0 },
        },
      }) as any;

      // No dirty event, but getMetrics should still pick up the new counter
      const r2 = cache.getMetrics();
      expect(r2.errorRates.totalSessions).toBe(9);

      // Restore
      deps.metrics.getGlobalMetrics = origGetGlobal;

      await cache.stop();
    });
  });
});
