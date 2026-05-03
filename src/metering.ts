/**
 * metering.ts — Billing/metering hooks for per-session and per-key usage tracking.
 *
 * Issue #1954: Exposes token-cost tracking as structured usage records.
 * Subscribes to session lifecycle events and JSONL token deltas to record
 * usage, then provides aggregation endpoints for billing integration.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SessionEventBus } from './events.js';
import type { MetricsCollector } from './metrics.js';
import type { TokenUsageDelta } from './transcript.js';

// ── Types ───────────────────────────────────────────────────────────

/** A single usage record emitted for a session event. */
export interface UsageRecord {
  /** Unique record ID (incrementing counter). */
  id: number;
  /** Session ID. */
  sessionId: string;
  /** API key ID that owns the session (undefined if auth disabled). */
  keyId: string | undefined;
  /** ISO timestamp of the event. */
  timestamp: string;
  /** Event type that generated this record. */
  eventType: 'session_start' | 'message' | 'tool_call' | 'session_end';
  /** Token counts for this event. */
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Estimated cost in USD for this event. */
  costUsd: number;
  /** Model name (if known). */
  model: string | undefined;
}

/** Configurable rate tier for cost estimation. */
export interface RateTier {
  /** Tier name (e.g. 'haiku', 'sonnet', 'opus', or a custom name). */
  name: string;
  /** Cost per million input tokens in USD. */
  inputCostPerM: number;
  /** Cost per million output tokens in USD. */
  outputCostPerM: number;
  /** Cost per million cache creation tokens in USD. */
  cacheWriteCostPerM: number;
  /** Cost per million cache read tokens in USD. */
  cacheReadCostPerM: number;
  /** Regex pattern to match model names to this tier. */
  modelPattern: string;
}

/** Aggregated usage summary returned by the API. */
export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
  recordCount: number;
  sessions: number;
  /** ISO timestamp of the earliest record in this summary. */
  from?: string;
  /** ISO timestamp of the latest record in this summary. */
  to?: string;
}

/** Per-key usage breakdown. */
export interface KeyUsageBreakdown {
  keyId: string;
  usage: UsageSummary;
}

/** Options for automatic pruning and record caps. */
export interface MeteringOptions {
  /** Maximum age of records in milliseconds. Records older than this are pruned automatically.
   *  Default: 30 days (2_592_000_000 ms). Set to 0 to disable time-based pruning. */
  maxAgeMs?: number;
  /** Maximum number of records to keep. When exceeded, oldest records are evicted.
   *  Default: 100_000. Set to 0 to disable. */
  maxRecords?: number;
}

/** Schema version for persisted data. */
const SCHEMA_VERSION = 1;

/** Default max age: 30 days in milliseconds. */
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Default max records cap. */
const DEFAULT_MAX_RECORDS = 100_000;

interface MeteringPersistedData {
  schemaVersion: number;
  records: UsageRecord[];
  nextId: number;
}

// ── Default rate tiers (Anthropic Claude pricing) ────────────────────

export const DEFAULT_RATE_TIERS: RateTier[] = [
  {
    name: 'haiku',
    inputCostPerM: 0.80,
    outputCostPerM: 4.00,
    cacheWriteCostPerM: 1.00,
    cacheReadCostPerM: 0.08,
    modelPattern: 'haiku',
  },
  {
    name: 'sonnet',
    inputCostPerM: 3.00,
    outputCostPerM: 15.00,
    cacheWriteCostPerM: 3.75,
    cacheReadCostPerM: 0.30,
    modelPattern: 'sonnet',
  },
  {
    name: 'opus',
    inputCostPerM: 15.00,
    outputCostPerM: 75.00,
    cacheWriteCostPerM: 18.75,
    cacheReadCostPerM: 1.50,
    modelPattern: 'opus',
  },
];

// ── MeteringService ─────────────────────────────────────────────────

export class MeteringService {
  private records: UsageRecord[] = [];
  private nextId = 1;
  private readonly rateTiers: RateTier[];
  private unsubscribeFromEvents: (() => void) | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  /** Callback for external billing integrators. */
  private usageCallbacks: ((record: UsageRecord) => void)[] = [];

  private readonly maxAgeMs: number;
  private readonly maxRecords: number;

  /**
   * @param eventBus The session event bus to subscribe to.
   * @param getSessionOwner Function to resolve session's ownerKeyId from session ID.
   * @param dataFile Path to the persisted metering JSON file.
   * @param rateTiers Optional custom rate tiers (defaults to Anthropic pricing).
   * @param options Optional pruning/cap configuration.
   */
  constructor(
    private readonly eventBus: SessionEventBus,
    private readonly getSessionOwner: (sessionId: string) => string | undefined,
    private readonly dataFile: string,
    rateTiers?: RateTier[],
    options?: MeteringOptions,
  ) {
    this.rateTiers = rateTiers ?? [...DEFAULT_RATE_TIERS];
    this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.maxRecords = options?.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Load persisted records from disk. Prunes expired records automatically. */
  async load(): Promise<void> {
    if (existsSync(this.dataFile)) {
      try {
        const raw = await readFile(this.dataFile, 'utf-8');
        const data: MeteringPersistedData = JSON.parse(raw);
        if (data.schemaVersion === SCHEMA_VERSION) {
          this.records = data.records;
          this.nextId = data.nextId;
        }
      } catch {
        // Corrupt file — start fresh
      }
    }
    this.autoPrune();
  }

  /** Persist records to disk. */
  async save(): Promise<void> {
    const dir = dirname(this.dataFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const data: MeteringPersistedData = {
      schemaVersion: SCHEMA_VERSION,
      records: this.records,
      nextId: this.nextId,
    };
    await writeFile(this.dataFile, JSON.stringify(data), 'utf-8');
  }

  /** Subscribe to session lifecycle events for automatic recording. Starts periodic prune timer. */
  start(): void {
    const handler = (event: { sessionId: string; event: string; data: Record<string, unknown> }) => {
      const sessionId = event.sessionId;
      const keyId = this.getSessionOwner(sessionId);
      const now = new Date().toISOString();

      switch (event.event) {
        case 'session_created':
          this.recordEvent(sessionId, keyId, now, 'session_start', emptyDelta(), undefined);
          break;
        case 'session_ended':
          this.recordEvent(sessionId, keyId, now, 'session_end', emptyDelta(), undefined);
          break;
        case 'session_message':
          // Message events carry role; we record them for lifecycle tracking.
          this.recordEvent(sessionId, keyId, now, 'message', emptyDelta(), undefined);
          break;
      }
    };

    this.unsubscribeFromEvents = this.eventBus.subscribeGlobal(handler);
    this.startPruneTimer();
  }

  /** Stop listening for events and clear the prune timer. */
  stop(): void {
    if (this.unsubscribeFromEvents) {
      this.unsubscribeFromEvents();
      this.unsubscribeFromEvents = null;
    }
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  // ── Token usage recording (called from jsonlWatcher) ────────────

  /**
   * Record a token usage delta from JSONL parsing.
   * Called by the jsonlWatcher when new entries with token usage are detected.
   */
  recordTokenUsage(sessionId: string, delta: TokenUsageDelta, model?: string): void {
    if (delta.inputTokens === 0 && delta.outputTokens === 0) return;

    const keyId = this.getSessionOwner(sessionId);
    const costUsd = this.estimateCost(delta, model);
    const record: UsageRecord = {
      id: this.nextId++,
      sessionId,
      keyId,
      timestamp: new Date().toISOString(),
      eventType: 'message',
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      cacheCreationTokens: delta.cacheCreationTokens,
      cacheReadTokens: delta.cacheReadTokens,
      costUsd,
      model,
    };
    this.records.push(record);
    this.autoPrune();
    this.notifyCallbacks(record);
  }

  // ── Tool call recording ─────────────────────────────────────────

  /** Record a tool call event for metering. */
  recordToolCall(sessionId: string, _toolName: string, model?: string): void {
    const keyId = this.getSessionOwner(sessionId);
    this.recordEvent(sessionId, keyId, new Date().toISOString(), 'tool_call', emptyDelta(), model);
  }

  // ── Aggregation queries ─────────────────────────────────────────

  /**
   * Get total usage summary with optional time-range and key filters.
   */
  getUsageSummary(options?: { from?: string; to?: string; keyId?: string; sessionId?: string }): UsageSummary {
    const filtered = this.filterRecords(options);

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheWrite = 0;
    let totalCacheRead = 0;
    let totalCost = 0;
    const sessionSet = new Set<string>();
    let earliest: string | undefined;
    let latest: string | undefined;

    for (const r of filtered) {
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCacheWrite += r.cacheCreationTokens;
      totalCacheRead += r.cacheReadTokens;
      totalCost += r.costUsd;
      sessionSet.add(r.sessionId);
      if (!earliest || r.timestamp < earliest) earliest = r.timestamp;
      if (!latest || r.timestamp > latest) latest = r.timestamp;
    }

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheCreationTokens: totalCacheWrite,
      totalCacheReadTokens: totalCacheRead,
      totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      recordCount: filtered.length,
      sessions: sessionSet.size,
      from: earliest,
      to: latest,
    };
  }

  /**
   * Get usage breakdown grouped by API key.
   */
  getUsageByKey(options?: { from?: string; to?: string }): KeyUsageBreakdown[] {
    const filtered = this.filterRecords({ from: options?.from, to: options?.to });
    const keyMap = new Map<string, UsageRecord[]>();

    for (const r of filtered) {
      const key = r.keyId ?? '__no_key__';
      let arr = keyMap.get(key);
      if (!arr) {
        arr = [];
        keyMap.set(key, arr);
      }
      arr.push(r);
    }

    const result: KeyUsageBreakdown[] = [];
    for (const [keyId, records] of keyMap) {
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheWrite = 0;
      let totalCacheRead = 0;
      let totalCost = 0;
      const sessionSet = new Set<string>();
      let earliest: string | undefined;
      let latest: string | undefined;

      for (const r of records) {
        totalInput += r.inputTokens;
        totalOutput += r.outputTokens;
        totalCacheWrite += r.cacheCreationTokens;
        totalCacheRead += r.cacheReadTokens;
        totalCost += r.costUsd;
        sessionSet.add(r.sessionId);
        if (!earliest || r.timestamp < earliest) earliest = r.timestamp;
        if (!latest || r.timestamp > latest) latest = r.timestamp;
      }

      result.push({
        keyId,
        usage: {
          totalInputTokens: totalInput,
          totalOutputTokens: totalOutput,
          totalCacheCreationTokens: totalCacheWrite,
          totalCacheReadTokens: totalCacheRead,
          totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
          recordCount: records.length,
          sessions: sessionSet.size,
          from: earliest,
          to: latest,
        },
      });
    }

    return result;
  }

  /**
   * Get per-session usage records.
   */
  getSessionUsage(sessionId: string, options?: { from?: string; to?: string }): UsageRecord[] {
    return this.filterRecords({ sessionId, from: options?.from, to: options?.to });
  }

  /** Get the configured rate tiers. */
  getRateTiers(): RateTier[] {
    return [...this.rateTiers];
  }

  /**
   * Update rate tiers at runtime.
   * New tiers take effect for subsequent recordings only.
   */
  setRateTiers(tiers: RateTier[]): void {
    this.rateTiers.length = 0;
    this.rateTiers.push(...tiers);
  }

  /** Register a callback for usage events (billing integration). */
  onUsage(callback: (record: UsageRecord) => void): () => void {
    this.usageCallbacks.push(callback);
    return () => {
      const idx = this.usageCallbacks.indexOf(callback);
      if (idx >= 0) this.usageCallbacks.splice(idx, 1);
    };
  }

  /** Clean up records for a session (called on session destroy). */
  cleanupSession(_sessionId: string): void {
    // Keep records for billing even after session ends — no-op.
    // Records are only cleaned on explicit prune or restart.
  }

  /** Remove records older than the given ISO timestamp. Returns count removed. */
  pruneOlderThan(beforeTimestamp: string): number {
    const original = this.records.length;
    this.records = this.records.filter(r => r.timestamp >= beforeTimestamp);
    return original - this.records.length;
  }

  /** Get total record count. */
  get recordCount(): number {
    return this.records.length;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private recordEvent(
    sessionId: string,
    keyId: string | undefined,
    timestamp: string,
    eventType: UsageRecord['eventType'],
    delta: TokenUsageDelta,
    model: string | undefined,
  ): void {
    const record: UsageRecord = {
      id: this.nextId++,
      sessionId,
      keyId,
      timestamp,
      eventType,
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      cacheCreationTokens: delta.cacheCreationTokens,
      cacheReadTokens: delta.cacheReadTokens,
      costUsd: this.estimateCost(delta, model),
      model,
    };
    this.records.push(record);
    this.autoPrune();
    this.notifyCallbacks(record);
  }

  private estimateCost(delta: TokenUsageDelta, model?: string): number {
    if (delta.inputTokens === 0 && delta.outputTokens === 0) return 0;

    const tier = this.resolveTier(model);
    return (
      (delta.inputTokens * tier.inputCostPerM +
       delta.outputTokens * tier.outputCostPerM +
       delta.cacheCreationTokens * tier.cacheWriteCostPerM +
       delta.cacheReadTokens * tier.cacheReadCostPerM) / 1_000_000
    );
  }

  private resolveTier(model?: string): RateTier {
    if (model) {
      const lower = model.toLowerCase();
      for (const tier of this.rateTiers) {
        if (lower.includes(tier.modelPattern.toLowerCase())) {
          return tier;
        }
      }
    }
    // Default to sonnet pricing
    return this.rateTiers.find(t => t.name === 'sonnet') ?? this.rateTiers[0];
  }

  private filterRecords(options?: { from?: string; to?: string; keyId?: string; sessionId?: string }): UsageRecord[] {
    let filtered = this.records;
    if (options?.sessionId) {
      filtered = filtered.filter(r => r.sessionId === options.sessionId);
    }
    if (options?.keyId) {
      filtered = filtered.filter(r => r.keyId === options.keyId);
    }
    if (options?.from) {
      filtered = filtered.filter(r => r.timestamp >= options.from!);
    }
    if (options?.to) {
      filtered = filtered.filter(r => r.timestamp <= options.to!);
    }
    return filtered;
  }

  /** Prune expired records and enforce max-records cap. */
  private autoPrune(): void {
    if (this.maxAgeMs > 0) {
      const cutoff = new Date(Date.now() - this.maxAgeMs).toISOString();
      this.records = this.records.filter(r => r.timestamp >= cutoff);
    }
    this.enforceMaxRecords(this.maxRecords);
  }

  /** Start a periodic timer that prunes and saves every hour. */
  private startPruneTimer(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => {
      this.autoPrune();
    }, 60 * 60 * 1000);
    // Do not prevent Node.js process exit
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  /** Evict oldest records when the array exceeds `max`. If `max` is 0 the cap is disabled. */
  enforceMaxRecords(max: number): void {
    if (max > 0 && this.records.length > max) {
      this.records = this.records.slice(this.records.length - max);
    }
  }

  private notifyCallbacks(record: UsageRecord): void {
    for (const cb of this.usageCallbacks) {
      try {
        cb(record);
      } catch {
        // Callback errors must not disrupt recording.
      }
    }
  }
}

function emptyDelta(): TokenUsageDelta {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}
