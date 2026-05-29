/**
 * openapi/infra.ts — Infrastructure, metrics, audit, analytics, settings, and events path registrations.
 *
 * Covers: health, handshake, swarm, alerts, webhooks, channels, metrics,
 *         cost breakdown, budget status, rate-limit/quota usage, audit log,
 *         diagnostics, global tool definitions, global SSE events.
 */

import { z } from 'zod';
import { registerOpenApiPath } from '../../openapi.js';
import {
  handshakeRequestSchema,
  validationErrorResponse,
  okJsonResponse,
  unauthorizedResponse,
  forbiddenResponse,
} from './common.js';

/** Register infrastructure, metrics, analytics, and events path descriptors. */
export function registerInfraPaths(): void {
  // ── Health & Infra ──────────────────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/health',
    summary: 'Health check',
    description: 'Server health including Claude CLI status, version, uptime.',
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

  // ── Analytics: Cost breakdown (Issue #2246) ──────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/analytics/costs',
    summary: 'Cost breakdown by model and key',
    description: 'Aggregated cost breakdown derived from MetricsCache. Returns per-model, per-key, and daily cost trends.',
    tags: ['Analytics'],
    responses: {
      '200': okJsonResponse(z.object({
        totalCostUsd: z.number(),
        totalSessions: z.number(),
        byModel: z.array(z.object({
          model: z.string(),
          estimatedCostUsd: z.number(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          cacheCreationTokens: z.number(),
          cacheReadTokens: z.number(),
        })),
        byKey: z.array(z.object({
          keyId: z.string(),
          keyName: z.string(),
          estimatedCostUsd: z.number(),
          sessions: z.number(),
          messages: z.number(),
        })),
        dailyTrends: z.array(z.object({
          date: z.string(),
          estimatedCostUsd: z.number(),
          sessions: z.number(),
        })),
        generatedAt: z.string(),
      })),
      '401': unauthorizedResponse,
      '403': forbiddenResponse,
    },
  });

  // ── Settings: Budget enforcement status (Issue #3811) ──────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/settings/budget',
    summary: 'Server-side budget enforcement status',
    description: 'Returns whether server-side budget enforcement is enabled and what limits are configured. Dashboard uses this to show appropriate warnings when enforcement is not active.',
    tags: ['Settings'],
    responses: {
      '200': okJsonResponse(z.object({
        serverSideEnforcement: z.boolean(),
        dailyLimitUsd: z.number().nullable(),
        monthlyLimitUsd: z.number().nullable(),
        hardStopEnabled: z.boolean(),
        message: z.string(),
      })),
    },
  });

  // ── Analytics: Rate-limit / quota usage (Issue #2248) ──────────

  registerOpenApiPath({
    method: 'get',
    path: '/v1/analytics/rate-limits',
    summary: 'Rate-limit and quota usage',
    description: 'Current rate-limit / quota usage per API key with session forecast based on remaining headroom.',
    tags: ['Analytics'],
    responses: {
      '200': okJsonResponse(z.object({
        global: z.object({
          max: z.number(),
          timeWindowMs: z.number(),
        }),
        perKey: z.array(z.object({
          keyId: z.string(),
          keyName: z.string(),
          activeSessions: z.number(),
          maxSessions: z.number().nullable(),
          tokensInWindow: z.number(),
          maxTokens: z.number().nullable(),
          spendInWindowUsd: z.number(),
          maxSpendUsd: z.number().nullable(),
          windowMs: z.number(),
        })),
        forecast: z.object({
          estimatedSessionsRemaining: z.number().nullable(),
          bottleneck: z.enum(['concurrent_sessions', 'tokens_per_window', 'spend_per_window']).nullable(),
        }),
        generatedAt: z.string(),
      })),
      '401': unauthorizedResponse,
      '403': forbiddenResponse,
    },
  });

  registerOpenApiPath({
    method: 'get',
    path: '/v1/audit',
    summary: 'Audit log',
    description: 'Query or export audit log records with cursor or offset pagination, time filters, and CSV/NDJSON exports. Requires audit permission.',
    tags: ['Metrics'],
    parameters: [
      { name: 'actor', in: 'query', required: false, schema: z.string(), description: 'Filter by actor label (backward compat)' },
      { name: 'actorKeyId', in: 'query', required: false, schema: z.string(), description: 'Filter by actor key identifier' },
      { name: 'action', in: 'query', required: false, schema: z.string() },
      { name: 'sessionId', in: 'query', required: false, schema: z.string() },
      { name: 'from', in: 'query', required: false, schema: z.string(), description: 'Inclusive lower timestamp bound (ISO 8601)' },
      { name: 'to', in: 'query', required: false, schema: z.string(), description: 'Inclusive upper timestamp bound (ISO 8601)' },
      { name: 'cursor', in: 'query', required: false, schema: z.string(), description: 'Pagination cursor (record hash) — use with cursor-based pagination' },
      { name: 'limit', in: 'query', required: false, schema: z.coerce.number().int().min(1).max(1000) },
      { name: 'offset', in: 'query', required: false, schema: z.coerce.number().int().min(0), description: 'Offset for offset-based pagination — triggers export record format' },
      { name: 'reverse', in: 'query', required: false, schema: z.coerce.boolean() },
      { name: 'verify', in: 'query', required: false, schema: z.coerce.boolean() },
      { name: 'format', in: 'query', required: false, schema: z.enum(['json', 'csv', 'ndjson']) },
    ],
    responses: {
      '200': {
        description: 'Success — returns cursor-paginated records, offset-paginated export records, or CSV/NDJSON export',
        content: {
          'application/json': { schema: z.any() },
          'text/csv': { schema: z.string() },
          'application/x-ndjson': { schema: z.string() },
        },
      },
      '400': validationErrorResponse(),
      '401': unauthorizedResponse,
      '403': forbiddenResponse,
    },
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
}
