import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_TTL_MS,
  OIDC_AUTH_REQUEST_TTL_MS,
  OIDC_STATE_COOKIE,
  OidcAuthError,
  type DashboardSessionStore,
  type DashboardOIDCManager,
} from '../services/auth/OIDCManager.js';

const COOKIE_PATH = '/';
const LOGIN_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;
const CALLBACK_RATE_LIMIT = { max: 20, timeWindow: '1 minute' } as const;
const SESSION_RATE_LIMIT = { max: 120, timeWindow: '1 minute' } as const;
const LOGOUT_RATE_LIMIT = { max: 30, timeWindow: '1 minute' } as const;

interface OidcRouteContext {
  dashboardOidc?: DashboardOIDCManager | null;
  dashboardTokenSessions?: DashboardSessionStore | null;
}

interface LoginQuery {
  login_hint?: string;
}

type LoginRequest = FastifyRequest<{ Querystring: LoginQuery }>;

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

export function appendSetCookie(reply: FastifyReply, cookie: string): void {
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

/** Check if the request was made over HTTPS (or a trusted proxy forwarded it). */
function isSecureRequest(req: FastifyRequest): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (proto) return proto === 'https';
  return req.protocol === 'https';
}


export function buildCookie(name: string, value: string, maxAgeSeconds: number, sameSite: CookieSameSite = 'Strict', secure: boolean = true): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=' + COOKIE_PATH,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
  ];
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}

export function buildClearedCookie(name: string, sameSite: CookieSameSite = 'Strict', secure: boolean = true): string {
  const parts = [
    `${name}=`,
    'Path=' + COOKIE_PATH,
    'Max-Age=0',
    'HttpOnly',
  ];
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
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

async function sendOidcRedirect(ctx: OidcRouteContext, req: LoginRequest, reply: FastifyReply): Promise<void> {
  const manager = getDashboardOidc(ctx);
  if (!manager) {
    await reply.status(404).send({ error: 'Not found' });
    return;
  }
  try {
    const login = await manager.beginLogin({ loginHint: sanitizeLoginHint(req.query.login_hint) });
    appendSetCookie(reply, buildCookie(OIDC_STATE_COOKIE, login.state, OIDC_AUTH_REQUEST_TTL_MS / 1000, 'Lax', isSecureRequest(req)));
    await reply.status(302).header('Location', login.redirectUrl.href).send();
  } catch {
    await reply.status(503).type('text/html').send(genericOidcErrorPage());
  }
}

export function registerOidcAuthRoutes(app: FastifyInstance, ctx: OidcRouteContext): void {
  app.after(() => {
    app.get<{ Querystring: LoginQuery }>(
      '/auth/login',
      { config: { rateLimit: LOGIN_RATE_LIMIT }, preHandler: async (req, reply) => sendOidcRedirect(ctx, req, reply) },
      async (_req, reply) => {
        return reply.status(500).send({ error: 'OIDC redirect was not completed' });
      },
    );

    app.get(
      '/auth/callback',
      { config: { rateLimit: CALLBACK_RATE_LIMIT } },
      async (req, reply) => {
        const manager = getDashboardOidc(ctx);
        if (!manager) return reply.status(404).send({ error: 'Not found' });
        appendSetCookie(reply, buildClearedCookie(OIDC_STATE_COOKIE, 'Lax', isSecureRequest(req)));
        try {
          const session = await manager.completeCallback(buildCallbackUrl(req, manager), getCookie(req, OIDC_STATE_COOKIE));
          appendSetCookie(reply, buildCookie(DASHBOARD_SESSION_COOKIE, session.sessionId, DASHBOARD_SESSION_TTL_MS / 1000, 'Strict', isSecureRequest(req)));
          return reply.status(302).header('Location', '/dashboard/').send();
        } catch (error: unknown) {
          const statusCode = error instanceof OidcAuthError ? error.statusCode : 502;
          return reply.status(statusCode).type('text/html').send(genericOidcErrorPage());
        }
      },
    );

    app.get(
      '/auth/session',
      { config: { rateLimit: SESSION_RATE_LIMIT } },
      async (req, reply) => {
        const manager = getDashboardOidc(ctx);
        const sessionId = getCookie(req, DASHBOARD_SESSION_COOKIE);
        const tokenSessionStore = ctx.dashboardTokenSessions ?? null;
        const tokenSession = tokenSessionStore?.get(sessionId) ?? null;
        if (tokenSession && tokenSessionStore) {
          return { oidcAvailable: manager !== null, authMethod: 'token', ...tokenSessionStore.toView(tokenSession) };
        }
        if (!manager) return { oidcAvailable: false, authenticated: false };
        const session = manager.getSession(sessionId);
        if (!session) {
          appendSetCookie(reply, buildClearedCookie(DASHBOARD_SESSION_COOKIE, 'Strict', isSecureRequest(req)));
          return reply.status(401).send({ oidcAvailable: true, authenticated: false });
        }
        return { oidcAvailable: true, authMethod: 'oidc', ...manager.sessions.toView(session) };
      },
    );

    app.post(
      '/auth/logout',
      { config: { rateLimit: LOGOUT_RATE_LIMIT } },
      async (req, reply) => {
        const manager = getDashboardOidc(ctx);
        const sessionId = getCookie(req, DASHBOARD_SESSION_COOKIE);
        const tokenSessionDeleted = ctx.dashboardTokenSessions?.delete(sessionId) ?? false;
        if (!manager) {
          appendSetCookie(reply, buildClearedCookie(DASHBOARD_SESSION_COOKIE, 'Strict', isSecureRequest(req)));
          return reply.status(204).send();
        }
        const session = manager.getSession(sessionId);
        manager.deleteSession(sessionId);
        appendSetCookie(reply, buildClearedCookie(DASHBOARD_SESSION_COOKIE, 'Strict', isSecureRequest(req)));
        if (tokenSessionDeleted) return reply.status(204).send();
        const endSessionUrl = manager.buildEndSessionUrl(session);
        if (endSessionUrl && acceptsHtml(req)) {
          return reply.status(303).header('Location', endSessionUrl.href).send();
        }
        return reply.status(204).send();
      },
    );
  });
}
