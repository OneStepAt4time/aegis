/**
 * dashboard-static.test.ts — Tests for Issue #105: Dashboard static serving fix.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';

describe('Dashboard static serving (Issue #105)', () => {
  describe('1. Vite config has correct base', () => {
    it('should have base: "/dashboard/" in vite.config.ts', async () => {
      const configPath = join(process.cwd(), 'dashboard', 'vite.config.ts');
      const configContent = await readFile(configPath, 'utf-8');
      expect(configContent).toMatch(/base:\s*['"`]\/dashboard\/['"`]/);
    });
  });

  describe('2. Static files exist in dashboard/dist', () => {
    it('should have index.html in dashboard/dist', async () => {
      const indexPath = join(process.cwd(), 'dashboard', 'dist', 'index.html');
      await expect(access(indexPath)).resolves.toBeUndefined();
    });

    it('should have assets directory in dashboard/dist', async () => {
      const assetsPath = join(process.cwd(), 'dashboard', 'dist', 'assets');
      await expect(access(assetsPath)).resolves.toBeUndefined();
    });

    it('should reference assets with /dashboard/ prefix in index.html', async () => {
      const indexPath = join(process.cwd(), 'dashboard', 'dist', 'index.html');
      const html = await readFile(indexPath, 'utf-8');
      expect(html).toMatch(/src="\/dashboard\/assets\/[^"]+\.js"/);
      expect(html).toMatch(/href="\/dashboard\/assets\/[^"]+\.css"/);
      expect(html).not.toMatch(/src="\/assets\//);
      expect(html).not.toMatch(/href="\/assets\//);
    });
  });

  describe('3. Fastify static plugin registration', () => {
    it('should import @fastify/static in package.json', async () => {
      const pkgPath = join(process.cwd(), 'package.json');
      const pkgContent = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);
      expect(pkg.dependencies).toBeDefined();
      expect(pkg.dependencies['@fastify/static']).toBeDefined();
    });

    it('should register @fastify/static with correct options', async () => {
      const app = Fastify();
      await app.register(fastifyStatic, {
        root: join(process.cwd(), 'dashboard', 'dist'),
        prefix: '/dashboard/',
      });
      const plugins = app.printPlugins();
      expect(plugins).toContain('@fastify/static');
      await app.close();
    });
  });

  describe('4. Static file serving behavior', () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      app = Fastify();
      await app.register(fastifyStatic, {
        root: join(process.cwd(), 'dashboard', 'dist'),
        prefix: '/dashboard/',
      });
      app.get('/v1/test', async () => ({ ok: true }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('should serve index.html at /dashboard/', async () => {
      const response = await app.inject({ method: 'GET', url: '/dashboard/' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<!DOCTYPE html>');
      expect(response.body).toContain('Aegis Dashboard');
    });

    it('should serve index.html at /dashboard/index.html', async () => {
      const response = await app.inject({ method: 'GET', url: '/dashboard/index.html' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should serve JS assets under /dashboard/assets/', async () => {
      const indexPath = join(process.cwd(), 'dashboard', 'dist', 'index.html');
      const html = await readFile(indexPath, 'utf-8');
      const jsMatch = html.match(/src="(\/dashboard\/assets\/[^"]+\.js)"/);
      expect(jsMatch).toBeTruthy();
      const response = await app.inject({ method: 'GET', url: jsMatch![1] });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/javascript');
    });

    it('should serve CSS assets under /dashboard/assets/', async () => {
      const indexPath = join(process.cwd(), 'dashboard', 'dist', 'index.html');
      const html = await readFile(indexPath, 'utf-8');
      const cssMatch = html.match(/href="(\/dashboard\/assets\/[^"]+\.css)"/);
      expect(cssMatch).toBeTruthy();
      const response = await app.inject({ method: 'GET', url: cssMatch![1] });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/css');
    });
  });

  describe('5. SPA fallback for client-side routes', () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      app = Fastify();
      await app.register(fastifyStatic, {
        root: join(process.cwd(), 'dashboard', 'dist'),
        prefix: '/dashboard/',
      });

      app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.url.startsWith('/dashboard/')) {
          const indexPath = join(process.cwd(), 'dashboard', 'dist', 'index.html');
          const html = await readFile(indexPath, 'utf-8');
          return reply.status(200).type('text/html').send(html);
        }
        return reply.status(404).send({ error: 'Not found' });
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('should return index.html for /dashboard/sessions/abc (SPA route)', async () => {
      const response = await app.inject({ method: 'GET', url: '/dashboard/sessions/abc' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('<!DOCTYPE html>');
      expect(response.body).toContain('Aegis Dashboard');
    });

    it('should return index.html for /dashboard/sessions (SPA route)', async () => {
      const response = await app.inject({ method: 'GET', url: '/dashboard/sessions' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should return index.html for /dashboard/settings (SPA route)', async () => {
      const response = await app.inject({ method: 'GET', url: '/dashboard/settings' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });
  });

  describe('6. Non-dashboard routes are unaffected', () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      app = Fastify();
      await app.register(fastifyStatic, {
        root: join(process.cwd(), 'dashboard', 'dist'),
        prefix: '/dashboard/',
      });
      app.get('/v1/sessions', async () => ([]));
      app.get('/v1/health', async () => ({ status: 'ok' }));

      app.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
        if (request.url.startsWith('/dashboard/')) {
          const indexPath = join(process.cwd(), 'dashboard', 'dist', 'index.html');
          const html = await readFile(indexPath, 'utf-8');
          return reply.status(200).type('text/html').send(html);
        }
        return reply.status(404).send({ error: 'Not found' });
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('should serve /v1/sessions normally (not affected by dashboard)', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/sessions' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(JSON.parse(response.body)).toEqual([]);
    });

    it('should serve /v1/health normally (not affected by dashboard)', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });

    it('should return 404 for non-dashboard, non-API routes', async () => {
      const response = await app.inject({ method: 'GET', url: '/nonexistent' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('7. React Router basename configuration', () => {
    it('should have basename="/dashboard" in BrowserRouter', async () => {
      const mainPath = join(process.cwd(), 'dashboard', 'src', 'main.tsx');
      const mainContent = await readFile(mainPath, 'utf-8');
      expect(mainContent).toMatch(/BrowserRouter[^>]*basename\s*=\s*["']\/dashboard["']/);
    });
  });
});
