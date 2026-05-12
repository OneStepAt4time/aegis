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
import { fileURLToPath } from 'node:url';

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

// ── Rate limiting (#3220) ──────────────────────────────────────────────────

/** Max requests per IP per window for dashboard static assets. */
const STATIC_RATE_LIMIT = 100;
/** Rate limit window in milliseconds. */
const STATIC_RATE_WINDOW_MS = 60_000;
/** Max tracked IPs before eviction. */
const STATIC_RATE_MAX_ENTRIES = 2_000;

interface StaticRateBucket {
  windowStart: number;
  count: number;
}

/** Lightweight per-IP fixed-window rate limiter for static asset routes (#3220). */
export class StaticRateLimiter {
  private buckets = new Map<string, StaticRateBucket>();

  /** Check if an IP has exceeded the rate limit. Returns true if LIMITED. */
  isRateLimited(ip: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(ip);

    if (!bucket || now - bucket.windowStart >= STATIC_RATE_WINDOW_MS) {
      bucket = { windowStart: now, count: 0 };
      this.buckets.set(ip, bucket);
    }

    bucket.count++;

    // Evict oldest entry when map grows too large
    if (this.buckets.size > STATIC_RATE_MAX_ENTRIES) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, b] of this.buckets) {
        if (b.windowStart < oldestTime) {
          oldestTime = b.windowStart;
          oldestKey = key;
        }
      }
      if (oldestKey) this.buckets.delete(oldestKey);
    }

    return bucket.count > STATIC_RATE_LIMIT;
  }

  /** Get current bucket info for response headers. */
  getBucketInfo(ip: string): { limit: number; remaining: number; reset: number } {
    const bucket = this.buckets.get(ip);
    if (!bucket) {
      return {
        limit: STATIC_RATE_LIMIT,
        remaining: STATIC_RATE_LIMIT,
        reset: Math.ceil((Date.now() + STATIC_RATE_WINDOW_MS) / 1000),
      };
    }
    const remaining = Math.max(0, STATIC_RATE_LIMIT - bucket.count);
    return {
      limit: STATIC_RATE_LIMIT,
      remaining,
      reset: Math.ceil((bucket.windowStart + STATIC_RATE_WINDOW_MS) / 1000),
    };
  }

  /** Prune expired buckets. */
  prune(): void {
    const cutoff = Date.now() - STATIC_RATE_WINDOW_MS;
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart < cutoff) this.buckets.delete(key);
    }
  }

  /** Current bucket count (for testing). */
  get size(): number {
    return this.buckets.size;
  }
}


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
  /** External rate limiter instance (optional). If not provided, an internal one is created. */
  rateLimiter?: StaticRateLimiter;
  /** @internal Test-only: override the resolved dashboard root directory. */
  _dashboardRoot?: string;
}

/**
 * Register dashboard static file serving, SPA fallback, root redirect,
 * and manifest.json endpoint.
 *
 * Gracefully handles missing dashboard build (warns, serves nothing).
 * Returns the prune interval handle (caller must clearInterval on shutdown),
 * or null if the dashboard is unavailable or disabled.
 */
export async function registerDashboardStatic(
  app: FastifyInstance,
  options: DashboardStaticOptions = {}
): Promise<ReturnType<typeof setInterval> | null> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const dashboardRoot = options._dashboardRoot ?? path.join(__dirname, '..', 'dashboard');
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

  if (!dashboardAvailable) return null;

  // #3220: Rate limiting for dashboard static asset routes
  const limiter = options.rateLimiter ?? new StaticRateLimiter();

  // #3227: Periodic prune to evict stale IP buckets (mirrors server.ts pattern)
  const pruneInterval = setInterval(() => limiter.prune(), 60_000);
  pruneInterval.unref();

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url ?? '/';
    const isStaticRoute =
      url === '/' ||
      url.startsWith('/dashboard') ||
      url === '/manifest.json';

    if (!isStaticRoute) return;

    const ip = req.ip ?? '127.0.0.1';
    if (limiter.isRateLimited(ip)) {
      const info = limiter.getBucketInfo(ip);
      reply.header('Retry-After', String(Math.max(1, info.reset - Math.ceil(Date.now() / 1000))));
      reply.header('X-RateLimit-Limit', String(info.limit));
      reply.header('X-RateLimit-Remaining', '0');
      reply.header('X-RateLimit-Reset', String(info.reset));
      return reply.status(429).send({ error: 'Too many requests', retryAfter: info.reset });
    }
  });

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

  return pruneInterval;
}
