/**
 * metrics-types.ts — Shared types for metrics and metrics-aggregation.
 *
 * Extracted to break circular dependency between metrics.ts and
 * metrics-aggregation.ts (both import types from each other).
 */

/** Minimal session info needed for aggregation (decoupled from SessionManager). */
export interface SessionForAggregation {
  id: string;
  createdAt: number;
  ownerKeyId?: string;
  /** Number of stall events detected for this session. */
  stallCount?: number;
}

/** Map from API key ID to key name. */
export type KeyNameMap = Map<string, string>;
