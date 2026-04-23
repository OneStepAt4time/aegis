/**
 * index.ts — Billing hook system barrel export.
 *
 * Issue #1954: Exposes the BillingEvent type and the
 * EventEmitter-based hook system for billing integration.
 */

export { BillingMeteringService, DEFAULT_RATE_TIERS } from './metering.js';
export type { BillingHookEvents } from './metering.js';
export type {
  BillingEvent,
  BillingEventType,
  CostRecord,
  MeteringRecord,
  RateTier,
  TokenCounts,
  UsageQueryOptions,
} from './types.js';
