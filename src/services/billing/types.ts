/**
 * types.ts — Billing and metering type definitions.
 *
 * Issue #1954: Structured types for the billing hook system.
 * These types are used by the BillingHookService, metering
 * routes, and external billing integrators.
 */

/** Event types that can trigger a billing event. */
export type BillingEventType =
  | 'session_start'
  | 'session_end'
  | 'message'
  | 'tool_call';

/** A structured billing event emitted by the hook system. */
export interface BillingEvent {
  /** Unique event ID (monotonically increasing). */
  id: number;
  /** Session that generated this event. */
  sessionId: string;
  /** API key that owns the session (undefined when auth is disabled). */
  keyId: string | undefined;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** What triggered this event. */
  eventType: BillingEventType;
  /** Token counts for this event. */
  tokens: TokenCounts;
  /** Estimated cost in USD. */
  costUsd: number;
  /** Model name (if known). */
  model: string | undefined;
}

/** Token count breakdown. */
export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/**
 * A persisted metering record — the on-disk representation
 * of aggregated usage for a billing period.
 */
export interface MeteringRecord {
  /** Unique record ID. */
  id: number;
  /** Session ID. */
  sessionId: string;
  /** Owner API key ID. */
  keyId: string | undefined;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Event type. */
  eventType: BillingEventType;
  /** Token counts. */
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Estimated cost in USD. */
  costUsd: number;
  /** Model name. */
  model: string | undefined;
}

/**
 * A cost record summarising spend for a key over a window.
 * Used by billing integrators to report aggregated cost.
 */
export interface CostRecord {
  /** API key ID (or '__no_key__' when auth is disabled). */
  keyId: string;
  /** Total estimated spend in USD. */
  totalCostUsd: number;
  /** Total input tokens. */
  totalInputTokens: number;
  /** Total output tokens. */
  totalOutputTokens: number;
  /** Total cache creation tokens. */
  totalCacheCreationTokens: number;
  /** Total cache read tokens. */
  totalCacheReadTokens: number;
  /** Number of individual records aggregated. */
  recordCount: number;
  /** Number of distinct sessions. */
  sessionCount: number;
  /** ISO 8601 timestamp of the earliest record. */
  from?: string;
  /** ISO 8601 timestamp of the latest record. */
  to?: string;
}

/** Configurable rate tier for cost estimation. */
export interface RateTier {
  /** Tier name (e.g. 'haiku', 'sonnet', 'opus'). */
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

/** Options for querying usage summaries. */
export interface UsageQueryOptions {
  from?: string;
  to?: string;
  keyId?: string;
  sessionId?: string;
}
