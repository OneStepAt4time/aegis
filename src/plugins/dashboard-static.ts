/**
 * Dashboard static file serving plugin.
 *
 * Extracted from server.ts (#3154 — server decomposition).
 * Handles:
 * - Static file serving via @fastify/static
 * - Cache-Control headers (hashed assets cached, HTML no-cache)
 * - SPA fallback for dashboard routes
 * - Root redirect to /dashboard/
 * - manifest.json serving for PWA install
 *
 * @packageDocumentation
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';

import { logger } from '../logger.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https://registry.npmjs.org",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "worker-src blob 'self'",
].join('; ');

const DASHBOARD_RESPONSE_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': DASHBOARD_CSP,
} as const;

// ── Helper functions ───────────────────────────────────────────────────────

export function applyDashboardResponseHeaders(reply: FastifyReply): void {
  for (const [header, value] of Object.entries(DASHBOARD_RESPONSE_HEADERS)) {
    reply.header(header, value);
  }
}

function normalizeDashboardStaticPath(dashboardRoot: string, pathname: string): string {
  const urlLike = pathname.replace(/\\/g, '/');
  if (urlLike === '/' || urlLike === '/index.html' || urlLike.startsWith('/dashboard/') || urlLike.startsWith('/assets/')) {
    return urlLike.replace(/^\/(?:dashboard\/)?/, '');
  }
  const normalized = path.normalize(pathname);
  const relative = path.isAbsolute(normalized)
    ? path.relative(dashboardRoot, normalized)
    : normalized.replace(/^[\\/]+/, '');
  return relative.split(path.sep).join('/');
}

function dashboardCacheControl(dashboardRoot: string, pathname: string): string {
  const relative = normalizeDashboardStaticPath(dashboardRoot, pathname);
  const basename = path.posix.basename(relative);
  if (relative === '' || relative === 'index.html' || basename.endsWith('.html')) {
    return 'no-cache, no-store, must-revalidate';
  }
  if (relative.startsWith('assets/') && /-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/.test(basename)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=0, must-revalidate';
}

// ── Plugin ─────────────────────────────────────────────────────────────────

export interface DashboardStaticOptions {
  /** Whether the dashboard is enabled (default: true). */
  enabled?: boolean;
}

/**
 * Register dashboard static file serving, SPA fallback, root redirect,
 * and manifest.json endpoint.
 *
 * Gracefully handles missing dashboard build (warns, serves nothing).
 * Returns true if dashboard is available, false otherwise.
 */
export async function registerDashboardStatic(
  app: FastifyInstance,
  options: DashboardStaticOptions = {}
): Promise<boolean> {
  const dashboardRoot = path.join(__dirname, '..', 'dashboard');
  const dashboardEnabled = options.enabled !== false;
  let dashboardAvailable = false;

  if (dashboardEnabled) {
    try {
      await fs.access(path.join(dashboardRoot, 'index.html'));
      dashboardAvailable = true;
    } catch {
      logger.warn({
        component: 'server',
        operation: 'dashboard_static_unavailable',
        errorCode: 'DASHBOARD_DIR_MISSING',
        attributes: {
          dashboardRoot,
          hint: 'Run "npm run build" to populate dist/dashboard/',
        },
      });
    }
  }

  if (!dashboardAvailable) return false;

  // Register static file serving
  await app.register(fastifyStatic, {
    root: dashboardRoot,
    prefix: "/dashboard/",
    // #2345: Prevent send() from overwriting our Cache-Control with its own default.
    cacheControl: false,
    // #146: Cache hashed assets aggressively, no-cache for index.html
    setHeaders: (reply, pathname) => {
      for (const [header, value] of Object.entries(DASHBOARD_RESPONSE_HEADERS)) {
        reply.setHeader(header, value);
      }
      reply.setHeader('Cache-Control', dashboardCacheControl(dashboardRoot, pathname));

      // Defensive: ensure Content-Length is present and correct for static assets
      try {
        if (!reply.getHeader('Content-Length')) {
          const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
          const full = path.join(dashboardRoot, rel);
          const st = statSync(full);
          reply.setHeader('Content-Length', String(st.size));
        }
      } catch {
        // ignore: let the static plugin handle headers if stat fails
      }
    },
  });

  // Issue #3076: Redirect root / to /dashboard/
  app.get('/', async (_req, reply) => {
    return reply.redirect('/dashboard/');
  });

  // Issue #3092: Serve manifest.json at root for PWA install (no auth required).
  app.get('/manifest.json', async (_req, reply) => {
    const manifestPath = path.join(dashboardRoot, 'manifest.json');
    try {
      const data = await fs.readFile(manifestPath, 'utf-8');
      reply.header('Content-Type', 'application/manifest+json');
      reply.header('Cache-Control', 'public, max-age=3600');
      return reply.send(data);
    } catch {
      return reply.status(404).send({ error: 'manifest.json not found' });
    }
  });

  // SPA fallback for dashboard routes (Issue #105)
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url === "/dashboard" || req.url?.startsWith("/dashboard/") || req.url?.startsWith("/dashboard?")) {
      applyDashboardResponseHeaders(reply);
      return reply.sendFile("index.html", dashboardRoot);
    }
    return reply.status(404).send({ error: "Not found" });
  });

  return true;
}
