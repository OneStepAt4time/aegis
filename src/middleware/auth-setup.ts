/**
 * middleware/auth-setup.ts — Extracted from server.ts (#4243).
 *
 * Authentication middleware, rate limiting helpers, and request auth hooks.
 * Wired into Fastify via setupAuth() during server startup.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeStringEqual } from '../crypto-utils.js';
import { isValidUUID } from '../validation.js';
import { RateLimiter } from '../services/auth/RateLimiter.js';
import { classifyBearerTokenForRoute } from '../services/auth/index.js';
import { authenticateDashboardSessionCookie } from '../dashboard-session-auth.js';
import type { AppContext } from '../app-context.js';

const rateLimiter = new RateLimiter();

// ── Rate limiting helpers ──

function addRateLimitHeaders(
  reply: FastifyReply,
  info: import("../services/auth/RateLimiter.js").RateLimitBucketInfo,
): void {
  reply.header("X-RateLimit-Limit", info.limit);
  reply.header("X-RateLimit-Remaining", info.remaining);
  reply.header("X-RateLimit-Reset", info.reset);
  reply.header("Retry-After", Math.max(1, info.reset - Math.ceil(Date.now() / 1000)));
}

function checkIpRateLimit(ip: string, isMaster: boolean, keyId?: string): boolean {
  return rateLimiter.checkIpRateLimit(ip, isMaster, keyId);
}

function checkIpRateLimitUnauth(ip: string): boolean {
  return rateLimiter.checkIpRateLimitUnauth(ip);
}

function checkAuthFailRateLimit(ip: string): boolean {
  return rateLimiter.checkAuthFailRateLimit(ip);
}

function recordAuthFailure(ip: string): void {
  rateLimiter.recordAuthFailure(ip);
}

const recordedAuthFailures = new Set<string>();

function recordAuthFailureOnce(req: FastifyRequest, ip: string): void {
  if (recordedAuthFailures.has(req.id)) return;
  recordedAuthFailures.add(req.id);
  recordAuthFailure(ip);
}

export function pruneAuthFailLimits(): void {
  rateLimiter.pruneAuthFailLimits();
}

export function pruneIpRateLimits(): void {
  rateLimiter.pruneIpRateLimits();
}

export function getRateLimiter(): RateLimiter {
  return rateLimiter;
}

/** #583: Track keyId per request for batch rate limiting. */
export const requestKeyMap = new Map<string, string>();

/**
 * Wire authentication preHandler hooks into the Fastify app.
 */
export function setupAuth(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('onResponse', (req, _reply, done) => {
    requestKeyMap.delete(req.id);
    recordedAuthFailures.delete(req.id);
    done();
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS') return;
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath === '/health' || urlPath === '/v1/health') return;
    if (urlPath === '/v1/version') return;
    if (urlPath === '/v1/auth/verify') return;
    if (urlPath === '/v1/auth/device/authorize' || urlPath === '/v1/auth/device/token') return;
    if (urlPath === '/auth/login' || urlPath === '/auth/callback' || urlPath === '/auth/session' || urlPath === '/auth/logout') return;
    if (urlPath === '/' || urlPath === '/dashboard' || urlPath.startsWith('/dashboard/')) return;
    if (urlPath === '/manifest.json') return;
    const hookMatch = /^\/v1\/hooks\/[A-Za-z]+$/.exec(urlPath);
    if (hookMatch) {
      const hookSessionId = (req.headers['x-session-id'] as string)
        || (req.query as Record<string, string>)?.sessionId;
      if (hookSessionId && !isValidUUID(hookSessionId)) {
        return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
      }
      if (hookSessionId) {
        const session = ctx.sessions.getSession(hookSessionId);
        if (session) {
          const queryHookSecret = (req.query as Record<string, string>)?.secret;
          if (ctx.config.hookSecretHeaderOnly && queryHookSecret !== undefined) {
            return reply.status(401).send({ error: 'Unauthorized — hook secret must be sent via X-Hook-Secret header' });
          }
          const hookSecret = (req.headers['x-hook-secret'] as string) || queryHookSecret;
          if (!hookSecret || !timingSafeStringEqual(hookSecret, session.hookSecret)) {
            return reply.status(401).send({ error: 'Unauthorized — invalid hook secret' });
          }
          return;
        }
      }
      return reply.status(401).send({ error: 'Unauthorized — hook endpoint requires valid session ID' });
    }
    if (/^\/v1\/sessions\/[^/]+\/terminal$/.test(urlPath)) return;

    if (urlPath === '/metrics') {
      const metricsToken = ctx.config.metricsToken;
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined;
      if (metricsToken) {
        if (bearer && (timingSafeStringEqual(bearer, metricsToken) || ctx.auth.validate(bearer).valid)) {
          return;
        }
        return reply.status(401).send({ error: 'Unauthorized — valid Bearer token or metrics token required' });
      }
    }

    const isSSERoute = /^\/v1\/(events|sse)$|^\/v1\/sessions\/[^/]+\/(events|stream)$/.test(urlPath);
    let token: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7);
    } else if (isSSERoute) {
      token = (req.query as Record<string, string>).token;
    }

    const clientIp = req.ip ?? 'unknown';

    if (!token && urlPath.startsWith('/v1/')) {
      const dashboardAuthContext = authenticateDashboardSessionCookie(req, {
        getSession: (sessionId: string | undefined) =>
          ctx.dashboardTokenSessions.get(sessionId) ?? ctx.dashboardOidc?.getSession(sessionId) ?? null,
      });
      if (dashboardAuthContext) {
        requestKeyMap.set(req.id, dashboardAuthContext.keyId);
        if (ctx.auditLogger) {
          void ctx.auditLogger.log(
            dashboardAuthContext.actor,
            'api.authenticated',
            `${req.method} ${req.url?.split('?')[0] ?? req.url}`,
            undefined,
            dashboardAuthContext.tenantId,
          );
        }
        if (checkIpRateLimit(clientIp, false, dashboardAuthContext.keyId)) {
          addRateLimitHeaders(reply, rateLimiter.getIpBucketInfo(clientIp, false, dashboardAuthContext.keyId));
          return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
        }
        return;
      }
    }

    const isNoAuthLocalhost = !ctx.auth.authEnabled && ctx.auth.isLocalhostBinding;
    if (isNoAuthLocalhost) {
      if (checkIpRateLimit(clientIp, false)) {
        addRateLimitHeaders(reply, rateLimiter.getIpBucketInfo(clientIp, false));
        return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
      }
      return;
    }

    if (!token) {
      if (checkIpRateLimit(clientIp, false)) {
        addRateLimitHeaders(reply, rateLimiter.getIpBucketInfo(clientIp, false));
        return reply.status(429).send({ error: 'Rate limit exceeded — too many unauthenticated requests' });
      }
      return reply.status(401).send({ error: 'Unauthorized — Bearer token required' });
    }

    const tokenMode = classifyBearerTokenForRoute(token, !!isSSERoute);

    if (tokenMode === 'sse') {
      if (await ctx.auth.validateSSEToken(token)) {
        return;
      }
      if (checkAuthFailRateLimit(clientIp)) {
        addRateLimitHeaders(reply, rateLimiter.getAuthFailBucketInfo(clientIp));
        return reply.status(429).send({ error: 'Too many auth failures — try again later' });
      }
      recordAuthFailureOnce(req, clientIp);
      return reply.status(401).send({ error: 'Unauthorized — SSE token invalid or expired' });
    }

    if (tokenMode === 'reject') {
      if (checkAuthFailRateLimit(clientIp)) {
        addRateLimitHeaders(reply, rateLimiter.getAuthFailBucketInfo(clientIp));
        return reply.status(429).send({ error: 'Too many auth failures — try again later' });
      }
      recordAuthFailureOnce(req, clientIp);
      return reply.status(401).send({ error: 'Unauthorized — SSE token required for event streams' });
    }

    const result = ctx.auth.validate(token);

    if (!result.valid) {
      if (checkAuthFailRateLimit(clientIp)) {
        addRateLimitHeaders(reply, rateLimiter.getAuthFailBucketInfo(clientIp));
        return reply.status(429).send({ error: 'Too many auth failures — try again later' });
      }
      recordAuthFailureOnce(req, clientIp);
      if (result.reason === 'expired') {
        return reply.status(401).send({ error: 'Unauthorized — API key has expired', code: 'KEY_EXPIRED' });
      }
      return reply.status(401).send({ error: 'Unauthorized — invalid API key' });
    }

    if (result.rateLimited) {
      addRateLimitHeaders(reply, rateLimiter.getIpBucketInfo(clientIp, result.keyId === 'master', result.keyId ?? undefined));
      return reply.status(429).send({ error: 'Rate limit exceeded — 100 req/min per key' });
    }

    requestKeyMap.set(req.id, result.keyId ?? 'anonymous');
    req.authKeyId = result.keyId;
    req.authRole = ctx.auth.getRole(result.keyId);
    req.authPermissions = ctx.auth.getPermissions(result.keyId);
    req.authActor = ctx.auth.getAuditActor(result.keyId, result.keyId ?? 'anonymous');
    req.tenantId = result.tenantId;

    rateLimiter.resetAuthFailures(clientIp);

    if (ctx.auditLogger) {
      void ctx.auditLogger.log(result.keyId ?? 'anonymous', 'api.authenticated', `${req.method} ${req.url?.split('?')[0] ?? req.url}`, undefined, result.tenantId);
    }

    const isMaster = result.keyId === 'master';
    if (checkIpRateLimit(clientIp, isMaster, result.keyId ?? undefined)) {
      addRateLimitHeaders(reply, rateLimiter.getIpBucketInfo(clientIp, isMaster, result.keyId ?? undefined));
      return reply.status(429).send({ error: 'Rate limit exceeded — IP throttled' });
    }
  });

  const AUTH_KEY_ID_PREFIXES = ['/v1/auth/keys/', '/v1/keys/'];
  app.addHook('onRequest', async (req, reply) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    const isAuthKeyRoute = AUTH_KEY_ID_PREFIXES.some(p => urlPath.startsWith(p));
    const id = (req.params as Record<string, string | undefined>).id;
    if (!isAuthKeyRoute && id !== undefined && !isValidUUID(id)) {
      return reply.status(400).send({ error: 'Invalid session ID — must be a UUID' });
    }
  });
}
