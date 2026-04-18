/**
 * routes/openapi.ts — OpenAPI 3.1 spec registration and serving.
 *
 * Registers all v1 REST endpoint descriptors centrally and serves the
 * generated OpenAPI 3.1 document at GET /v1/openapi.json.
 *
 * Route modules stay the source of truth for runtime behavior.
 * This module is the source of truth for the machine-readable API contract.
 *
 * Issue #1909.
 */

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  registerOpenApiPath,
  generateOpenApiDocument,
  validationErrorResponse,
} from '../openapi.js';
import {
  authKeySchema,
  sendMessageSchema,
  commandSchema,
  bashSchema,
  screenshotSchema,
  hookBodySchema,
  permissionHookSchema,
  stopHookSchema,
  batchSessionSchema,
  pipelineSchema,
  handshakeRequestSchema,
  permissionRuleSchema,
  permissionProfileSchema,
} from '../validation.js';

// ── Local schemas (mirrors of inline schemas from route modules) ───

const sessionIdParam = z.object({ id: z.string().uuid() });
const templateIdParam = z.object({ id: z.string() });
const keyIdParam = z.object({ id: z.string() });
const eventIdParam = z.object({ id: z.string() });
const eventNameParam = z.object({ eventName: z.string() });
const memoryKeyParam = z.object({ key: z.string() });
const apiKeyPermissionSchema = z.enum(['create', 'send', 'approve', 'reject', 'kill']);
const authKeySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  rateLimit: z.number(),
  expiresAt: z.number().nullable(),
  role: z.enum(['admin', 'operator', 'viewer']),
  permissions: z.array(apiKeyPermissionSchema),
});
const createdAuthKeySchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  expiresAt: z.number().nullable(),
  role: z.enum(['admin', 'operator', 'viewer']),
  permissions: z.array(apiKeyPermissionSchema),
});

const createSessionSchema = z.object({
  workDir: z.string().min(1),
  name: z.string().max(200).optional(),
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

const batchDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).max(100).optional(),
  status: z.enum([
    'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
    'settings', 'error', 'unknown',
  ]).optional(),
});

const sessionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
  project: z.string().optional(),
});

const sessionHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.string().optional(),
  ownerKeyId: z.string().optional(),
});

const verifyTokenSchema = z.object({ token: z.string().min(1) }).strict();
const rotateKeySchema = z.object({ ttlDays: z.number().int().positive().optional() }).strict();

const auditQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  sessionId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  reverse: z.coerce.boolean().optional(),
  verify: z.coerce.boolean().optional(),
});

const diagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createTemplateSchema = z.object({
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

const setMemorySchema = z.object({
  key: z.string().max(256),
  value: z.string().max(100 * 1024),
  ttlSeconds: z.number().int().positive().max(86400 * 30).optional(),
}).strict();

const sessionMemoryWriteSchema = z.object({
  key: z.string().max(256),
  value: z.string().max(100 * 1024),
  ttlSeconds: z.number().int().positive().max(86400 * 30).optional(),
}).strict();

const spawnSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
  workDir: z.string().optional(),
  permissionMode: z.string().optional(),
});

const forkSchema = z.object({
  name: z.string().optional(),
  prompt: z.string().optional(),
});

const answerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string(),
});

const transcriptQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
});

const transcriptCursorQuerySchema = z.object({
  before_id: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
});

const hookQuerySchema = z.object({
  sessionId: z.string().optional(),
  secret: z.string().optional(),
});

// ── Common response schemas ─────────────────────────────────────────

const okResponse = { description: 'Success' };
const okJsonResponse = (schema: z.ZodType) => ({
  description: 'Success',
  content: { 'application/json': { schema } },
});
const notFoundResponse = { description: 'Not found' };
const unauthorizedResponse = { description: 'Unauthorized — Bearer token required' };
const forbiddenResponse = { description: 'Forbidden: insufficient role' };

// ── Registration ────────────────────────────────────────────────────

/** Register all OpenAPI path descriptors. Called once at startup. */
export function registerOpenApiSpec(): void {
  // ── Sessions ────────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions',
    summary: 'List sessions',
    description: 'List active sessions with pagination, status, and project filters.',
    tags: ['Sessions'],
    parameters: [
      { name: 'page', in: 'query', schema: z.coerce.number().int().min(1), description: 'Page number (1-based)' },
      { name: 'limit', in: 'query', schema: z.coerce.number().int().min(1).max(100), description: 'Items per page' },
      { name: 'status', in: 'query', schema: z.string(), description: 'Filter by session status' },
      { name: 'project', in: 'query', schema: z.string(), description: 'Filter by project (workDir substring)' },
    ],
    responses: {
      '200': okJsonResponse(z.object({ sessions: z.array(z.any()), pagination: z.any() })),
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions',
    summary: 'Create session',
    description: 'Create a new Claude Code session in a tmux window. Reuses an existing idle session for the same workDir if available.',
    tags: ['Sessions'],
    requestBody: {
      description: 'Session creation parameters',
      content: { 'application/json': { schema: createSessionSchema } },
    },
    responses: {
      '201': okJsonResponse(z.any()),
      '200': { description: 'Reused existing idle session', content: { 'application/json': { schema: z.any() } } },
      '400': validationErrorResponse(),
      '422': { description: 'Claude Code version too old', content: { 'application/json': { schema: z.object({ error: z.string(), code: z.string() }) } } },
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/history',
    summary: 'Session history',
    description: 'Paginated session history (created/killed + active).',
    tags: ['Sessions'],
    parameters: [
      { name: 'page', in: 'query', required: false, schema: z.coerce.number().int().min(1) },
      { name: 'limit', in: 'query', required: false, schema: z.coerce.number().int().min(1).max(200) },
      { name: 'status', in: 'query', required: false, schema: z.string() },
      { name: 'ownerKeyId', in: 'query', required: false, schema: z.string() },
    ],
    responses: {
      '200': okJsonResponse(z.any()),
      '401': unauthorizedResponse,
      '403': forbiddenResponse,
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/stats',
    summary: 'Session statistics',
    description: 'Aggregated session statistics: active count, by status, totals.',
    tags: ['Sessions'],
    responses: { '200': okJsonResponse(z.any()), '401': unauthorizedResponse, '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/health',
    summary: 'Bulk health check',
    description: 'Health status for all visible sessions.',
    tags: ['Sessions'],
    responses: { '200': okJsonResponse(z.any()), '401': unauthorizedResponse, '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'delete',
    path: '/v1/sessions/batch',
    summary: 'Bulk delete sessions',
    description: 'Kill and remove sessions by IDs or status filter.',
    tags: ['Sessions'],
    requestBody: {
      description: 'Batch delete parameters — at least one of ids or status is required',
      content: { 'application/json': { schema: batchDeleteSchema } },
    },
    responses: {
      '200': okJsonResponse(z.object({ deleted: z.number(), notFound: z.array(z.string()), errors: z.array(z.string()) })),
      '400': validationErrorResponse(),
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}',
    summary: 'Get session',
    description: 'Get session details by ID, including action hints for interactive states.',
    tags: ['Sessions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse, '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/health',
    summary: 'Session health check',
    tags: ['Sessions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  // ── Session Actions ─────────────────────────────────────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/send',
    summary: 'Send message to session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: sendMessageSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), delivered: z.boolean(), attempts: z.number() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/command',
    summary: 'Send slash command',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: commandSchema } } },
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/bash',
    summary: 'Execute bash command',
    description: 'Run a bash command in the session and capture output.',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: bashSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean(), output: z.string().optional() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/escape',
    summary: 'Send Escape key',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/interrupt',
    summary: 'Send Ctrl+C',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'delete',
    path: '/v1/sessions/{id}',
    summary: 'Kill session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/pane',
    summary: 'Capture raw pane',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ pane: z.string() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/children',
    summary: 'Get child sessions',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Parent session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ children: z.array(z.any()) })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/spawn',
    summary: 'Spawn child session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Parent session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: spawnSchema } } },
    responses: { '201': okJsonResponse(z.any()), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/fork',
    summary: 'Fork session',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Parent session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: forkSchema } } },
    responses: { '201': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/approve',
    summary: 'Approve permission request',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/reject',
    summary: 'Reject permission request',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/answer',
    summary: 'Answer pending question',
    tags: ['Session Actions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: answerSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ ok: z.boolean() })),
      '400': validationErrorResponse(),
      '409': { description: 'No pending question matching this questionId' },
    },
  });

  // ── Session Data ────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/read',
    summary: 'Read session messages',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/transcript',
    summary: 'Paginated transcript read',
    tags: ['Session Data'],
    parameters: [
      { name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() },
      { name: 'page', in: 'query', required: false, schema: z.coerce.number().int().min(1) },
      { name: 'limit', in: 'query', required: false, schema: z.coerce.number().int().min(1).max(200) },
      { name: 'role', in: 'query', required: false, schema: z.enum(['user', 'assistant', 'system']) },
    ],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/transcript/cursor',
    summary: 'Cursor-based transcript replay',
    tags: ['Session Data'],
    parameters: [
      { name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() },
      { name: 'before_id', in: 'query', required: false, schema: z.coerce.number().int().min(1) },
      { name: 'limit', in: 'query', required: false, schema: z.coerce.number().int().min(1).max(200) },
      { name: 'role', in: 'query', required: false, schema: z.enum(['user', 'assistant', 'system']) },
    ],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/summary',
    summary: 'Session summary',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/metrics',
    summary: 'Per-session metrics',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/latency',
    summary: 'Per-session latency metrics',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/tools',
    summary: 'Per-session tool usage',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/screenshot',
    summary: 'Capture screenshot',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: screenshotSchema } } },
    responses: {
      '200': okJsonResponse(z.any()),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
      '501': { description: 'Playwright not installed' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/verify',
    summary: 'Run verification protocol',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: {
      '200': okJsonResponse(z.any()),
      '422': { description: 'Verification failed' },
      '404': notFoundResponse,
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/events',
    summary: 'Per-session SSE event stream',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': { description: 'SSE event stream (text/event-stream)' } },
  });

  // ── Session Permissions ─────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/permissions',
    summary: 'Get permission policy',
    tags: ['Permissions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'put',
    path: '/v1/sessions/{id}/permissions',
    summary: 'Set permission policy',
    tags: ['Permissions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: permissionRuleSchema.array() } } },
    responses: { '200': okJsonResponse(z.any()), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/permission-profile',
    summary: 'Get permission profile',
    tags: ['Permissions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'put',
    path: '/v1/sessions/{id}/permission-profile',
    summary: 'Set permission profile',
    tags: ['Permissions'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: permissionProfileSchema } } },
    responses: { '200': okJsonResponse(z.any()), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  // ── Session Hooks (Claude Code callback endpoints) ──────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/hooks/permission',
    summary: 'Permission hook callback',
    description: 'Called by Claude Code when a permission prompt occurs.',
    tags: ['Hooks'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: permissionHookSchema } } },
    responses: { '200': okResponse, '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/hooks/stop',
    summary: 'Stop hook callback',
    description: 'Called by Claude Code when a session stops.',
    tags: ['Hooks'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: stopHookSchema } } },
    responses: { '200': okResponse, '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/hooks/{eventName}',
    summary: 'Generic hook callback',
    description: 'Claude Code hook event endpoint. Requires hook secret if configured.',
    tags: ['Hooks'],
    parameters: [
      { name: 'eventName', in: 'path', required: true, description: 'Hook event name', schema: z.string() },
      { name: 'sessionId', in: 'query', required: false, schema: z.string() },
      { name: 'secret', in: 'query', required: false, schema: z.string() },
    ],
    requestBody: { content: { 'application/json': { schema: hookBodySchema } } },
    responses: { '200': okResponse, '400': validationErrorResponse(), '404': notFoundResponse },
  });

  // ── Auth ────────────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/auth/verify',
    summary: 'Verify auth token',
    tags: ['Auth'],
    requestBody: { content: { 'application/json': { schema: verifyTokenSchema } } },
    responses: {
      '200': okJsonResponse(z.object({ valid: z.boolean(), role: z.enum(['admin', 'operator', 'viewer']).optional() })),
      '401': { description: 'Invalid token' },
      '429': { description: 'Rate limited' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/auth/keys',
    summary: 'Create API key',
    tags: ['Auth'],
    requestBody: { content: { 'application/json': { schema: authKeySchema } } },
    responses: { '201': okJsonResponse(createdAuthKeySchema), '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/auth/keys',
    summary: 'List API keys',
    tags: ['Auth'],
    responses: { '200': okJsonResponse(z.array(authKeySummarySchema)), '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'delete',
    path: '/v1/auth/keys/{id}',
    summary: 'Revoke API key',
    tags: ['Auth'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Key ID', schema: z.string() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/auth/keys/{id}/rotate',
    summary: 'Rotate API key',
    tags: ['Auth'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Key ID', schema: z.string() }],
    requestBody: { content: { 'application/json': { schema: rotateKeySchema } } },
    responses: { '200': okJsonResponse(createdAuthKeySchema), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/auth/sse-token',
    summary: 'Generate SSE token',
    tags: ['Auth'],
    responses: { '201': okJsonResponse(z.any()), '429': { description: 'SSE token limit reached' } },
  });

  // ── Health & Infra ──────────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/health',
    summary: 'Health check',
    description: 'Server health including tmux status, Claude CLI status, version, uptime.',
    tags: ['Health'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/handshake',
    summary: 'Protocol handshake',
    tags: ['Health'],
    requestBody: { content: { 'application/json': { schema: handshakeRequestSchema } } },
    responses: {
      '200': okJsonResponse(z.any()),
      '409': { description: 'Incompatible protocol version' },
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/swarm',
    summary: 'Swarm awareness scan',
    tags: ['Health'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/alerts/stats',
    summary: 'Alert manager stats',
    tags: ['Health'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/alerts/test',
    summary: 'Fire test alert',
    tags: ['Health'],
    responses: { '200': okJsonResponse(z.any()), '502': { description: 'Alert delivery failed' } },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/webhooks/dead-letter',
    summary: 'Webhook dead letter queue',
    tags: ['Health'],
    responses: { '200': okJsonResponse(z.array(z.any())) },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/channels/health',
    summary: 'Channel health reporting',
    tags: ['Health'],
    responses: { '200': okJsonResponse(z.array(z.any())) },
  });

  // ── Metrics & Audit ─────────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/metrics',
    summary: 'Global metrics',
    tags: ['Metrics'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/audit',
    summary: 'Audit log',
    description: 'Query audit log with optional filters. Admin only.',
    tags: ['Metrics'],
    parameters: [
      { name: 'actor', in: 'query', required: false, schema: z.string() },
      { name: 'action', in: 'query', required: false, schema: z.string() },
      { name: 'sessionId', in: 'query', required: false, schema: z.string().uuid() },
      { name: 'limit', in: 'query', required: false, schema: z.coerce.number().int().min(1).max(1000) },
      { name: 'reverse', in: 'query', required: false, schema: z.coerce.boolean() },
      { name: 'verify', in: 'query', required: false, schema: z.coerce.boolean() },
    ],
    responses: { '200': okJsonResponse(z.any()), '401': unauthorizedResponse, '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/diagnostics',
    summary: 'Diagnostics channel',
    tags: ['Metrics'],
    parameters: [
      { name: 'limit', in: 'query', required: false, schema: z.coerce.number().int().min(1).max(100) },
    ],
    responses: { '200': okJsonResponse(z.any()), '401': unauthorizedResponse, '403': forbiddenResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/tools',
    summary: 'Global tool definitions',
    tags: ['Metrics'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  // ── Events ──────────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/events',
    summary: 'Global SSE event stream',
    description: 'Aggregates events from ALL active sessions via Server-Sent Events.',
    tags: ['Events'],
    responses: { '200': { description: 'SSE event stream (text/event-stream)' } },
  });

  // ── Pipelines ──────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/batch',
    summary: 'Batch create sessions',
    description: 'Create up to 50 sessions in a single request.',
    tags: ['Pipelines'],
    requestBody: { content: { 'application/json': { schema: batchSessionSchema } } },
    responses: {
      '201': okJsonResponse(z.any()),
      '400': validationErrorResponse(),
      '429': { description: 'Rate limit or session cap exceeded' },
    },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/pipelines',
    summary: 'Create pipeline',
    tags: ['Pipelines'],
    requestBody: { content: { 'application/json': { schema: pipelineSchema } } },
    responses: { '201': okJsonResponse(z.any()), '400': validationErrorResponse() },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/pipelines',
    summary: 'List pipelines',
    tags: ['Pipelines'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/pipelines/{id}',
    summary: 'Get pipeline status',
    tags: ['Pipelines'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Pipeline ID', schema: z.string() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  // ── Templates ───────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/templates',
    summary: 'Create session template',
    tags: ['Templates'],
    requestBody: { content: { 'application/json': { schema: createTemplateSchema } } },
    responses: { '201': okJsonResponse(z.any()), '400': validationErrorResponse() },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/templates',
    summary: 'List templates',
    tags: ['Templates'],
    responses: { '200': okJsonResponse(z.array(z.any())) },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/templates/{id}',
    summary: 'Get template',
    tags: ['Templates'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Template ID', schema: z.string() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'put',
    path: '/v1/templates/{id}',
    summary: 'Update template',
    tags: ['Templates'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Template ID', schema: z.string() }],
    requestBody: { content: { 'application/json': { schema: createTemplateSchema.partial() } } },
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'delete',
    path: '/v1/templates/{id}',
    summary: 'Delete template',
    tags: ['Templates'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Template ID', schema: z.string() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  // ── Memory ──────────────────────────────────────────────────────

  registerOpenApiPath({
    method: 'post',
    path: '/v1/memory',
    summary: 'Write memory entry',
    tags: ['Memory'],
    requestBody: { content: { 'application/json': { schema: setMemorySchema } } },
    responses: { '200': okJsonResponse(z.any()), '400': validationErrorResponse(), '413': { description: 'Value exceeds maximum size' } },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/memory',
    summary: 'List memory entries',
    tags: ['Memory'],
    responses: { '200': okJsonResponse(z.any()) },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/memory/{key}',
    summary: 'Get memory entry',
    tags: ['Memory'],
    parameters: [{ name: 'key', in: 'path', required: true, description: 'Memory key', schema: z.string() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'delete',
    path: '/v1/memory/{key}',
    summary: 'Delete memory entry',
    tags: ['Memory'],
    parameters: [{ name: 'key', in: 'path', required: true, description: 'Memory key', schema: z.string() }],
    responses: { '200': okJsonResponse(z.object({ ok: z.boolean() })), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/memories',
    summary: 'Write session-scoped memory',
    tags: ['Memory'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: sessionMemoryWriteSchema } } },
    responses: { '200': okJsonResponse(z.any()), '400': validationErrorResponse(), '404': notFoundResponse },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/memories',
    summary: 'List session memories',
    tags: ['Memory'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: { '200': okJsonResponse(z.any()), '404': notFoundResponse },
  });
}

// ── Route handler ──────────────────────────────────────────────────

/**
 * Register the OpenAPI spec endpoint.
 * Must be called AFTER registerOpenApiSpec().
 */
export function registerOpenApiRoute(app: FastifyInstance): void {
  app.get('/v1/openapi.json', async (_req, reply) => {
    const doc = generateOpenApiDocument();
    return reply
      .header('Content-Type', 'application/json')
      .header('Access-Control-Allow-Origin', '*')
      .send(doc);
  });
}
