import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import type { AuthorizationCodeGrantChecks } from 'openid-client';
import type { Config } from '../config.js';
import { registerOidcAuthRoutes } from '../routes/oidc-auth.js';
import {
  DASHBOARD_SESSION_COOKIE,
  DashboardOIDCManager,
  OIDC_STATE_COOKIE,
  type OidcAuthorizationRequest,
  type OidcProvider,
  type OidcTokenValidationResult,
} from '../services/auth/OIDCManager.js';
import type { DashboardOidcConfig } from '../services/auth/oidc-config.js';

class RouteFakeProvider implements OidcProvider {
  lastAuthorizationRequest: OidcAuthorizationRequest | null = null;
  exchangeError: Error | null = null;

  async discover(): Promise<void> {}

  buildAuthorizationUrl(request: OidcAuthorizationRequest): URL {
    this.lastAuthorizationRequest = request;
    const url = new URL('https://idp.example.com/authorize');
    url.searchParams.set('state', request.state);
    url.searchParams.set('nonce', request.nonce);
    url.searchParams.set('code_challenge', request.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url;
  }

  async exchangeAuthorizationCode(
    _callbackUrl: URL,
    checks: Required<Pick<AuthorizationCodeGrantChecks, 'expectedNonce' | 'expectedState' | 'pkceCodeVerifier'>>,
  ): Promise<OidcTokenValidationResult> {
    if (this.exchangeError) throw this.exchangeError;
    return {
      idToken: 'id-token',
      claims: {
        iss: 'https://idp.example.com',
        aud: 'aegis-dashboard',
        exp: 2_000,
        nbf: 900,
        nonce: checks.expectedNonce,
        sub: 'user-1',
        email: 'ada@example.com',
        'aegis:tenant': 'default',
        aegis_role: 'admin',
      },
    };
  }

  buildEndSessionUrl(idToken: string, postLogoutRedirectUri: string): URL | null {
    const url = new URL('https://idp.example.com/logout');
    url.searchParams.set('id_token_hint', idToken);
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    return url;
  }
}

function makeConfig(): Config {
  return {
    baseUrl: 'https://aegis.example.com',
    port: 9100,
    host: '127.0.0.1',
    authToken: '',
    clientAuthToken: '',
    tmuxSession: 'aegis',
    stateDir: '/tmp/aegis',
    claudeProjectsDir: '/tmp/claude',
    maxSessionAgeMs: 1,
    reaperIntervalMs: 1,
    continuationPointerTtlMs: 1,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 1,
    tgTopicAutoDelete: true,
    tgTopicTTLHours: 0,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default',
    stallThresholdMs: 1,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    metricsToken: '',
    pipelineStageTimeoutMs: 0,
    alerting: { webhooks: [], failureThreshold: 5, cooldownMs: 1 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: true,
    sseIdleMs: 1,
    sseClientTimeoutMs: 1,
    hookTimeoutMs: 1,
    shutdownGraceMs: 1,
    keyRotationGraceSeconds: 1,
    shutdownHardMs: 1,
    stateStore: 'file',
    postgresUrl: '',
    dashboardEnabled: true,
    defaultTenantId: 'default',
    tenantWorkdirs: { default: { root: '/tmp/default' } },
    rateLimit: { enabled: true, sessionsMax: 100, generalMax: 30, timeWindowSec: 60 },
  };
}

function makeOidcConfig(): DashboardOidcConfig {
  return {
    issuer: 'https://idp.example.com',
    clientId: 'aegis-dashboard',
    clientSecret: 'secret',
    audience: 'aegis-dashboard',
    scopes: 'openid profile email',
    roleClaim: 'aegis_role',
    authDir: '',
    redirectPath: '/auth/callback',
  };
}

async function createApp(withOidc = true): Promise<{ app: FastifyInstance; manager: DashboardOIDCManager | null; provider: RouteFakeProvider }> {
  const app = Fastify({ logger: false });
  await app.register(fastifyRateLimit, { global: false, keyGenerator: (req) => req.ip ?? 'unknown' });
  const provider = new RouteFakeProvider();
  const manager = withOidc
    ? new DashboardOIDCManager({ config: makeConfig(), oidcConfig: makeOidcConfig(), provider, now: () => 1_000_000 })
    : null;
  if (manager) await manager.initialize();
  registerOidcAuthRoutes(app, { dashboardOidc: manager });
  await app.ready();
  return { app, manager, provider };
}

function findCookie(setCookie: string[] | undefined, name: string): string | undefined {
  return setCookie?.find((cookie) => cookie.startsWith(`${name}=`));
}

function setCookieHeaders(header: string | string[] | undefined): string[] {
  if (Array.isArray(header)) return header;
  if (typeof header === 'string') return [header];
  return [];
}

describe('OIDC auth routes', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('returns 404 when OIDC is disabled', async () => {
    const created = await createApp(false);
    app = created.app;

    const response = await app.inject({ method: 'GET', url: '/auth/login' });

    expect(response.statusCode).toBe(404);
  });

  it('login redirects to IdP and sets an HttpOnly SameSite=Lax state cookie', async () => {
    const created = await createApp();
    app = created.app;

    const response = await app.inject({ method: 'GET', url: '/auth/login?login_hint=ada%40example.com' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://idp.example.com/authorize');
    expect(response.headers.location).toContain('code_challenge_method=S256');
    const stateCookie = findCookie(setCookieHeaders(response.headers['set-cookie']), OIDC_STATE_COOKIE);
    expect(stateCookie).toContain('HttpOnly');
    expect(stateCookie).toContain('Secure');
    expect(stateCookie).toContain('SameSite=Lax');
    expect(created.provider.lastAuthorizationRequest?.loginHint).toBe('ada@example.com');
  });

  it('callback rejects state mismatch generically and clears state cookie', async () => {
    const created = await createApp();
    app = created.app;
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(String(login.headers.location)).searchParams.get('state');

    const response = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=abc&state=${state}`,
      headers: { cookie: `${OIDC_STATE_COOKIE}=wrong` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Authentication failed');
    expect(response.body).not.toContain('state mismatch');
    const cleared = findCookie(setCookieHeaders(response.headers['set-cookie']), OIDC_STATE_COOKIE);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('SameSite=Lax');
  });

  it('callback creates secure dashboard session cookie and /auth/session exposes identity', async () => {
    const created = await createApp();
    app = created.app;
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const loginUrl = new URL(String(login.headers.location));
    const state = loginUrl.searchParams.get('state');

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=abc&state=${state}`,
      headers: { cookie: `${OIDC_STATE_COOKIE}=${state}` },
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/dashboard/');
    const sessionCookie = findCookie(setCookieHeaders(callback.headers['set-cookie']), DASHBOARD_SESSION_COOKIE);
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('Secure');
    expect(sessionCookie).toContain('SameSite=Strict');
    expect(sessionCookie).toContain('Max-Age=3600');

    const sessionValue = callback.cookies.find((cookie) => cookie.name === DASHBOARD_SESSION_COOKIE)?.value;
    const session = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=${sessionValue}` } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ authenticated: true, userId: 'user-1', tenantId: 'default', role: 'admin' });
    expect(session.json()).not.toHaveProperty('sessionId');
  });

  it('callback returns a generic error without leaking provider details', async () => {
    const created = await createApp();
    app = created.app;
    created.provider.exchangeError = new Error('IdP rejected client secret super-sensitive-secret');
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(String(login.headers.location)).searchParams.get('state');

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=abc&state=${state}`,
      headers: { cookie: `${OIDC_STATE_COOKIE}=${state}` },
    });

    expect(callback.statusCode).toBe(502);
    expect(callback.body).toContain('Authentication failed');
    expect(callback.body).not.toContain('super-sensitive-secret');
    expect(callback.body).not.toContain('IdP rejected');
  });

  it('logout deletes the server-side session and clears the cookie', async () => {
    const created = await createApp();
    app = created.app;
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(String(login.headers.location)).searchParams.get('state');
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=abc&state=${state}`,
      headers: { cookie: `${OIDC_STATE_COOKIE}=${state}` },
    });
    const sessionValue = callback.cookies.find((cookie) => cookie.name === DASHBOARD_SESSION_COOKIE)?.value;

    const logout = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=${sessionValue}` } });

    expect(logout.statusCode).toBe(204);
    expect(created.manager?.getSession(sessionValue)).toBeNull();
    const cleared = findCookie(setCookieHeaders(logout.headers['set-cookie']), DASHBOARD_SESSION_COOKIE);
    expect(cleared).toContain('Max-Age=0');
  });

  it('logout can redirect browser flows to the discovered IdP end-session endpoint', async () => {
    const created = await createApp();
    app = created.app;
    const login = await app.inject({ method: 'GET', url: '/auth/login' });
    const state = new URL(String(login.headers.location)).searchParams.get('state');
    const callback = await app.inject({
      method: 'GET',
      url: `/auth/callback?code=abc&state=${state}`,
      headers: { cookie: `${OIDC_STATE_COOKIE}=${state}` },
    });
    const sessionValue = callback.cookies.find((cookie) => cookie.name === DASHBOARD_SESSION_COOKIE)?.value;

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `${DASHBOARD_SESSION_COOKIE}=${sessionValue}`, accept: 'text/html' },
    });

    expect(logout.statusCode).toBe(303);
    expect(logout.headers.location).toContain('https://idp.example.com/logout');
    expect(logout.headers.location).toContain('post_logout_redirect_uri=https%3A%2F%2Faegis.example.com%2Fdashboard%2F');
  });

  it('rate limits login and callback routes', async () => {
    const created = await createApp();
    app = created.app;

    for (let index = 0; index < 30; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/auth/login' });
      expect(response.statusCode).toBe(302);
    }
    const throttledLogin = await app.inject({ method: 'GET', url: '/auth/login' });
    expect(throttledLogin.statusCode).toBe(429);

    const second = await createApp();
    await app.close();
    app = second.app;
    for (let index = 0; index < 20; index += 1) {
      const response = await app.inject({ method: 'GET', url: '/auth/callback' });
      expect(response.statusCode).toBe(400);
    }
    const throttledCallback = await app.inject({ method: 'GET', url: '/auth/callback' });
    expect(throttledCallback.statusCode).toBe(429);
  });
});