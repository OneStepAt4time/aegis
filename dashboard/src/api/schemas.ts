/**
 * api/schemas.ts — Zod runtime validation schemas for critical API responses.
 *
 * These mirror the TypeScript types in types/index.ts. Used by client.ts
 * to validate responses at runtime (defensive — never blocks).
 */

import { z } from 'zod';

// ── Primitives ──────────────────────────────────────────────────

const UIState = z.enum([
  'idle',
  'working',
  'permission_prompt',
  'plan_mode',
  'ask_question',
  'bash_approval',
  'settings',
  'unknown',
]);

// ── OkResponse ──────────────────────────────────────────────────

export const OkResponseSchema = z.object({
  ok: z.boolean(),
});

// ── SendResponse ────────────────────────────────────────────────

export const SendResponseSchema = OkResponseSchema.extend({
  delivered: z.boolean(),
  attempts: z.number(),
});

// ── HealthResponse ──────────────────────────────────────────────

export const HealthResponseSchema = z.object({
  status: z.string(),
  version: z.string(),
  uptime: z.number(),
  sessions: z.object({
    active: z.number(),
    total: z.number(),
  }),
  timestamp: z.string(),
});

// ── SessionInfo ─────────────────────────────────────────────────

export const SessionInfoSchema = z.object({
  id: z.string(),
  windowId: z.string(),
  windowName: z.string(),
  workDir: z.string(),
  claudeSessionId: z.string().optional(),
  jsonlPath: z.string().optional(),
  byteOffset: z.number(),
  monitorOffset: z.number(),
  status: UIState,
  createdAt: z.number(),
  lastActivity: z.number(),
  stallThresholdMs: z.number(),
  permissionMode: z.string(),
  autoApprove: z.boolean().optional(),
  settingsPatched: z.boolean().optional(),
  promptDelivery: z.object({ delivered: z.boolean(), attempts: z.number() }).optional(),
  actionHints: z.record(z.string(), z.object({
    method: z.string(),
    url: z.string(),
    description: z.string(),
  })).optional(),
});

// ── SessionsListResponse ────────────────────────────────────────

export const SessionsListResponseSchema = z.object({
  sessions: z.array(SessionInfoSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});
