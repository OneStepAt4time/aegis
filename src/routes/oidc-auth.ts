import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_TTL_MS,
  OIDC_AUTH_REQUEST_TTL_MS,
  OIDC_STATE_COOKIE,
  OidcAuthError,
  type DashboardOIDCManager,
} from '../services/auth/OIDCManager.js';

const COOKIE_PATH = '/';
const LOGIN_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;
const CALLBACK_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const;
const LOGOUT_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

interface OidcRouteContext {
  dashboardOidc?: DashboardOIDCManager | null;
}

interface LoginQuery {
  login_hint?: string;
}

function getDashboardOidc(ctx: OidcRouteContext): DashboardOIDCManager | null {
  return ctx.dashboardOidc ?? null;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
  }
  return cookies;
}

function getCookie(req: FastifyRequest, name: string): string | undefined {
  return parseCookies(req.headers.cookie).get(name);
}

function appendSetCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader('Set-Cookie');
  if (Array.isArray(existing)) {
    reply.header('Set-Cookie', [...existing.map(String), cookie]);
    return;
  }
  if (typeof existing === 'string') {
    reply.header('Set-Cookie', [existing, cookie]);
    return;
  }
  reply.header('Set-Cookie', cookie);
}

type CookieSameSite = 'Strict' | 'Lax';

function buildCookie(name: string, value: string, maxAgeSeconds: number, sameSite: CookieSameSite = 'Strict'): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=' + COOKIE_PATH,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`,
  ].join('; ');
}

function buildClearedCookie(name: string, sameSite: CookieSameSite = 'Strict'): string {
  return [
    `${name}=`,
    'Path=' + COOKIE_PATH,
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    `SameSite=${sameSite}`,
  ].join('; ');
}

function buildCallbackUrl(req: FastifyRequest, manager: DashboardOIDCManager): URL {
  return new URL(req.url ?? '/auth/callback', manager.baseUrl);
}

function genericOidcErrorPage(): string {
  return '<!doctype html><html><head><title>Authentication failed</title></head><body><h1>Authentication failed</h1></body></html>';
}

function acceptsHtml(req: FastifyRequest): boolean {
  const accept = req.headers.accept;
  return typeof accept === 'string' && accept.includes('text/html');
}

function sanitizeLoginHint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /[\r\n]/.test(trimmed)) return undefined;
  return trimmed;
}

export function registerOidcAuthRoutes(app: FastifyInstance, ctx: OidcRouteContext): void {
  app.get<{ Querystring: LoginQuery }>(
    '/auth/login',
    { config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (req, reply) => {
      const manager = getDashboardOidc(ctx);
      if (!manager) return reply.status(404).send({ error: 'Not found' });
      try {
        const login = await manager.beginLogin({ loginHint: sanitizeLoginHint(req.query.login_hint) });
        appendSetCookie(reply, buildCookie(OIDC_STATE_COOKIE, login.state, OIDC_AUTH_REQUEST_TTL_MS / 1000, 'Lax'));
        return reply.status(302).header('Location', login.redirectUrl.href).send();
      } catch {
        return reply.status(503).type('text/html').send(genericOidcErrorPage());
      }
    },
  );

  app.get(
    '/auth/callback',
    { config: { rateLimit: CALLBACK_RATE_LIMIT } },
    async (req, reply) => {
      const manager = getDashboardOidc(ctx);
      if (!manager) return reply.status(404).send({ error: 'Not found' });
      appendSetCookie(reply, buildClearedCookie(OIDC_STATE_COOKIE, 'Lax'));
      try {
        const session = await manager.completeCallback(buildCallbackUrl(req, manager), getCookie(req, OIDC_STATE_COOKIE));
        appendSetCookie(reply, buildCookie(DASHBOARD_SESSION_COOKIE, session.sessionId, DASHBOARD_SESSION_TTL_MS / 1000));
        return reply.status(302).header('Location', '/dashboard/').send();
      } catch (error: unknown) {
        const statusCode = error instanceof OidcAuthError ? error.statusCode : 502;
        return reply.status(statusCode).type('text/html').send(genericOidcErrorPage());
      }
    },
  );

  app.get('/auth/session', async (req, reply) => {
    const manager = getDashboardOidc(ctx);
    if (!manager) return reply.status(404).send({ error: 'Not found' });
    const sessionId = getCookie(req, DASHBOARD_SESSION_COOKIE);
    const session = manager.getSession(sessionId);
    if (!session) {
      appendSetCookie(reply, buildClearedCookie(DASHBOARD_SESSION_COOKIE));
      return reply.status(401).send({ authenticated: false });
    }
    return manager.sessions.toView(session);
  });

  app.post(
    '/auth/logout',
    { config: { rateLimit: LOGOUT_RATE_LIMIT } },
    async (req, reply) => {
      const manager = getDashboardOidc(ctx);
      if (!manager) return reply.status(404).send({ error: 'Not found' });
      const sessionId = getCookie(req, DASHBOARD_SESSION_COOKIE);
      const session = manager.getSession(sessionId);
      manager.deleteSession(sessionId);
      appendSetCookie(reply, buildClearedCookie(DASHBOARD_SESSION_COOKIE));
      const endSessionUrl = manager.buildEndSessionUrl(session);
      if (endSessionUrl && acceptsHtml(req)) {
        return reply.status(303).header('Location', endSessionUrl.href).send();
      }
      return reply.status(204).send();
    },
  );
}