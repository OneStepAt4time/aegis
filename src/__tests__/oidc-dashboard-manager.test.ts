import { describe, expect, it } from 'vitest';
import type { AuthorizationCodeGrantChecks } from 'openid-client';
import type { Config } from '../config.js';
import {
  DASHBOARD_SESSION_TTL_MS,
  DashboardOIDCManager,
  DashboardSessionStore,
  OidcAuthError,
  generatePkcePair,
  getDashboardSessionAuthContext,
  mapOidcClaimsToIdentity,
  validateOidcClaims,
  type OidcAuthorizationRequest,
  type OidcProvider,
  type OidcTokenValidationResult,
} from '../services/auth/OIDCManager.js';
import type { DashboardOidcConfig } from '../services/auth/oidc-config.js';

class FakeProvider implements OidcProvider {
  discoveries = 0;
  authorizationRequest: OidcAuthorizationRequest | null = null;
  grantChecks: AuthorizationCodeGrantChecks | null = null;
  tokenResult: OidcTokenValidationResult = {
    idToken: 'id-token',
    claims: {
      iss: 'https://idp.example.com',
      aud: 'aegis-dashboard',
      exp: 2_000,
      nbf: 900,
      nonce: '',
      sub: 'user-1',
      email: 'ada@example.com',
      'aegis:tenant': 'default',
      aegis_role: 'operator',
    },
  };

  async discover(): Promise<void> {
    this.discoveries += 1;
  }

  buildAuthorizationUrl(request: OidcAuthorizationRequest): URL {
    this.authorizationRequest = request;
    const url = new URL('https://idp.example.com/authorize');
    url.searchParams.set('state', request.state);
    url.searchParams.set('nonce', request.nonce);
    url.searchParams.set('code_challenge', request.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('redirect_uri', request.redirectUri);
    url.searchParams.set('scope', request.scope);
    return url;
  }

  async exchangeAuthorizationCode(
    _callbackUrl: URL,
    checks: Required<Pick<AuthorizationCodeGrantChecks, 'expectedNonce' | 'expectedState' | 'pkceCodeVerifier'>>,
  ): Promise<OidcTokenValidationResult> {
    this.grantChecks = checks;
    return {
      ...this.tokenResult,
      claims: { ...this.tokenResult.claims, nonce: checks.expectedNonce },
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
    tenantWorkdirs: {
      default: { root: '/tmp/default' },
      'example.com': { root: '/tmp/example' },
      entraTenant: { root: '/tmp/entra' },
    },
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

describe('generatePkcePair', () => {
  it('generates RFC 7636 sized verifier and S256 challenge', () => {
    const pkce = generatePkcePair();
    expect(pkce.codeVerifier).toHaveLength(43);
    expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkce.codeChallenge).not.toBe(pkce.codeVerifier);
  });
});

describe('validateOidcClaims', () => {
  const validClaims = {
    iss: 'https://idp.example.com',
    aud: ['aegis-dashboard'],
    exp: 2_000,
    nbf: 900,
    nonce: 'nonce-1',
    sub: 'user-1',
  };

  it('accepts claims only when issuer, audience, exp, nbf, nonce, and sub pass', () => {
    expect(() => validateOidcClaims({
      claims: validClaims,
      issuer: 'https://idp.example.com',
      clientId: 'aegis-dashboard',
      nonce: 'nonce-1',
      nowSeconds: 1_000,
    })).not.toThrow();
  });

  it('accepts claims without the optional nbf claim', () => {
    const { nbf: _nbf, ...claimsWithoutNbf } = validClaims;
    expect(() => validateOidcClaims({
      claims: claimsWithoutNbf,
      issuer: 'https://idp.example.com',
      clientId: 'aegis-dashboard',
      nonce: 'nonce-1',
      nowSeconds: 1_000,
    })).not.toThrow();
  });

  it('rejects each required validation failure', () => {
    const base = { issuer: 'https://idp.example.com', clientId: 'aegis-dashboard', nonce: 'nonce-1', nowSeconds: 1_000 };
    expect(() => validateOidcClaims({ ...base, claims: { ...validClaims, iss: 'https://evil.example.com' } })).toThrow(OidcAuthError);
    expect(() => validateOidcClaims({ ...base, claims: { ...validClaims, aud: 'other-client' } })).toThrow(OidcAuthError);
    expect(() => validateOidcClaims({ ...base, claims: { ...validClaims, exp: 999 } })).toThrow(OidcAuthError);
    expect(() => validateOidcClaims({ ...base, claims: { ...validClaims, nbf: 1_001 } })).toThrow(OidcAuthError);
    expect(() => validateOidcClaims({ ...base, claims: { ...validClaims, nonce: 'wrong' } })).toThrow(OidcAuthError);
    expect(() => validateOidcClaims({ ...base, claims: { ...validClaims, sub: '' } })).toThrow(OidcAuthError);
  });
});

describe('mapOidcClaimsToIdentity', () => {
  it('maps tenant by priority and defaults unknown roles to viewer', () => {
    const identity = mapOidcClaimsToIdentity({
      sub: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      hd: 'example.com',
      'aegis:tenant': 'default',
      aegis_role: 'owner',
    }, {
      roleClaim: 'aegis_role',
      defaultTenantId: 'default',
      tenantWorkdirs: makeConfig().tenantWorkdirs,
    });

    expect(identity?.tenantId).toBe('default');
    expect(identity?.role).toBe('viewer');
    expect(identity?.email).toBe('ada@example.com');
  });

  it('falls back to email domain when provisioned', () => {
    const identity = mapOidcClaimsToIdentity({
      sub: 'user-1',
      email: 'ada@example.com',
    }, {
      roleClaim: 'aegis_role',
      defaultTenantId: 'default',
      tenantWorkdirs: makeConfig().tenantWorkdirs,
    });

    expect(identity?.tenantId).toBe('example.com');
  });

  it('denies unmapped tenants and reserved system tenant', () => {
    const options = {
      roleClaim: 'aegis_role',
      defaultTenantId: 'default',
      tenantWorkdirs: makeConfig().tenantWorkdirs,
    };
    expect(mapOidcClaimsToIdentity({ sub: 'user-1', email: 'ada@unknown.com' }, options)).toBeNull();
    expect(mapOidcClaimsToIdentity({ sub: 'user-1', 'aegis:tenant': '_system' }, options)).toBeNull();
  });
});

describe('DashboardSessionStore', () => {
  it('stores opaque server-side sessions with expiration and max per user', () => {
    let now = 1_000;
    let counter = 0;
    const store = new DashboardSessionStore(() => now, () => `session-${counter += 1}`);
    const identity = {
      userId: 'user-1',
      tenantId: 'default',
      role: 'viewer' as const,
      claims: { sub: 'user-1' },
    };

    for (let index = 0; index < 6; index += 1) {
      store.create(identity);
    }

    expect(store.count()).toBe(5);
    expect(store.get('session-1')).toBeNull();
    expect(store.get('session-6')?.expiresAt).toBe(1_000 + DASHBOARD_SESSION_TTL_MS);
    now += DASHBOARD_SESSION_TTL_MS + 1;
    expect(store.get('session-6')).toBeNull();
  });
});

describe('getDashboardSessionAuthContext', () => {
  it('builds a synthetic non-bearer actor with role-default permissions', () => {
    const context = getDashboardSessionAuthContext({
      sessionId: 'opaque-session-id',
      userId: 'user-1',
      email: 'ada@example.com',
      tenantId: 'default',
      role: 'viewer',
      claims: { sub: 'user-1' },
      createdAt: 1,
      expiresAt: 2,
    });

    expect(context.keyId).toMatch(/^dashboard:default:[a-f0-9]{32}$/);
    expect(context.actor).toBe(context.keyId);
    expect(context.keyId).not.toContain('opaque-session-id');
    expect(context.keyId).not.toContain('ada@example.com');
    expect(context.tenantId).toBe('default');
    expect(context.role).toBe('viewer');
    expect(context.permissions).toEqual(['create', 'audit']);
  });
});

describe('DashboardOIDCManager', () => {
  it('creates authorization requests with mandatory PKCE, state, and nonce', async () => {
    const provider = new FakeProvider();
    const manager = new DashboardOIDCManager({ config: makeConfig(), oidcConfig: makeOidcConfig(), provider, now: () => 1_000_000 });
    await manager.initialize();

    const login = await manager.beginLogin({ loginHint: 'ada@example.com' });

    expect(login.redirectUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(login.redirectUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(login.redirectUrl.searchParams.get('state')).toBe(login.state);
    expect(login.redirectUrl.searchParams.get('nonce')).toBeTruthy();
    expect(provider.authorizationRequest?.loginHint).toBe('ada@example.com');
  });

  it('exchanges authorization code once and creates a tenant-aware dashboard session', async () => {
    const provider = new FakeProvider();
    const manager = new DashboardOIDCManager({ config: makeConfig(), oidcConfig: makeOidcConfig(), provider, now: () => 1_000_000 });
    await manager.initialize();
    const login = await manager.beginLogin();
    const callbackUrl = new URL(`https://aegis.example.com/auth/callback?code=abc&state=${login.state}`);

    const session = await manager.completeCallback(callbackUrl, login.state);

    expect(provider.grantChecks?.expectedState).toBe(login.state);
    expect(provider.grantChecks?.pkceCodeVerifier).toHaveLength(43);
    expect(session.sessionId).toBeTruthy();
    expect(session.tenantId).toBe('default');
    expect(session.role).toBe('operator');
    await expect(manager.completeCallback(callbackUrl, login.state)).rejects.toThrow(OidcAuthError);
  });
});