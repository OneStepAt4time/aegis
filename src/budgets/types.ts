/**
 * budgets/types.ts — Budget data model and Zod validation schemas.
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 * ADR-0031: /v1/budgets API Design for Cost Alerts.
 */

import { z } from 'zod';

// ── Interfaces ───────────────────────────────────────────────────────

export interface BudgetWindow {
  kind: 'rolling' | 'calendar';
  hours: number;
}

export type NotificationChannel =
  | { type: 'telegram'; chatId: number }
  | { type: 'webhook'; url: string }
  | { type: 'log' };

export interface Budget {
  id: string;
  name: string;
  keyId: string | null;
  limitUsd: number;
  thresholds: number[];
  window: BudgetWindow;
  channels: NotificationChannel[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastEvaluatedAt: string | null;
}

// ── Zod schemas ──────────────────────────────────────────────────────

export const budgetWindowSchema = z.object({
  kind: z.enum(['rolling', 'calendar']),
  hours: z.number().int().min(1).max(720),
});

export const notificationChannelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('telegram'), chatId: z.number().int() }),
  z.object({ type: z.literal('webhook'), url: z.string().url().max(2048) }),
  z.object({ type: z.literal('log') }),
]);

export const createBudgetSchema = z.object({
  name: z.string().min(1).max(128),
  keyId: z.string().nullable().default(null),
  limitUsd: z.number().positive().max(1_000_000),
  thresholds: z
    .array(z.number().int().min(1).max(200))
    .min(1)
    .max(10)
    .refine(
      (arr) => arr.length === new Set(arr).size,
      { message: 'Thresholds must be unique' },
    )
    .transform((arr) => [...arr].sort((a, b) => a - b)),
  window: budgetWindowSchema,
  channels: z.array(notificationChannelSchema).min(1).max(10),
  enabled: z.boolean().default(true),
});

export const updateBudgetSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  keyId: z.string().nullable().optional(),
  limitUsd: z.number().positive().max(1_000_000).optional(),
  thresholds: z
    .array(z.number().int().min(1).max(200))
    .min(1)
    .max(10)
    .refine(
      (arr) => arr.length === new Set(arr).size,
      { message: 'Thresholds must be unique' },
    )
    .transform((arr) => [...arr].sort((a, b) => a - b))
    .optional(),
  window: budgetWindowSchema.optional(),
  channels: z.array(notificationChannelSchema).min(1).max(10).optional(),
  enabled: z.boolean().optional(),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;

// ── Evaluation state ─────────────────────────────────────────────────

export interface BudgetEvalState {
  windowStart: string;
  firedThresholds: number[];
  lastAlertAt: string | null;
}

export interface BudgetsStateFile {
  version: 1;
  evaluations: Record<string, BudgetEvalState>;
}

// ── Evaluation result ────────────────────────────────────────────────

export interface BudgetEvaluationResult {
  budgetId: string;
  windowStart: string;
  windowEnd: string;
  currentSpendUsd: number;
  limitUsd: number;
  percentUsed: number;
  triggeredThresholds: number[];
  alertsSent: number;
}
