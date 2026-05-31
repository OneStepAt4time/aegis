/**
 * openapi/common.ts — Shared schemas and response helpers for OpenAPI spec modules.
 *
 * Extracted from the monolithic openapi.ts to allow per-domain modules to
 * reference common param schemas, response helpers, and cross-cutting types.
 */

import { z } from 'zod';
import { validationErrorResponse } from '../../openapi.js';
import {
  authKeySchema,
  updateKeySchema,
  sendMessageSchema,
  commandSchema,
  screenshotSchema,
  hookBodySchema,
  permissionHookSchema,
  stopHookSchema,
  batchSessionSchema,
  pipelineSchema,
  handshakeRequestSchema,
  permissionRuleSchema,
  permissionProfileSchema,
  pauseSessionSchema,
  resumeSessionSchema,
  cancelSessionSchema,
  startInterventionSchema,
  completeInterventionSchema,
  eventReplaySchema,
} from '../../validation.js';

// Re-export for convenience
export {
  authKeySchema,
  updateKeySchema,
  sendMessageSchema,
  commandSchema,
  screenshotSchema,
  hookBodySchema,
  permissionHookSchema,
  stopHookSchema,
  batchSessionSchema,
  pipelineSchema,
  handshakeRequestSchema,
  permissionRuleSchema,
  permissionProfileSchema,
  pauseSessionSchema,
  resumeSessionSchema,
  cancelSessionSchema,
  startInterventionSchema,
  completeInterventionSchema,
  eventReplaySchema,
  validationErrorResponse,
};

// ── Local schemas (mirrors of inline schemas from route modules) ───

export const sessionIdParam = z.object({ id: z.string().uuid() });
export const templateIdParam = z.object({ id: z.string() });
export const keyIdParam = z.object({ id: z.string() });
export const eventIdParam = z.object({ id: z.string() });
export const eventNameParam = z.object({ eventName: z.string() });
export const memoryKeyParam = z.object({ key: z.string() });
export const apiKeyPermissionSchema = z.enum(['create', 'send', 'approve', 'reject', 'kill']);
export const authKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  rateLimit: z.number(),
  expiresAt: z.number().nullable(),
  role: z.enum(['admin', 'operator', 'viewer']),
  permissions: z.array(apiKeyPermissionSchema),
});
export const createdAuthKeySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  expiresAt: z.number().nullable(),
  role: z.enum(['admin', 'operator', 'viewer']),
  permissions: z.array(apiKeyPermissionSchema),
});

export const createSessionSchema = z.object({
  workDir: z.string().min(1),
  name: z.string().max(200).optional(),
  /** Alias for `name`. */
  label: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
  prd: z.string().max(100_000).optional(),
  resumeSessionId: z.string().uuid().optional(),
  claudeCommand: z.string().max(500).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  parentId: z.string().uuid().optional(),
  memoryKeys: z.array(z.string()).max(50).optional(),
}).strict();

export const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  status: z.enum([
    'pending', 'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
    'settings', 'error', 'rate_limit', 'unknown',
  ]).optional(),
});

export const sessionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
  project: z.string().optional(),
});

export const sessionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
  status: z.string().optional(),
  ownerKeyId: z.string().optional(),
  name: z.string().optional(),
  createdAfter: z.coerce.number().optional(),
  createdBefore: z.coerce.number().optional(),
  sortBy: z.enum(['createdAt', 'lastSeenAt', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const verifyTokenSchema = z.object({ token: z.string().min(1) }).strict();
export const rotateKeySchema = z.object({ ttlDays: z.number().int().positive().optional() }).strict();

export const auditRecordSchema = z.object({
  ts: z.string(),
  actor: z.string(),
  action: z.string(),
  sessionId: z.string().optional(),
  detail: z.string(),
  prevHash: z.string(),
  hash: z.string(),
});

export const auditExportRecordSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  actorKeyId: z.string(),
  sessionId: z.string(),
  action: z.string(),
  resource: z.string(),
  hash: z.string(),
  prevHash: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export const auditChainSchema = z.object({
  count: z.number().int().nonnegative(),
  firstHash: z.string().nullable(),
  lastHash: z.string().nullable(),
  badgeHash: z.string().nullable(),
  firstTs: z.string().nullable(),
  lastTs: z.string().nullable(),
});

export const auditIntegritySchema = z.object({
  valid: z.boolean(),
  brokenAt: z.number().int().positive().optional(),
  file: z.string().optional(),
});

export const auditPaginationSchema = z.object({
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  reverse: z.boolean(),
});

export const auditOffsetPaginationSchema = z.object({
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export const auditFiltersSchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  sessionId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const auditPageResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  records: z.array(auditRecordSchema),
  filters: auditFiltersSchema,
  pagination: auditPaginationSchema,
  chain: auditChainSchema,
  integrity: auditIntegritySchema.optional(),
});

export const auditOffsetResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  records: z.array(auditExportRecordSchema),
  pagination: auditOffsetPaginationSchema,
  integrity: auditIntegritySchema.optional(),
});

export const auditQuerySchema = z.object({
  actor: z.string().optional(),
  actorKeyId: z.string().optional(),
  action: z.string().optional(),
  sessionId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  reverse: z.coerce.boolean().optional(),
  verify: z.coerce.boolean().optional(),
  format: z.enum(['json', 'csv', 'ndjson']).optional(),
});

export const diagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createTemplateSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  sessionId: z.string().uuid().optional(),
  workDir: z.string().min(1).optional(),
  prompt: z.string().max(100_000).optional(),
  claudeCommand: z.string().max(500).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  memoryKeys: z.array(z.string()).max(50).optional(),
}).strict();

export const setMemorySchema = z.object({
  key: z.string().max(256),
  value: z.string().max(100 * 1024),
  ttlSeconds: z.number().int().positive().max(86400 * 30).optional(),
}).strict();

export const spawnSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  workDir: z.string().optional(),
  permissionMode: z.string().optional(),
});

export const forkSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
});

export const answerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
});

export const transcriptQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
});

export const transcriptCursorQuerySchema = z.object({
  before_id: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
});

export const hookQuerySchema = z.object({
  sessionId: z.string().optional(),
  secret: z.string().optional(),
});

// ── Common response schemas ─────────────────────────────────────────

export const okResponse = { description: 'Success' };
export const okJsonResponse = (schema: z.ZodType) => ({
  description: 'Success',
  content: { 'application/json': { schema } },
});
export const notFoundResponse = { description: 'Not found' };
export const unauthorizedResponse = { description: 'Unauthorized — Bearer token required' };
export const forbiddenResponse = { description: 'Forbidden: insufficient role' };
export const conflictResponse = { description: 'Conflict: self-demotion guard or duplicate name' };
