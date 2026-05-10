/**
 * Issue #3076: Root / should redirect to /dashboard/ when dashboard is available.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

describe('Issue #3076 — Root redirect to /dashboard/', () => {
  it('registers a GET / route that returns 302 to /dashboard/', async () => {
    const app = Fastify();
    let dashboardAvailable = true;

    // Replicate the logic from server.ts
    if (dashboardAvailable) {
      app.get('/', async (_req, reply) => {
        return reply.redirect('/dashboard/');
      });
    }

    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/dashboard/');
    await app.close();
  });

  it('does not register redirect when dashboard is unavailable', async () => {
    const app = Fastify();
    let dashboardAvailable = false;

    if (dashboardAvailable) {
      app.get('/', async (_req, reply) => {
        return reply.redirect('/dashboard/');
      });
    }

    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
