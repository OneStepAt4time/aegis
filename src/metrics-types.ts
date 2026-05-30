/**
 * metrics-types.ts — Shared type interfaces for the metrics subsystem.
 *
 * Extracted from metrics.ts to break the circular dependency:
 *   metrics.ts ↔ metrics-aggregation.ts
 *
 * Both files import types from here instead of from each other.
 */

/** Issue #488: Cumulative token usage + estimated cost for a session. */
export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
}

export interface SessionMetrics {
  durationSec: number;
  messages: number;
  toolCalls: number;
  approvals: number;
  autoApprovals: number;
  statusChanges: string[];
  /** Issue #488: Cumulative token usage and estimated cost. Present once tokens are first observed. */
  tokenUsage?: SessionTokenUsage;
}
