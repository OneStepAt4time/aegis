/**
 * validation.ts — Zod schemas for API request body validation.
 *
 * Issue #359: Centralized validation for all POST route bodies.
 */

import { z } from 'zod';

/** Regex for UUID v4 format: 8-4-4-4-12 hex digits */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /v1/auth/keys */
export const authKeySchema = z.object({
  name: z.string().min(1),
  rateLimit: z.number().int().positive().optional(),
}).strict();

/** POST /v1/sessions/:id/send */
export const sendMessageSchema = z.object({
  text: z.string().min(1),
}).strict();

/** POST /v1/sessions/:id/command */
export const commandSchema = z.object({
  command: z.string().min(1),
}).strict();

/** POST /v1/sessions/:id/bash */
export const bashSchema = z.object({
  command: z.string().min(1),
}).strict();

/** POST /v1/sessions/:id/screenshot */
export const screenshotSchema = z.object({
  url: z.string().min(1),
  fullPage: z.boolean().optional(),
  width: z.number().int().positive().max(7680).optional(),
  height: z.number().int().positive().max(4320).optional(),
}).strict();

/** Webhook endpoint — validates structure of each webhook entry */
export const webhookEndpointSchema = z.object({
  url: z.string().min(1),
  events: z.array(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
}).strict();

/** POST /v1/sessions/:id/hooks/permission */
export const permissionHookSchema = z.object({
  session_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  permission_mode: z.string().optional(),
  hook_event_name: z.string().optional(),
}).strict();

/** POST /v1/sessions/:id/hooks/stop */
export const stopHookSchema = z.object({
  session_id: z.string().optional(),
  stop_reason: z.string().optional(),
  hook_event_name: z.string().optional(),
}).strict();

const batchSessionSpecSchema = z.object({
  name: z.string().max(200).optional(),
  workDir: z.string().min(1),
  prompt: z.string().max(100_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan']).optional(),
  autoApprove: z.boolean().optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
});

/** POST /v1/sessions/batch — max 50 sessions per batch */
export const batchSessionSchema = z.object({
  sessions: z.array(batchSessionSpecSchema).min(1).max(50),
}).strict();

const pipelineStageSchema = z.object({
  name: z.string().min(1),
  workDir: z.string().min(1).optional(),
  prompt: z.string().min(1),
  dependsOn: z.array(z.string()).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan']).optional(),
  autoApprove: z.boolean().optional(),
});

/** POST /v1/pipelines */
export const pipelineSchema = z.object({
  name: z.string().min(1),
  workDir: z.string().min(1),
  stages: z.array(pipelineStageSchema).min(1),
}).strict();

/** Clamp a numeric value to [min, max]. Returns default if input is NaN. */
export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

/** Parse an env string to integer with NaN/isFinite guard. Returns fallback on failure. */
export function parseIntSafe(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

/** Validate that a string looks like a UUID. */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}
