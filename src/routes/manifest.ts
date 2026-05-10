/**
 * routes/manifest.ts — Public manifest.json endpoint for PWA support.
 *
 * This route serves the PWA manifest.json at the root path (/manifest.json)
 * to enable browsers to find the manifest when installing the PWA.
 * The endpoint is publicly accessible and bypasses authentication.
 *
 * Issue #3092: manifest.json behind auth breaks PWA
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function registerManifestRoutes(app: FastifyInstance, dashboardRoot: string): void {
  app.get('/manifest.json', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const manifestPath = path.join(dashboardRoot, 'manifest.json');

      // Check if manifest exists
      try {
        await fs.access(manifestPath);
      } catch {
        return reply.status(404).send({ error: 'Manifest not found' });
      }

      // Read and serve manifest
      const manifest = await fs.readFile(manifestPath, 'utf-8');

      // Set appropriate headers for PWA manifest
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Cache-Control', 'public, max-age=0, must-revalidate');

      return reply.send(manifest);
    } catch (error) {
      console.error('Error serving manifest.json:', error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
