/**
 * openapi/resources.ts — Pipeline, template, memory, and versioning path registrations.
 *
 * Covers: batch create, pipelines CRUD, templates CRUD, memory CRUD, v2 stub.
 */

import { z } from 'zod';
import { registerOpenApiPath } from '../../openapi.js';
import {
  batchSessionSchema,
  pipelineSchema,
  createTemplateSchema,
  setMemorySchema,
  validationErrorResponse,
  okJsonResponse,
  notFoundResponse,
} from './common.js';

/** Register pipeline, template, memory, and versioning path descriptors. */
export function registerResourcePaths(): void {
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

  // ── Versioning (Issue #1956) ───────────────────────────────────

  registerOpenApiPath({
    method: 'get',
    path: '/v2/',
    summary: 'API v2 migration info (stub)',
    description: 'Returns versioning metadata for the planned v2 API. No v2 endpoints exist yet.',
    tags: ['Versioning'],
    responses: {
      '200': okJsonResponse(z.object({
        version: z.number(),
        status: z.string(),
        message: z.string(),
        migration_guide: z.string(),
        v1_base: z.string(),
      })),
    },
  });
}
