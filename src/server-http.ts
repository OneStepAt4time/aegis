/**
 * server-http.ts — Aegis HTTP server setup extracted from server.ts (Issue #4227).
 *
 * Contains the Fastify app construction, rate limiting, content-type parser,
 * request decoration, structured log sink, and security headers (X-Content-Type-Options,
 * X-Frame-Options, X-Aegis-API-Version, X-Request-Id, Referrer-Policy, Permissions-Policy).
 *
 * The app instance is exported and consumed by server-bootstrap.ts (which registers
 * routes via main()).
 *
 * Extraction acceptance criteria (per Ema's spec):
 *   - No behavior change
 *   - No edits in extracted files (src/routes/*.ts) beyond imports
 */

// Imports specific to HTTP server setup
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import crypto from 'node:crypto';
import { type ApiKeyPermission, type ApiKeyRole } from './services/auth/index.js';
import { isJsonLogsEnabled, setStructuredLogSink } from './logger.js';
import { normalizeApiErrorPayload } from './api-error-envelope.js';

const app = Fastify({
  bodyLimit: 1048576, // 1MB — Issue #349: explicit body size limit
  trustProxy: process.env.TRUST_PROXY === 'true', // #633: Only trust X-Forwarded-For when explicitly enabled
  // Issue #1416: UUID-v4 request IDs for log correlation across components
  requestIdHeader: 'x-request-id',
  genReqId: () => crypto.randomUUID(),
  // Issue #3500: Full pino logs when --json-logs set; error-only otherwise so app.log.error still works
  logger: isJsonLogsEnabled() ? {
    // #230: Redact auth tokens and hook secrets from request logs
    // #1393: Also redact ?secret= query param used by hook auth fallback
    serializers: {
      req(req) {
        let url = req.url ?? '';
        url = url.replace(/token=[^&]*/g, 'token=[REDACTED]');
        url = url.replace(/secret=[^&]*/g, 'secret=[REDACTED]');
        return {
          method: req.method,
          url,
          // ...rest intentionally omitted — prevents token leakage via headers
        };
      },
    },
  } : { level: "error" },
});

const GLOBAL_RATE_LIMIT_CONFIG = {
  global: true,
  keyGenerator: (req: FastifyRequest) => req.ip ?? 'unknown',
  max: 600,
  timeWindow: '1 minute',
} as const;

app.register(fastifyRateLimit, GLOBAL_RATE_LIMIT_CONFIG);

// #4435: Treat empty JSON body as {} — Fastify's default parser throws on
// Content-Type: application/json with no body, breaking endpoints like
// POST /v1/sessions/:id/fork that accept optional bodies.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  if (typeof body === 'string' && body.trim().length === 0) {
    return done(null, {});
  }
  try {
    const json = JSON.parse(body as string);
    done(null, json);
  } catch (e: unknown) {
    done(e as Error, undefined);
  }
});

// #1108: Decorate request with authKeyId — type-safe alternative to unsafe cast
app.decorateRequest('authKeyId', null as unknown as string);
app.decorateRequest('matchedPermission', null as unknown as ApiKeyPermission);
app.decorateRequest('authRole', null as unknown as ApiKeyRole);
app.decorateRequest('authPermissions', null as unknown as ApiKeyPermission[]);
app.decorateRequest('authActor', null as unknown as string);
// Issue #1944: Tenant ID from authenticated API key
app.decorateRequest('tenantId', undefined as unknown as string);

setStructuredLogSink({
  info: (record) => app.log.info(record),
  warn: (record) => app.log.warn(record),
  error: (record) => app.log.error(record),
});

// #227: Security headers on all API responses (skip SSE)
app.addHook('onSend', (req, reply, payload, done) => {
  const contentType = reply.getHeader('content-type');
  if (typeof contentType === 'string' && contentType.includes('text/event-stream')) {
    return done();
  }
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  // E5-2: API versioning — all /v1/ responses include version header
  if (req.url?.startsWith('/v1/')) {
    reply.header('X-Aegis-API-Version', '1');
  }
  // Issue #1416: Return request ID in response header for client-side correlation
  reply.header('X-Request-Id', req.id);
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=()');
  const normalizedPayload = normalizeApiErrorPayload({
    payload,
    statusCode: reply.statusCode,
    requestId: req.id,
    contentType: typeof contentType === 'string' ? contentType : undefined,
  });
  done(null, normalizedPayload);
});

// Auth middleware setup (Issue #39: multi-key auth with rate limiting)

// Route handlers are registered in main() via route modules (src/routes/*).

// ── Start ────────────────────────────────────────────────────────────

// Export for use by server-bootstrap.ts
export { app };
