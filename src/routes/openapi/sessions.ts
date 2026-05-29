/**
 * openapi/sessions.ts — Session CRUD and session data path registrations.
 *
 * Covers: Sessions (list, create, history, stats, health, batch delete, get)
 *         and Session Data (read, transcript, summary, metrics, latency,
 *         tools, screenshot, verify, events, event replay, event schema).
 */

import { z } from 'zod';
import { registerOpenApiPath } from '../../openapi.js';
import {
  validationErrorResponse,
  createSessionSchema,
  batchDeleteSchema,
  screenshotSchema,
  eventReplaySchema,
  okJsonResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from './common.js';

/** Register session CRUD and data path descriptors. */
export function registerSessionPaths(): void {
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
    description: 'Create a new Claude Code session. Reuses an existing idle session for the same workDir if available.',
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

  registerOpenApiPath({
    method: 'post',
    path: '/v1/sessions/{id}/events/replay',
    summary: 'Replay session events',
    description: 'Replay historical events for a session with optional sequence offset.',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    requestBody: { content: { 'application/json': { schema: eventReplaySchema } } },
    responses: {
      '200': okJsonResponse(z.object({ events: z.array(z.any()), nextSeq: z.number().nullable() })),
      '400': validationErrorResponse(),
      '404': notFoundResponse,
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/sessions/{id}/events/schema',
    summary: 'Session event schema',
    description: 'Return the JSON Schema for events emitted by this session.',
    tags: ['Session Data'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Session UUID', schema: z.string().uuid() }],
    responses: {
      '200': okJsonResponse(z.object({ schema: z.any() })),
      '404': notFoundResponse,
    },
  });
}
