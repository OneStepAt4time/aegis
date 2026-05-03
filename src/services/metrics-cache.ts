/**
 * services/metrics-cache.ts — Persistent analytics cache (Issue #2250).
 *
 * Pre-computes daily aggregations so the analytics dashboard loads in
 * sub-second time.  Incremental updates arrive via SessionEventBus;
 * a full recomputation is cheap and happens only on explicit invalidation.
 *
 * Backends:
 *   - In-memory (default) — data lost on restart.
 *   - JSON file — persists to `stateDir/analytics-cache.json`.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionEventBus, GlobalSSEEvent } from '../events.js';
import type { SessionManager, SessionInfo } from '../session.js';
import type { MetricsCollector, SessionMetrics } from '../metrics.js';
import type { AuthManager } from '../services/auth/index.js';
import type {
  AnalyticsSummary,
  AnalyticsSessionVolume,
  AnalyticsModelUsage,
  AnalyticsCostTrend,
  AnalyticsKeyUsage,
  AnalyticsDurationTrend,
  AnalyticsErrorRates,
} from '../api-contracts.js';

// ── Bucket types ──────────────────────────────────────────────────────

interface DayBucket {
  created: number;
  cost: number;
  durations: number[];
  messages: number;
}

interface ModelBucket {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

interface KeyBucket {
  sessions: number;
  messages: number;
  estimatedCostUsd: number;
}

/** Shape of the serialised cache file. */
interface CacheFile {
  daily: Record<string, DayBucket>;
  models: Record<string, ModelBucket>;
  keys: Record<string, KeyBucket>;
  totalPermissionPrompts: number;
  totalApprovals: number;
  totalAutoApprovals: number;
  totalSessionsCreated: number;
  totalSessionsFailed: number;
  savedAt: number;
}

// ── Cache backend interface ───────────────────────────────────────────

export interface MetricsCacheBackend {
  load(): Promise<CacheFile | null>;
  save(data: CacheFile): Promise<void>;
}

// ── In-memory backend ─────────────────────────────────────────────────

export class InMemoryBackend implements MetricsCacheBackend {
  private data: CacheFile | null = null;

  async load(): Promise<CacheFile | null> {
    return this.data;
  }

  async save(data: CacheFile): Promise<void> {
    this.data = data;
  }
}

// ── JSON file backend ─────────────────────────────────────────────────

export class JsonFileBackend implements MetricsCacheBackend {
  constructor(private filePath: string) {}

  async load(): Promise<CacheFile | null> {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && parsed.daily) {
        return parsed as CacheFile;
      }
    } catch { /* corrupted */ }
    return null;
  }

  async save(data: CacheFile): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.filePath}.tmp`;
    await writeFile(tmpFile, JSON.stringify(data, null, 2));
    await rename(tmpFile, this.filePath);
  }
}

// ── MetricsCache ──────────────────────────────────────────────────────

export class MetricsCache {
  private dailyMap = new Map<string, DayBucket>();
  private modelMap = new Map<string, ModelBucket>();
  private keyUsageMap = new Map<string, KeyBucket>();
  private totalPermissionPrompts = 0;
  private totalApprovals = 0;
  private totalAutoApprovals = 0;
  private totalSessionsCreated = 0;
  private totalSessionsFailed = 0;

  private dirty = false;
  private unsub: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sessions: SessionManager,
    private readonly metrics: MetricsCollector,
    private readonly auth: AuthManager,
    private readonly backend: MetricsCacheBackend,
    private readonly eventBus: SessionEventBus,
    private readonly saveIntervalMs = 5 * 60 * 1000,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Try loading persisted cache
    const loaded = await this.backend.load();
    if (loaded) {
      this.hydrate(loaded);
    } else {
      // Cold start — compute from current in-memory state
      this.recompute();
    }

    // Subscribe to events for incremental invalidation
    this.unsub = this.eventBus.subscribeGlobal((event: GlobalSSEEvent) => {
      this.handleEvent(event);
    });

    // Periodic persistence
    this.saveTimer = setInterval(() => {
      void this.flush();
    }, this.saveIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flush();
  }

  // ── Public API ─────────────────────────────────────────────────────

  getMetrics(): AnalyticsSummary {
    // Always refresh lifetime counters from MetricsCollector (survives restarts)
    // but only rebuild daily aggregations when data has changed.
    this.refreshLifetimeCounters();
    if (this.dirty) {
      this.recompute();
    }

    const keys = this.auth.listKeys();
    const keyNameMap = new Map(keys.map((k) => [k.id, k.name]));

    const sessionVolume: AnalyticsSessionVolume[] = [...this.dailyMap.entries()]
      .map(([date, d]) => ({ date, created: d.created }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const tokenUsageByModel: AnalyticsModelUsage[] = [...this.modelMap.entries()]
      .map(([model, d]) => ({ model, ...d }))
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);

    const costTrends: AnalyticsCostTrend[] = [...this.dailyMap.entries()]
      .map(([date, d]) => ({ date, cost: d.cost, sessions: d.created }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const topApiKeys: AnalyticsKeyUsage[] = [...this.keyUsageMap.entries()]
      .map(([keyId, d]) => ({
        keyId,
        keyName: keyNameMap.get(keyId)
          ?? (keyId === 'master' ? 'Master' : keyId === 'anonymous' ? 'Anonymous' : keyId),
        ...d,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 10);

    const durationTrends: AnalyticsDurationTrend[] = [...this.dailyMap.entries()]
      .filter(([, d]) => d.durations.length > 0)
      .map(([date, d]) => ({
        date,
        avgDurationSec: Math.round(d.durations.reduce((a, b) => a + b, 0) / d.durations.length),
        count: d.durations.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const errorRates: AnalyticsErrorRates = {
      totalSessions: this.totalSessionsCreated,
      failedSessions: this.totalSessionsFailed,
      failureRate: this.totalSessionsCreated > 0
        ? this.totalSessionsFailed / this.totalSessionsCreated : 0,
      permissionPrompts: this.totalPermissionPrompts,
      approvals: this.totalApprovals,
      autoApprovals: this.totalAutoApprovals,
    };

    return {
      sessionVolume,
      tokenUsageByModel,
      costTrends,
      topApiKeys,
      durationTrends,
      errorRates,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Force full recomputation from current session state. */
  invalidate(): void {
    this.dirty = true;
    this.recompute();
  }

  // ── Internal ───────────────────────────────────────────────────────

  private handleEvent(event: GlobalSSEEvent): void {
    switch (event.event) {
      case 'session_created':
      case 'session_ended':
      case 'session_dead':
      case 'session_stall':
        this.dirty = true;
        break;
      default:
        break;
    }
  }

  /**
   * Refresh lifetime counters from MetricsCollector (persisted across restarts).
   * Called on every getMetrics() to guarantee total counts are always accurate,
   * even when daily aggregations are served from cache.
   */
  private refreshLifetimeCounters(): void {
    const activeCount = this.sessions.listSessions().length;
    const global = this.metrics.getGlobalMetrics(activeCount);
    this.totalSessionsCreated = global.sessions.total_created;
    this.totalSessionsFailed = global.sessions.failed;
  }

  /** Full recomputation from live MetricsCollector + SessionManager. */
  private recompute(): void {
    const allSessions = this.sessions.listSessions();
    const global = this.metrics.getGlobalMetrics(allSessions.length);

    this.dailyMap.clear();
    this.modelMap.clear();
    this.keyUsageMap.clear();
    this.totalPermissionPrompts = 0;
    this.totalApprovals = 0;
    this.totalAutoApprovals = 0;
    this.totalSessionsCreated = global.sessions.total_created;
    this.totalSessionsFailed = global.sessions.failed;

    for (const session of allSessions) {
      this.accumulateSession(session);
    }

    this.dirty = false;
  }

  private accumulateSession(session: SessionInfo): void {
    const sm: SessionMetrics | null = this.metrics.getSessionMetrics(session.id);
    const date = new Date(session.createdAt).toISOString().split('T')[0] ?? 'unknown';

    // Daily bucket
    let day = this.dailyMap.get(date);
    if (!day) {
      day = { created: 0, cost: 0, durations: [], messages: 0 };
      this.dailyMap.set(date, day);
    }
    day.created++;
    day.messages += sm?.messages ?? 0;

    if (sm) {
      if (sm.durationSec > 0) {
        day.durations.push(sm.durationSec);
      }

      // Token usage by model
      if (sm.tokenUsage) {
        day.cost += sm.tokenUsage.estimatedCostUsd;
        const model = session.model || 'unknown';
        let mb = this.modelMap.get(model);
        if (!mb) {
          mb = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, estimatedCostUsd: 0 };
          this.modelMap.set(model, mb);
        }
        mb.inputTokens += sm.tokenUsage.inputTokens;
        mb.outputTokens += sm.tokenUsage.outputTokens;
        mb.cacheCreationTokens += sm.tokenUsage.cacheCreationTokens;
        mb.cacheReadTokens += sm.tokenUsage.cacheReadTokens;
        mb.estimatedCostUsd += sm.tokenUsage.estimatedCostUsd;
      }

      // Permission tracking
      this.totalPermissionPrompts += sm.statusChanges.filter(
        (s) => s === 'permission_prompt' || s === 'bash_approval',
      ).length;
      this.totalApprovals += sm.approvals;
      this.totalAutoApprovals += sm.autoApprovals;
    }

    // Key usage bucket
    const keyId = session.ownerKeyId || 'anonymous';
    let kb = this.keyUsageMap.get(keyId);
    if (!kb) {
      kb = { sessions: 0, messages: 0, estimatedCostUsd: 0 };
      this.keyUsageMap.set(keyId, kb);
    }
    kb.sessions++;
    kb.messages += sm?.messages ?? 0;
    if (sm?.tokenUsage) {
      kb.estimatedCostUsd += sm.tokenUsage.estimatedCostUsd;
    }
  }

  private hydrate(data: CacheFile): void {
    this.dailyMap = new Map(Object.entries(data.daily));
    this.modelMap = new Map(Object.entries(data.models));
    this.keyUsageMap = new Map(Object.entries(data.keys));
    this.totalPermissionPrompts = data.totalPermissionPrompts;
    this.totalApprovals = data.totalApprovals;
    this.totalAutoApprovals = data.totalAutoApprovals;
    this.totalSessionsCreated = data.totalSessionsCreated;
    this.totalSessionsFailed = data.totalSessionsFailed;
    this.dirty = false;
  }

  async flush(): Promise<void> {
    // Recompute before saving so persisted data is accurate
    this.recompute();
    const data: CacheFile = {
      daily: Object.fromEntries(this.dailyMap),
      models: Object.fromEntries(this.modelMap),
      keys: Object.fromEntries(this.keyUsageMap),
      totalPermissionPrompts: this.totalPermissionPrompts,
      totalApprovals: this.totalApprovals,
      totalAutoApprovals: this.totalAutoApprovals,
      totalSessionsCreated: this.totalSessionsCreated,
      totalSessionsFailed: this.totalSessionsFailed,
      savedAt: Date.now(),
    };
    await this.backend.save(data);
  }
}
