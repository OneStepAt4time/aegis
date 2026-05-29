/**
 * routes/openapi/index.ts — OpenAPI 3.1 spec registration and serving.
 *
 * Registers all v1 REST endpoint descriptors centrally and serves the
 * generated OpenAPI 3.1 document at GET /v1/openapi.json.
 *
 * Route modules stay the source of truth for runtime behavior.
 * This module is the source of truth for the machine-readable API contract.
 *
 * Issue #1909.
 */

import type { FastifyInstance } from 'fastify';
import { generateOpenApiDocument } from '../../openapi.js';
import { registerSessionPaths } from './sessions.js';
import { registerSessionActionPaths } from './session-actions.js';
import { registerSessionPermissionPaths } from './session-permissions.js';
import { registerAuthPaths } from './auth.js';
import { registerInfraPaths } from './infra.js';
import { registerResourcePaths } from './resources.js';

/** Register all OpenAPI path descriptors. Called once at startup. */
export function registerOpenApiSpec(): void {
  registerSessionPaths();
  registerSessionActionPaths();
  registerSessionPermissionPaths();
  registerAuthPaths();
  registerInfraPaths();
  registerResourcePaths();
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
