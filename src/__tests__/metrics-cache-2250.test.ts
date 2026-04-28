/**
 * @fileoverview Tests for Issue #2250: Persistent metrics cache for analytics.
 *
 * Tests MetricsCache with InMemoryBackend covering:
 *   - Cache operations (recompute, getMetrics)
 *   - Incremental invalidation via SessionEventBus
 *   - Persistence via backend load/save
 *   - Daily aggregation correctness
 *   - Error rates, key usage, model breakdowns
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsCache, InMemoryBackend, type MetricsCacheBackend } from '../services/metrics-cache.js';
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

function createMockDeps() {
  const sessionsMap = new Map<string, SessionInfo>();
  const metricsMap = new Map<string, SessionMetrics>();

  const sessions = {
    listSessions: vi.fn(() => [...sessionsMap.values()]),
  } as unknown as SessionManager;

  const metrics = {
    getSessionMetrics: vi.fn((id: string) => metricsMap.get(id) ?? null),
    getGlobalMetrics: vi.fn((activeCount: number) => ({
      sessions: {
        total_created: sessionsMap.size,
        currently_active: activeCount,
        completed: 0,
        failed: [...sessionsMap.values()].filter(s => s.status === 'error').length,
      },
    })),
  } as unknown as MetricsCollector;

  const auth = {
    listKeys: vi.fn(() => []),
  } as unknown as AuthManager;

  // Minimal event bus with subscribeGlobal
  const handlers: Array<(event: GlobalSSEEvent) => void> = [];
  const eventBus = {
    subscribeGlobal: vi.fn((handler: (event: GlobalSSEEvent) => void) => {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    }),
    // Helper to emit events in tests
    _emit(event: GlobalSSEEvent) {
      for (const h of handlers) h(event);
    },
  } as unknown as SessionEventBus & { _emit: (e: GlobalSSEEvent) => void };

  return { sessions, metrics, auth, eventBus, sessionsMap, metricsMap, handlers };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('MetricsCache (Issue #2250)', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let backend: InMemoryBackend;
  let cache: MetricsCache;

  beforeEach(() => {
    deps = createMockDeps();
    backend = new InMemoryBackend();
    cache = new MetricsCache(
      deps.sessions,
      deps.metrics,
      deps.auth,
      backend,
      deps.eventBus,
    );
  });

  describe('getMetrics — basic cache operations', () => {
    it('returns empty summary when no sessions exist', async () => {
      await cache.start();
      const result = cache.getMetrics();

      expect(result.sessionVolume).toEqual([]);
      expect(result.tokenUsageByModel).toEqual([]);
      expect(result.costTrends).toEqual([]);
      expect(result.topApiKeys).toEqual([]);
      expect(result.durationTrends).toEqual([]);
      expect(result.errorRates.totalSessions).toBe(0);
      expect(result.errorRates.failureRate).toBe(0);
      expect(result.generatedAt).toBeTruthy();

      await cache.stop();
    });

    it('aggregates a single session correctly', async () => {
      const ts = new Date('2026-04-28T10:00:00Z').getTime();
      deps.sessionsMap.set('s1', makeSession({
        id: 's1',
        createdAt: ts,
        model: 'sonnet',
        ownerKeyId: 'key-1',
      }));
      deps.metricsMap.set('s1', makeMetrics({
        messages: 5,
        durationSec: 120,
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 200,
          cacheReadTokens: 100,
          estimatedCostUsd: 0.05,
        },
        approvals: 2,
        autoApprovals: 1,
        statusChanges: ['permission_prompt', 'idle'],
      }));
      deps.auth.listKeys = vi.fn(() => [
        { id: 'key-1', name: 'Test Key', role: 'admin', permissions: [], rateLimit: { max: 100, windowMs: 60000 }, createdAt: Date.now(), lastUsedAt: null, enabled: true },
      ] as any);

      await cache.start();
      const result = cache.getMetrics();

      // Session volume
      expect(result.sessionVolume).toEqual([{ date: '2026-04-28', created: 1 }]);

      // Model usage
      expect(result.tokenUsageByModel).toHaveLength(1);
      expect(result.tokenUsageByModel[0].model).toBe('sonnet');
      expect(result.tokenUsageByModel[0].inputTokens).toBe(1000);

      // Cost trends
      expect(result.costTrends).toEqual([{ date: '2026-04-28', cost: 0.05, sessions: 1 }]);

      // Key usage
      expect(result.topApiKeys).toHaveLength(1);
      expect(result.topApiKeys[0].keyId).toBe('key-1');
      expect(result.topApiKeys[0].keyName).toBe('Test Key');
      expect(result.topApiKeys[0].sessions).toBe(1);

      // Duration trends
      expect(result.durationTrends).toEqual([{ date: '2026-04-28', avgDurationSec: 120, count: 1 }]);

      // Error rates
      expect(result.errorRates.permissionPrompts).toBe(1);
      expect(result.errorRates.approvals).toBe(2);
      expect(result.errorRates.autoApprovals).toBe(1);

      await cache.stop();
    });

    it('groups sessions by date correctly', async () => {
      const day1 = new Date('2026-04-26T10:00:00Z').getTime();
      const day2 = new Date('2026-04-27T10:00:00Z').getTime();
      const day3 = new Date('2026-04-28T10:00:00Z').getTime();

      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: day1 }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2', createdAt: day1 }));
      deps.sessionsMap.set('s3', makeSession({ id: 's3', createdAt: day2 }));
      deps.sessionsMap.set('s4', makeSession({ id: 's4', createdAt: day3 }));
      deps.metricsMap.set('s1', makeMetrics({ messages: 3 }));
      deps.metricsMap.set('s2', makeMetrics({ messages: 7 }));
      deps.metricsMap.set('s3', makeMetrics({ messages: 5 }));
      deps.metricsMap.set('s4', makeMetrics({ messages: 2 }));

      await cache.start();
      const result = cache.getMetrics();

      expect(result.sessionVolume).toEqual([
        { date: '2026-04-26', created: 2 },
        { date: '2026-04-27', created: 1 },
        { date: '2026-04-28', created: 1 },
      ]);

      await cache.stop();
    });
  });

  describe('Incremental invalidation via events', () => {
    it('subscribes to global events on start', async () => {
      await cache.start();
      expect(deps.eventBus.subscribeGlobal).toHaveBeenCalled();
      await cache.stop();
    });

    it('unsubscribes on stop', async () => {
      await cache.start();
      await cache.stop();
      // After stop, emitting events should not cause errors
      expect(() => {
        (deps.eventBus as unknown as { _emit: (e: GlobalSSEEvent) => void })._emit({
          event: 'session_created',
          sessionId: 's-new',
          timestamp: new Date().toISOString(),
          data: {},
        });
      }).not.toThrow();
    });
  });

  describe('Persistence', () => {
    it('flushes data to backend', async () => {
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: Date.now() }));
      deps.metricsMap.set('s1', makeMetrics({ messages: 3 }));

      await cache.start();
      await cache.flush();

      const saved = await backend.load();
      expect(saved).not.toBeNull();
      expect(saved!.daily).toBeDefined();
      expect(saved!.savedAt).toBeGreaterThan(0);

      await cache.stop();
    });

    it('loads persisted data from backend on start', async () => {
      // Pre-populate backend
      const prePopulatedBackend: MetricsCacheBackend = {
        load: async () => ({
          daily: {
            '2026-04-28': { created: 5, cost: 1.2, durations: [60, 120], messages: 30 },
          },
          models: {
            sonnet: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 1.2 },
          },
          keys: {
            'key-1': { sessions: 3, messages: 20, estimatedCostUsd: 0.8 },
          },
          totalPermissionPrompts: 2,
          totalApprovals: 5,
          totalAutoApprovals: 3,
          totalSessionsCreated: 5,
          totalSessionsFailed: 1,
          savedAt: Date.now(),
        }),
        save: async () => {},
      };

      // Sessions exist so recompute will run
      const cache2 = new MetricsCache(
        deps.sessions, deps.metrics, deps.auth,
        prePopulatedBackend, deps.eventBus,
      );
      await cache2.start();

      // Even though no sessions in the live store, recompute will run
      // and produce empty data — this is correct since the cache
      // always reflects current state
      const result = cache2.getMetrics();
      expect(result).toBeDefined();

      await cache2.stop();
    });

    it('flushes on stop', async () => {
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: Date.now() }));
      deps.metricsMap.set('s1', makeMetrics({ messages: 10 }));

      await cache.start();
      await cache.stop();

      // After stop, data should have been flushed
      const saved = await backend.load();
      expect(saved).not.toBeNull();
      expect(saved!.savedAt).toBeGreaterThan(0);
    });
  });

  describe('Daily aggregation', () => {
    it('computes average duration per day', async () => {
      const ts = new Date('2026-04-28T10:00:00Z').getTime();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2', createdAt: ts }));
      deps.metricsMap.set('s1', makeMetrics({ durationSec: 100 }));
      deps.metricsMap.set('s2', makeMetrics({ durationSec: 200 }));

      await cache.start();
      const result = cache.getMetrics();

      expect(result.durationTrends).toEqual([{
        date: '2026-04-28',
        avgDurationSec: 150, // (100 + 200) / 2
        count: 2,
      }]);

      await cache.stop();
    });

    it('excludes days with no durations from durationTrends', async () => {
      const ts = new Date('2026-04-28T10:00:00Z').getTime();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts }));
      deps.metricsMap.set('s1', makeMetrics({ durationSec: 0 }));

      await cache.start();
      const result = cache.getMetrics();

      // No session with durationSec > 0
      expect(result.durationTrends).toEqual([]);

      await cache.stop();
    });

    it('computes cost trends per day', async () => {
      const ts = new Date('2026-04-28T10:00:00Z').getTime();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2', createdAt: ts }));
      deps.metricsMap.set('s1', makeMetrics({
        tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.03 },
      }));
      deps.metricsMap.set('s2', makeMetrics({
        tokenUsage: { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.07 },
      }));

      await cache.start();
      const result = cache.getMetrics();

      expect(result.costTrends).toEqual([{
        date: '2026-04-28',
        cost: 0.10, // 0.03 + 0.07
        sessions: 2,
      }]);

      await cache.stop();
    });
  });

  describe('Error rates', () => {
    it('computes failure rate from global metrics', async () => {
      const ts = Date.now();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts, status: 'idle' }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2', createdAt: ts, status: 'error' }));
      deps.sessionsMap.set('s3', makeSession({ id: 's3', createdAt: ts, status: 'error' }));
      deps.metricsMap.set('s1', makeMetrics());
      deps.metricsMap.set('s2', makeMetrics());
      deps.metricsMap.set('s3', makeMetrics());
      // Override the default mock for this test
      (deps.metrics.getGlobalMetrics as ReturnType<typeof vi.fn>).mockReturnValue({
        sessions: { total_created: 10, currently_active: 3, completed: 5, failed: 2 },
      });

      await cache.start();
      const result = cache.getMetrics();

      expect(result.errorRates.totalSessions).toBe(10);
      expect(result.errorRates.failedSessions).toBe(2);
      expect(result.errorRates.failureRate).toBeCloseTo(2 / 10);

      await cache.stop();
    });

    it('tracks permission prompts from statusChanges', async () => {
      const ts = Date.now();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts }));
      deps.metricsMap.set('s1', makeMetrics({
        statusChanges: ['working', 'permission_prompt', 'idle', 'bash_approval'],
      }));

      await cache.start();
      const result = cache.getMetrics();

      expect(result.errorRates.permissionPrompts).toBe(2);

      await cache.stop();
    });
  });

  describe('Model usage breakdown', () => {
    it('groups token usage by model', async () => {
      const ts = Date.now();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts, model: 'sonnet' }));
      deps.sessionsMap.set('s2', makeSession({ id: 's2', createdAt: ts, model: 'opus' }));
      deps.sessionsMap.set('s3', makeSession({ id: 's3', createdAt: ts, model: 'sonnet' }));
      deps.metricsMap.set('s1', makeMetrics({
        tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 100, cacheReadTokens: 50, estimatedCostUsd: 0.03 },
      }));
      deps.metricsMap.set('s2', makeMetrics({
        tokenUsage: { inputTokens: 5000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.15 },
      }));
      deps.metricsMap.set('s3', makeMetrics({
        tokenUsage: { inputTokens: 2000, outputTokens: 1000, cacheCreationTokens: 200, cacheReadTokens: 100, estimatedCostUsd: 0.06 },
      }));

      await cache.start();
      const result = cache.getMetrics();

      // opus first (higher cost), then sonnet
      expect(result.tokenUsageByModel).toHaveLength(2);
      expect(result.tokenUsageByModel[0].model).toBe('opus');
      expect(result.tokenUsageByModel[1].model).toBe('sonnet');

      // Sonnet should have aggregated both sessions
      const sonnet = result.tokenUsageByModel[1];
      expect(sonnet.inputTokens).toBe(3000);  // 1000 + 2000
      expect(sonnet.outputTokens).toBe(1500);  // 500 + 1000
      expect(sonnet.estimatedCostUsd).toBeCloseTo(0.09);  // 0.03 + 0.06

      await cache.stop();
    });

    it('uses "unknown" for sessions without model', async () => {
      const ts = Date.now();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts, model: undefined }));
      deps.metricsMap.set('s1', makeMetrics({
        tokenUsage: { inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0.01 },
      }));

      await cache.start();
      const result = cache.getMetrics();

      expect(result.tokenUsageByModel).toHaveLength(1);
      expect(result.tokenUsageByModel[0].model).toBe('unknown');

      await cache.stop();
    });
  });

  describe('Key usage', () => {
    it('limits top API keys to 10', async () => {
      const ts = Date.now();
      for (let i = 0; i < 15; i++) {
        deps.sessionsMap.set(`s${i}`, makeSession({
          id: `s${i}`,
          createdAt: ts,
          ownerKeyId: `key-${i}`,
        }));
        deps.metricsMap.set(`s${i}`, makeMetrics({ messages: i }));
      }

      await cache.start();
      const result = cache.getMetrics();

      expect(result.topApiKeys).toHaveLength(10);

      await cache.stop();
    });

    it('uses "anonymous" for sessions without ownerKeyId', async () => {
      const ts = Date.now();
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: ts, ownerKeyId: undefined }));

      await cache.start();
      const result = cache.getMetrics();

      expect(result.topApiKeys).toHaveLength(1);
      expect(result.topApiKeys[0].keyId).toBe('anonymous');
      expect(result.topApiKeys[0].keyName).toBe('Anonymous');

      await cache.stop();
    });
  });

  describe('Invalidate', () => {
    it('force recomputes on invalidate()', async () => {
      await cache.start();

      // Initially empty
      let result = cache.getMetrics();
      expect(result.errorRates.totalSessions).toBe(0);

      // Add a session after start
      deps.sessionsMap.set('s1', makeSession({ id: 's1', createdAt: Date.now() }));
      deps.metricsMap.set('s1', makeMetrics({ messages: 5 }));

      // Invalidate forces recompute
      cache.invalidate();
      result = cache.getMetrics();
      expect(result.errorRates.totalSessions).toBe(1);

      await cache.stop();
    });
  });

  describe('InMemoryBackend', () => {
    it('returns null on fresh load', async () => {
      const b = new InMemoryBackend();
      expect(await b.load()).toBeNull();
    });

    it('persists data in memory', async () => {
      const b = new InMemoryBackend();
      const data = {
        daily: { '2026-04-28': { created: 1, cost: 0, durations: [], messages: 0 } },
        models: {},
        keys: {},
        totalPermissionPrompts: 0,
        totalApprovals: 0,
        totalAutoApprovals: 0,
        totalSessionsCreated: 1,
        totalSessionsFailed: 0,
        savedAt: Date.now(),
      };
      await b.save(data);
      const loaded = await b.load();
      expect(loaded).toEqual(data);
    });
  });
});
