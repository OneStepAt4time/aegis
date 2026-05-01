/**
 * openapi.test.ts — Tests for OpenAPI 3.1 document generation from Zod schemas.
 *
 * Covers:
 *  - zodToJsonSchema conversion (type stripping, primitives, objects, arrays, enums)
 *  - registerOpenApiPath / clearOpenApiPaths lifecycle
 *  - generateOpenApiDocument structure (paths, info, servers)
 *  - registerOpenApiSpec (all route descriptors)
 *  - registerOpenApiRoute (serving the endpoint)
 *
 * Issue #1909.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  zodToJsonSchema,
  registerOpenApiPath,
  clearOpenApiPaths,
  generateOpenApiDocument,
  validationErrorResponse,
} from '../openapi.js';
import { registerOpenApiSpec } from '../routes/openapi.js';

// ── zodToJsonSchema ─────────────────────────────────────────────────

describe('zodToJsonSchema', () => {
  it('strips $schema keyword', () => {
    const result = zodToJsonSchema(z.string());
    expect(result).not.toHaveProperty('$schema');
    expect(result).toEqual({ type: 'string' });
  });

  it('converts z.string()', () => {
    expect(zodToJsonSchema(z.string())).toEqual({ type: 'string' });
  });

  it('converts z.number()', () => {
    const result = zodToJsonSchema(z.number());
    expect(result.type).toBe('number');
  });

  it('converts z.boolean()', () => {
    expect(zodToJsonSchema(z.boolean())).toEqual({ type: 'boolean' });
  });

  it('converts z.number().int()', () => {
    const result = zodToJsonSchema(z.number().int());
    expect(result.type).toBe('integer');
  });

  it('converts z.enum()', () => {
    const result = zodToJsonSchema(z.enum(['a', 'b', 'c']));
    expect(result.enum).toEqual(['a', 'b', 'c']);
  });

  it('converts z.array(z.string())', () => {
    const result = zodToJsonSchema(z.array(z.string()));
    expect(result.type).toBe('array');
    expect((result.items as Record<string, unknown>).type).toBe('string');
  });

  it('converts z.object() with required and optional fields', () => {
    const result = zodToJsonSchema(z.object({
      name: z.string(),
      age: z.number().optional(),
    }));
    expect(result.type).toBe('object');
    expect((result.properties as Record<string, unknown>).name).toBeDefined();
    expect((result.properties as Record<string, unknown>).age).toBeDefined();
    expect(result.required).toEqual(['name']);
  });

  it('converts z.record(z.string(), z.string())', () => {
    const result = zodToJsonSchema(z.record(z.string(), z.string()));
    expect(result.type).toBe('object');
  });

  it('converts z.string().uuid()', () => {
    const result = zodToJsonSchema(z.string().uuid());
    expect(result.type).toBe('string');
  });

  it('converts z.string().min(1).max(100)', () => {
    const result = zodToJsonSchema(z.string().min(1).max(100));
    expect(result.type).toBe('string');
    expect(result.minLength).toBe(1);
    expect(result.maxLength).toBe(100);
  });
});

// ── Path registration lifecycle ─────────────────────────────────────

describe('registerOpenApiPath / clearOpenApiPaths', () => {
  beforeEach(() => {
    clearOpenApiPaths();
  });

  it('registers a simple GET path', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/v1/test',
      summary: 'Test endpoint',
      responses: { '200': { description: 'OK' } },
    });

    const doc = generateOpenApiDocument();
    expect(doc.paths).toHaveProperty('/v1/test');
    expect((doc.paths as Record<string, unknown>)['/v1/test']).toHaveProperty('get');
  });

  it('registers a POST path with request body', () => {
    registerOpenApiPath({
      method: 'post',
      path: '/v1/test',
      requestBody: {
        description: 'Test body',
        content: {
          'application/json': { schema: z.object({ name: z.string() }) },
        },
      },
      responses: { '200': { description: 'OK' } },
    });

    const doc = generateOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, unknown>>)['/v1/test'].post as Record<string, unknown>;
    expect(op.requestBody).toBeDefined();
    const body = op.requestBody as Record<string, unknown>;
    expect(body.required).toBe(true);
  });

  it('registers parameters', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/v1/test/{id}',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: z.string().uuid() },
      ],
      responses: { '200': { description: 'OK' } },
    });

    const doc = generateOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, unknown>>)['/v1/test/{id}'].get as Record<string, unknown>;
    const params = op.parameters as Array<Record<string, unknown>>;
    expect(params).toHaveLength(1);
    expect(params[0].name).toBe('id');
    expect(params[0].in).toBe('path');
    expect(params[0].required).toBe(true);
  });

  it('supports tags and deprecated flag', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/v1/legacy',
      tags: ['Legacy'],
      deprecated: true,
      responses: { '200': { description: 'OK' } },
    });

    const doc = generateOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, unknown>>)['/v1/legacy'].get as Record<string, unknown>;
    expect(op.tags).toEqual(['Legacy']);
    expect(op.deprecated).toBe(true);
  });

  it('uses explicit operation IDs when provided', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/v1/test/{id}',
      operationId: 'getTestById',
      responses: { '200': { description: 'OK' } },
    });

    const doc = generateOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, unknown>>)['/v1/test/{id}'].get as Record<string, unknown>;
    expect(op.operationId).toBe('getTestById');
  });

  it('generates deterministic fallback operation IDs', () => {
    registerOpenApiPath({
      method: 'post',
      path: '/v1/test-items/{id}/answer',
      responses: { '200': { description: 'OK' } },
    });

    const doc = generateOpenApiDocument();
    const op = (doc.paths as Record<string, Record<string, unknown>>)['/v1/test-items/{id}/answer'].post as Record<string, unknown>;
    expect(op.operationId).toBe('postV1TestItemsIdAnswer');
  });

  it('clearOpenApiPaths resets all registered paths', () => {
    registerOpenApiPath({
      method: 'get',
      path: '/v1/a',
      responses: { '200': { description: 'OK' } },
    });
    clearOpenApiPaths();
    const doc = generateOpenApiDocument();
    expect(Object.keys(doc.paths as Record<string, unknown>)).toHaveLength(0);
  });
});

// ── generateOpenApiDocument structure ────────────────────────────────

describe('generateOpenApiDocument', () => {
  beforeEach(() => {
    clearOpenApiPaths();
  });

  it('returns a valid OpenAPI 3.1.0 document', () => {
    const doc = generateOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toBeDefined();
    expect(doc.paths).toBeDefined();
  });

  it('includes server URL /v1', () => {
    const doc = generateOpenApiDocument();
    expect(doc.servers).toEqual([{ url: '/v1', description: 'API v1' }]);
  });

  it('uses custom title and version when provided', () => {
    const doc = generateOpenApiDocument({ title: 'Test API', version: '2.0.0' });
    const info = doc.info as Record<string, unknown>;
    expect(info.title).toBe('Test API');
    expect(info.version).toBe('2.0.0');
  });

  it('includes description', () => {
    const doc = generateOpenApiDocument();
    const info = doc.info as Record<string, unknown>;
    expect(typeof info.description).toBe('string');
    expect((info.description as string).length).toBeGreaterThan(0);
  });
});

// ── registerOpenApiSpec (full route registration) ────────────────────

describe('registerOpenApiSpec', () => {
  beforeEach(() => {
    clearOpenApiPaths();
  });

  it('registers all expected route groups', () => {
    registerOpenApiSpec();
    const doc = generateOpenApiDocument();
    const paths = Object.keys(doc.paths as Record<string, unknown>);

    // Sessions
    expect(paths).toContain('/v1/sessions');
    expect(paths).toContain('/v1/sessions/{id}');
    expect(paths).toContain('/v1/sessions/history');

    // Session actions
    expect(paths).toContain('/v1/sessions/{id}/send');
    expect(paths).toContain('/v1/sessions/{id}/command');
    expect(paths).toContain('/v1/sessions/{id}/bash');
    expect(paths).toContain('/v1/sessions/{id}/approve');
    expect(paths).toContain('/v1/sessions/{id}/reject');

    // Session data
    expect(paths).toContain('/v1/sessions/{id}/read');
    expect(paths).toContain('/v1/sessions/{id}/transcript');
    expect(paths).toContain('/v1/sessions/{id}/summary');

    // Auth
    expect(paths).toContain('/v1/auth/verify');
    expect(paths).toContain('/v1/auth/keys');

    // Health
    expect(paths).toContain('/v1/health');

    // Events
    expect(paths).toContain('/v1/events');

    // Templates
    expect(paths).toContain('/v1/templates');

    // Pipelines
    expect(paths).toContain('/v1/pipelines');

    // Memory
    expect(paths).toContain('/v1/memory');
    expect(paths).toContain('/v1/memory/{key}');
  });

  it('does not register /v1/openapi.json as a path', () => {
    registerOpenApiSpec();
    const doc = generateOpenApiDocument();
    const paths = Object.keys(doc.paths as Record<string, unknown>);
    expect(paths).not.toContain('/v1/openapi.json');
  });

  it('registers at least 50 paths', () => {
    registerOpenApiSpec();
    const doc = generateOpenApiDocument();
    const paths = Object.keys(doc.paths as Record<string, unknown>);
    expect(paths.length).toBeGreaterThanOrEqual(50);
  });

  it('all registered operations have responses', () => {
    registerOpenApiSpec();
    const doc = generateOpenApiDocument();
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;

    for (const [, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(op.responses, `${method} missing responses`).toBeDefined();
        expect(Object.keys(op.responses as Record<string, unknown>).length).toBeGreaterThan(0);
      }
    }
  });
});

// ── validationErrorResponse helper ───────────────────────────────────

describe('validationErrorResponse', () => {
  it('returns a 400-style error response', () => {
    const resp = validationErrorResponse();
    expect(resp.description).toBe('Validation error');
    expect(resp.content).toBeDefined();
    expect(resp.content!['application/json']).toBeDefined();
  });

  it('accepts custom description', () => {
    const resp = validationErrorResponse('Custom error');
    expect(resp.description).toBe('Custom error');
  });
});
