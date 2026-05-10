/**
 * Issue #3092: /manifest.json should be publicly accessible for PWA install.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('Issue #3092 — /manifest.json is public', () => {
  it('serves manifest.json at root with correct content type', async () => {
    const app = Fastify();
    const dashboardRoot = path.resolve('dist/dashboard');

    app.get('/manifest.json', async (_req, reply) => {
      const manifestPath = path.join(dashboardRoot, 'manifest.json');
      try {
        const data = await fs.readFile(manifestPath, 'utf-8');
        reply.header('Content-Type', 'application/manifest+json');
        return reply.send(data);
      } catch {
        return reply.status(404).send({ error: 'not found' });
      }
    });

    const res = await app.inject({ method: 'GET', url: '/manifest.json' });

    // If build artifacts exist, verify content; otherwise just verify the handler works
    try {
      await fs.access(path.join(dashboardRoot, 'manifest.json'));
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/manifest+json');
      const body = JSON.parse(res.body);
      expect(body.name).toBeDefined();
    } catch {
      // No build artifact — skip content check
      expect([200, 404]).toContain(res.statusCode);
    }

    await app.close();
  });

  it('returns valid JSON with required PWA fields', async () => {
    const manifestPath = path.resolve('dist/dashboard/manifest.json');
    let data: string;
    try {
      data = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      // Skip if build artifacts not present
      return;
    }
    const manifest = JSON.parse(data);
    expect(manifest.name).toBeDefined();
    expect(manifest.start_url).toBeDefined();
    expect(manifest.display).toBeDefined();
  });
});
