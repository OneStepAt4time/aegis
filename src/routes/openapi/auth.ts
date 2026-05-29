/**
 * openapi/auth.ts — Auth path registrations.
 *
 * Covers: verify token, create/list/revoke/update/rotate API keys, SSE token.
 */

import { z } from 'zod';
import { registerOpenApiPath } from '../../openapi.js';
import {
  authKeySchema,
  updateKeySchema,
  createdAuthKeySchema,
  authKeySummarySchema,
  verifyTokenSchema,
  rotateKeySchema,
  validationErrorResponse,
  okJsonResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse,
  conflictResponse,
} from './common.js';

/** Register auth path descriptors. */
export function registerAuthPaths(): void {
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
    method: 'patch',
    path: '/v1/auth/keys/{id}',
    summary: 'Update API key role, name, or permissions',
    tags: ['Auth'],
    parameters: [{ name: 'id', in: 'path', required: true, description: 'Key ID', schema: z.string() }],
    requestBody: { content: { 'application/json': { schema: updateKeySchema } } },
    responses: { '200': okJsonResponse(createdAuthKeySchema), '404': notFoundResponse, '409': conflictResponse },
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
}
