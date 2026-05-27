/**
 * config/budgets.ts — Zod schema for budget, rate-limit, alerting & misc config.
 *
 * Covers: rate limiting, alerting, verification protocol, memory bridge,
 * pipeline timeout, env denylist, hook timeout, tenant/workdir mappings.
 */

import { z } from 'zod';

/** Zod schema for the budgets/misc config domain. */
export const budgetConfigSchema = z.object({
  /** Default pipeline stage timeout in milliseconds. 0 = no timeout. */
  pipelineStageTimeoutMs: z.number().int().nonnegative().default(0),
  /** Timeout in ms for outgoing hook/webhook HTTP calls. Default: 10000 (10 s). */
  hookTimeoutMs: z.number().int().min(100).default(10_000),
  /** Production alerting. */
  alerting: z.object({
    /** Webhook URLs for alert notifications. */
    webhooks: z.array(z.string()).default([]),
    /** Number of consecutive failures before triggering an alert (default: 5). */
    failureThreshold: z.number().int().positive().default(5),
    /** Cooldown period in ms between alerts for the same type (default: 10 min). */
    cooldownMs: z.number().int().positive().default(10 * 60 * 1000),
  }).default({ webhooks: [], failureThreshold: 5, cooldownMs: 10 * 60 * 1000 }),
  /** Verification Protocol — auto run quality gate after session ends. */
  verificationProtocol: z.object({
    /** Auto-run verification when Stop hook fires (default: false). */
    autoVerifyOnStop: z.boolean().default(false),
    /** Run only critical checks: tsc + build (skip slow tests). Default: false = full. */
    criticalOnly: z.boolean().default(false),
  }).default({ autoVerifyOnStop: false, criticalOnly: false }),
  /** Memory bridge: key/value store for cross-session context. */
  memoryBridge: z.object({
    enabled: z.boolean(),
    persistPath: z.string().optional(),
    reaperIntervalMs: z.number().int().positive().optional(),
  }).default({ enabled: true }),
  /** Additional env var names to deny (additive to built-in denylist). */
  envDenylist: z.array(z.string()).default([]),
  /** Admin-defined env var names exempt from denylist. */
  envAdminAllowlist: z.array(z.string()).default([]),
  /** Default tenant ID for keys/sessions without explicit tenant. Default: 'default'. */
  defaultTenantId: z.string().default('default'),
  /** Per-tenant workdir roots. */
  tenantWorkdirs: z.record(z.string(), z.object({
    root: z.string(),
    allowedPaths: z.array(z.string()).optional(),
  })).default({}),
  /** API rate limiting configuration. */
  rateLimit: z.object({
    /** Enable/disable rate limiting (default: true). */
    enabled: z.boolean().default(true),
    /** Max requests per timeWindow for /v1/sessions (default: 100). */
    sessionsMax: z.number().int().positive().default(100),
    /** Max requests per timeWindow for all other endpoints (default: 30). */
    generalMax: z.number().int().positive().default(30),
    /** Time window in seconds (default: 60). */
    timeWindowSec: z.number().int().positive().default(60),
  }).default({ enabled: true, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 }),
});

/** Inferred type for the budgets/misc config domain. */
export type BudgetConfig = z.infer<typeof budgetConfigSchema>;
