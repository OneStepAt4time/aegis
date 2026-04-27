/**
 * metering.ts — Token counting and cost tracking per session/key.
 *
 * Issue #1954: Billing/metering hook system.
 * Uses an EventEmitter to broadcast BillingEvents to registered
 * listeners (billing integrators, webhooks, quota managers).
 */

import { EventEmitter } from 'node:events';
import type { BillingEvent, BillingEventType, CostRecord, MeteringRecord, RateTier, UsageQueryOptions, TokenCounts } from './types.js';

/** Default Anthropic Claude pricing tiers. */
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

/** Schema version for persisted data. */
const SCHEMA_VERSION = 1;

interface MeteringPersistedData {
  schemaVersion: number;
  records: MeteringRecord[];
  nextId: number;
}

/** Events emitted by BillingMeteringService. */
export interface BillingHookEvents {
  /** Emitted for every new billing event. */
  billing: (event: BillingEvent) => void;
}

/**
 * BillingMeteringService — core token counting and cost tracking.
 *
 * Subscribes to session lifecycle events and token deltas,
 * converts them into BillingEvents, and broadcasts to all
 * registered billing hook listeners.
 */
export class BillingMeteringService {
  private records: MeteringRecord[] = [];
  private nextId = 1;
  private readonly rateTiers: RateTier[];
  private readonly emitter = new EventEmitter();

  constructor(rateTiers?: RateTier[]) {
    this.rateTiers = rateTiers ?? [...DEFAULT_RATE_TIERS];
    this.emitter.setMaxListeners(50);
  }

  // ── Event subscription ─────────────────────────────────────────────

  /**
   * Register a listener for billing events.
   * Returns an unsubscribe function.
   */
  onBillingEvent(listener: (event: BillingEvent) => void): () => void {
    this.emitter.on('billing', listener);
    return () => {
      this.emitter.off('billing', listener);
    };
  }

  // ── Token usage recording ──────────────────────────────────────────

  /**
   * Record a token usage delta from JSONL parsing.
   * Called by the jsonlWatcher when new entries with token usage are detected.
   */
  recordTokenUsage(
    sessionId: string,
    keyId: string | undefined,
    tokens: TokenCounts,
    model?: string,
  ): void {
    if (tokens.inputTokens === 0 && tokens.outputTokens === 0) return;

    const costUsd = this.estimateCost(tokens, model);
    const record = this.createRecord(sessionId, keyId, 'message', tokens, costUsd, model);
    this.records.push(record);
    this.emitBillingEvent(record);
  }

  /**
   * Record a session start event.
   */
  recordSessionStart(sessionId: string, keyId: string | undefined): void {
    const tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const record = this.createRecord(sessionId, keyId, 'session_start', tokens, 0, undefined);
    this.records.push(record);
    this.emitBillingEvent(record);
  }

  /**
   * Record a session end event.
   */
  recordSessionEnd(sessionId: string, keyId: string | undefined): void {
    const tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const record = this.createRecord(sessionId, keyId, 'session_end', tokens, 0, undefined);
    this.records.push(record);
    this.emitBillingEvent(record);
  }

  /**
   * Record a tool call event.
   */
  recordToolCall(sessionId: string, keyId: string | undefined, toolName: string, model?: string): void {
    void toolName; // tracked via eventType, not stored individually
    const tokens: TokenCounts = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const record = this.createRecord(sessionId, keyId, 'tool_call', tokens, 0, model);
    this.records.push(record);
    this.emitBillingEvent(record);
  }

  // ── Aggregation queries ────────────────────────────────────────────

  /**
   * Get total usage summary with optional filters.
   */
  getUsageSummary(options?: UsageQueryOptions): CostRecord {
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
      keyId: options?.keyId ?? '__all__',
      totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheCreationTokens: totalCacheWrite,
      totalCacheReadTokens: totalCacheRead,
      recordCount: filtered.length,
      sessionCount: sessionSet.size,
      from: earliest,
      to: latest,
    };
  }

  /**
   * Get usage breakdown grouped by API key.
   */
  getCostByKey(options?: { from?: string; to?: string }): CostRecord[] {
    const filtered = this.filterRecords({ from: options?.from, to: options?.to });
    const keyMap = new Map<string, MeteringRecord[]>();

    for (const r of filtered) {
      const key = r.keyId ?? '__no_key__';
      let arr = keyMap.get(key);
      if (!arr) {
        arr = [];
        keyMap.set(key, arr);
      }
      arr.push(r);
    }

    const result: CostRecord[] = [];
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
        totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCacheCreationTokens: totalCacheWrite,
        totalCacheReadTokens: totalCacheRead,
        recordCount: records.length,
        sessionCount: sessionSet.size,
        from: earliest,
        to: latest,
      });
    }

    return result;
  }

  /**
   * Get per-session usage records.
   */
  getSessionUsage(sessionId: string, options?: { from?: string; to?: string }): MeteringRecord[] {
    return this.filterRecords({ sessionId, from: options?.from, to: options?.to });
  }

  // ── Rate tier management ───────────────────────────────────────────

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

  // ── Record management ──────────────────────────────────────────────

  /** Get total record count. */
  get recordCount(): number {
    return this.records.length;
  }

  /** Remove records older than the given ISO timestamp. Returns count removed. */
  pruneOlderThan(beforeTimestamp: string): number {
    const original = this.records.length;
    this.records = this.records.filter(r => r.timestamp >= beforeTimestamp);
    return original - this.records.length;
  }

  // ── Private helpers ────────────────────────────────────────────────

  private createRecord(
    sessionId: string,
    keyId: string | undefined,
    eventType: BillingEventType,
    tokens: TokenCounts,
    costUsd: number,
    model: string | undefined,
  ): MeteringRecord {
    return {
      id: this.nextId++,
      sessionId,
      keyId,
      timestamp: new Date().toISOString(),
      eventType,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheCreationTokens: tokens.cacheCreationTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      costUsd,
      model,
    };
  }

  private emitBillingEvent(record: MeteringRecord): void {
    const event: BillingEvent = {
      id: record.id,
      sessionId: record.sessionId,
      keyId: record.keyId,
      timestamp: record.timestamp,
      eventType: record.eventType,
      tokens: {
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheCreationTokens: record.cacheCreationTokens,
        cacheReadTokens: record.cacheReadTokens,
      },
      costUsd: record.costUsd,
      model: record.model,
    };
    // Async delivery — each listener is called individually so one
    // throwing does not prevent others from receiving the event.
    setImmediate(() => {
      for (const listener of this.emitter.listeners('billing')) {
        try {
          listener(event);
        } catch {
          // Callback errors must not disrupt other listeners or recording.
        }
      }
    });
  }

  private estimateCost(tokens: TokenCounts, model?: string): number {
    if (tokens.inputTokens === 0 && tokens.outputTokens === 0) return 0;

    const tier = this.resolveTier(model);
    return (
      (tokens.inputTokens * tier.inputCostPerM +
       tokens.outputTokens * tier.outputCostPerM +
       tokens.cacheCreationTokens * tier.cacheWriteCostPerM +
       tokens.cacheReadTokens * tier.cacheReadCostPerM) / 1_000_000
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

  private filterRecords(options?: UsageQueryOptions): MeteringRecord[] {
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
}
