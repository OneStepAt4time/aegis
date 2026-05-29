/**
 * openapi/session-permissions.ts — Session permissions and hooks path registrations.
 *
 * Covers: permission policy get/set, permission profile get/set,
 *         permission hook callback, stop hook callback, generic hook callback.
 */

import { z } from 'zod';
import { registerOpenApiPath } from '../../openapi.js';
import {
  validationErrorResponse,
  permissionRuleSchema,
  permissionProfileSchema,
  permissionHookSchema,
  stopHookSchema,
  hookBodySchema,
  okResponse,
  okJsonResponse,
  notFoundResponse,
} from './common.js';

/** Register session permission and hook path descriptors. */
export function registerSessionPermissionPaths(): void {
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
}
