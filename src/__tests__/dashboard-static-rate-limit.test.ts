/**
 * dashboard-static-rate-limit.test.ts — Tests for Issue #3220 and CodeQL #140.
 *
 * Verifies that @fastify/rate-limit protects dashboard static asset routes
 * and returns 429 with proper headers when the per-IP limit is exceeded.
 *
 * Integration tests use a mock dashboard directory with a dummy index.html
 * to ensure the full plugin lifecycle works end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { registerDashboardStatic } from '../plugins/dashboard-static.js';

// ── Return value tests ───────────────────────────────────────────────────

describe('registerDashboardStatic return value', () => {
  let mockDashboardDir: string;

  beforeEach(() => {
    mockDashboardDir = path.join(os.tmpdir(), `aegis-test-dashboard-${Date.now()}`);
    fs.mkdirSync(mockDashboardDir, { recursive: true });
    fs.writeFileSync(path.join(mockDashboardDir, 'index.html'), '<html>test</html>');
  });

  afterEach(() => {
    fs.rmSync(mockDashboardDir, { recursive: true, force: true });
  });

  it('returns true when dashboard is available', async () => {
    const app = Fastify();
    try {
      const result = await registerDashboardStatic(app, { _dashboardRoot: mockDashboardDir });
      expect(result).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns false when dashboard is disabled', async () => {
    const app = Fastify();
    try {
      const result = await registerDashboardStatic(app, { enabled: false });
      expect(result).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('returns false when dashboard directory is missing', async () => {
    const app = Fastify();
    try {
      const result = await registerDashboardStatic(app, { _dashboardRoot: '/nonexistent/path' });
      expect(result).toBe(false);
    } finally {
      await app.close();
    }
  });
});

// ── Rate limiting integration tests ──────────────────────────────────────

describe('Dashboard static rate limiting via @fastify/rate-limit (#3220, #140)', () => {
  let app: ReturnType<typeof Fastify>;
  let mockDashboardDir: string;

  beforeEach(async () => {
    mockDashboardDir = path.join(os.tmpdir(), `aegis-test-dashboard-${Date.now()}`);
    fs.mkdirSync(mockDashboardDir, { recursive: true });
    fs.writeFileSync(path.join(mockDashboardDir, 'index.html'), '<html>test</html>');
    fs.mkdirSync(path.join(mockDashboardDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(mockDashboardDir, 'assets', 'app-abc123.js'), '// test');

    app = Fastify();
    await registerDashboardStatic(app, { _dashboardRoot: mockDashboardDir });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(mockDashboardDir, { recursive: true, force: true });
  });

  it('should return 429 when rate limit is exceeded on dashboard routes', async () => {
    // Exhaust rate limit (600 requests per minute)
    for (let i = 0; i < 600; i++) {
      const res = await app.inject({ method: 'GET', url: '/dashboard/' });
      expect(res.statusCode).toBe(200);
    }

    // 1001st should be rate limited
    const res = await app.inject({ method: 'GET', url: '/dashboard/' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: 'Too Many Requests' });
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBe('600');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should track different IPs independently', async () => {
    // Exhaust for IP 1
    for (let i = 0; i < 600; i++) {
      await app.inject({
        method: 'GET',
        url: '/dashboard/',
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });
    }

    // IP 1 should be limited
    const limited = await app.inject({
      method: 'GET',
      url: '/dashboard/',
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(limited.statusCode).toBe(429);

    // IP 2 should still work
    const ok = await app.inject({
      method: 'GET',
      url: '/dashboard/',
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('should apply rate limiting to root redirect', async () => {
    // Exhaust rate limit
    for (let i = 0; i < 600; i++) {
      await app.inject({ method: 'GET', url: '/' });
    }

    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(429);
  });

  it('should apply rate limiting to manifest.json', async () => {
    fs.writeFileSync(path.join(mockDashboardDir, 'manifest.json'), '{"name":"test"}');

    // Exhaust rate limit
    for (let i = 0; i < 600; i++) {
      await app.inject({ method: 'GET', url: '/manifest.json' });
    }

    const res = await app.inject({ method: 'GET', url: '/manifest.json' });
    expect(res.statusCode).toBe(429);
  });
});
