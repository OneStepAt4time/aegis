import { createHash, randomBytes } from 'node:crypto';
import * as client from 'openid-client';
import type { AuthorizationCodeGrantChecks, ClientMetadata, Configuration, IDToken } from 'openid-client';
import { getDashboardUrl, normalizeBaseUrl } from '../../base-url.js';
import { SYSTEM_TENANT, type Config } from '../../config.js';
import { parseDashboardOidcConfig, type DashboardOidcConfig } from './oidc-config.js';
import { permissionsForRole, type ApiKeyPermission } from './permissions.js';
import type { ApiKeyRole } from './types.js';

export const DASHBOARD_SESSION_COOKIE = '__Host-aegis_dashboard_session';
export const OIDC_STATE_COOKIE = '__Host-aegis_oidc_state';
export const DASHBOARD_SESSION_TTL_MS = 60 * 60 * 1000;
export const OIDC_AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;
export const OIDC_DISCOVERY_TTL_MS = 60 * 60 * 1000;
export const MAX_DASHBOARD_SESSIONS_PER_USER = 5;

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface OidcAuthorizationRequest {
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
}

export interface OidcTokenValidationResult {
  claims: Record<string, unknown>;
  idToken?: string;
}

export interface OidcProvider {
  discover(config: DashboardOidcConfig, redirectUri: string): Promise<void>;
  buildAuthorizationUrl(request: OidcAuthorizationRequest): URL;
  exchangeAuthorizationCode(
    callbackUrl: URL,
    checks: Required<Pick<AuthorizationCodeGrantChecks, 'expectedNonce' | 'expectedState' | 'pkceCodeVerifier'>>,
  ): Promise<OidcTokenValidationResult>;
  buildEndSessionUrl(idToken: string, postLogoutRedirectUri: string): URL | null;
}

export interface DashboardIdentity {
  userId: string;
  email?: string;
  name?: string;
  tenantId: string;
  role: ApiKeyRole;
  claims: Record<string, unknown>;
}

export interface DashboardSession extends DashboardIdentity {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  idToken?: string;
}

export interface DashboardSessionView {
  authenticated: true;
  userId: string;
  email?: string;
  name?: string;
  tenantId: string;
  role: ApiKeyRole;
  createdAt: number;
  expiresAt: number;
}

export interface DashboardRequestAuthContext {
  keyId: string;
  actor: string;
  tenantId: string;
  role: ApiKeyRole;
  permissions: ApiKeyPermission[];
}

interface PendingAuthRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  expiresAt: number;
}

export class OidcAuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OidcAuthError';
  }
}

export class DashboardSessionStore {
  private readonly sessions = new Map<string, DashboardSession>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly generateSessionId: () => string = () => randomOpaqueToken(32),
  ) {}

  create(identity: DashboardIdentity, idToken?: string): DashboardSession {
    this.pruneExpired();
    const createdAt = this.now();
    const session: DashboardSession = {
      ...identity,
      sessionId: this.generateSessionId(),
      createdAt,
      expiresAt: createdAt + DASHBOARD_SESSION_TTL_MS,
      ...(idToken ? { idToken } : {}),
    };
    this.sessions.set(session.sessionId, session);
    this.evictOverflow(identity.userId);
    return session;
  }

  get(sessionId: string | undefined): DashboardSession | null {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  delete(sessionId: string | undefined): boolean {
    if (!sessionId) return false;
    return this.sessions.delete(sessionId);
  }

  toView(session: DashboardSession): DashboardSessionView {
    return {
      authenticated: true,
      userId: session.userId,
      ...(session.email ? { email: session.email } : {}),
      ...(session.name ? { name: session.name } : {}),
      tenantId: session.tenantId,
      role: session.role,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    };
  }

  count(): number {
    this.pruneExpired();
    return this.sessions.size;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(sessionId);
    }
  }

  private evictOverflow(userId: string): void {
    const userSessions = [...this.sessions.values()]
      .filter((session) => session.userId === userId)
      .sort((left, right) => left.createdAt - right.createdAt);

    while (userSessions.length > MAX_DASHBOARD_SESSIONS_PER_USER) {
      const evicted = userSessions.shift();
      if (evicted) this.sessions.delete(evicted.sessionId);
    }
  }
}

export class OpenidClientProvider implements OidcProvider {
  private configuration: Configuration | null = null;

  async discover(config: DashboardOidcConfig, redirectUri: string): Promise<void> {
    const metadata: Partial<ClientMetadata> = {
      redirect_uris: [redirectUri],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    };

    this.configuration = await client.discovery(
      new URL(config.issuer),
      config.clientId,
      metadata,
      client.ClientSecretBasic(config.clientSecret),
      { execute: [client.enableNonRepudiationChecks], timeout: 10 },
    );
  }

  buildAuthorizationUrl(request: OidcAuthorizationRequest): URL {
    const parameters: Record<string, string> = {
      redirect_uri: request.redirectUri,
      scope: request.scope,
      state: request.state,
      nonce: request.nonce,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
    };
    if (request.loginHint) parameters.login_hint = request.loginHint;
    return client.buildAuthorizationUrl(this.requireConfiguration(), parameters);
  }

  async exchangeAuthorizationCode(
    callbackUrl: URL,
    checks: Required<Pick<AuthorizationCodeGrantChecks, 'expectedNonce' | 'expectedState' | 'pkceCodeVerifier'>>,
  ): Promise<OidcTokenValidationResult> {
    const tokens = await client.authorizationCodeGrant(
      this.requireConfiguration(),
      callbackUrl,
      { ...checks, idTokenExpected: true },
    );
    const claims = tokens.claims();
    if (!claims) {
      throw new OidcAuthError('OIDC token response did not include an ID token', 502);
    }
    return {
      claims: copyClaims(claims),
      ...(typeof tokens.id_token === 'string' ? { idToken: tokens.id_token } : {}),
    };
  }

  buildEndSessionUrl(idToken: string, postLogoutRedirectUri: string): URL | null {
    const endSessionEndpoint = this.requireConfiguration().serverMetadata().end_session_endpoint;
    if (!endSessionEndpoint) return null;
    const url = new URL(endSessionEndpoint);
    url.searchParams.set('id_token_hint', idToken);
    url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
    return url;
  }

  private requireConfiguration(): Configuration {
    if (!this.configuration) {
      throw new OidcAuthError('OIDC discovery has not completed', 503);
    }
    return this.configuration;
  }
}

export interface DashboardOidcManagerOptions {
  config: Config;
  oidcConfig: DashboardOidcConfig;
  provider?: OidcProvider;
  sessionStore?: DashboardSessionStore;
  now?: () => number;
}

export interface BeginLoginOptions {
  loginHint?: string;
}

export interface BeginLoginResult {
  redirectUrl: URL;
  state: string;
  expiresAt: number;
}

export class DashboardOIDCManager {
  readonly baseUrl: string;
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
  readonly sessions: DashboardSessionStore;
  private readonly provider: OidcProvider;
  private readonly now: () => number;
  private readonly pendingAuth = new Map<string, PendingAuthRequest>();
  private discoveryExpiresAt = 0;

  constructor(private readonly options: DashboardOidcManagerOptions) {
    this.now = options.now ?? Date.now;
    this.provider = options.provider ?? new OpenidClientProvider();
    this.sessions = options.sessionStore ?? new DashboardSessionStore(this.now);
    this.baseUrl = normalizeBaseUrl(options.config.baseUrl ?? 'http://127.0.0.1:9100');
    this.redirectUri = `${this.baseUrl}${options.oidcConfig.redirectPath}`;
    this.postLogoutRedirectUri = getDashboardUrl(this.baseUrl);
  }

  async initialize(): Promise<void> {
    await this.refreshDiscovery();
  }

  async beginLogin(options: BeginLoginOptions = {}): Promise<BeginLoginResult> {
    await this.ensureDiscovery();
    this.prunePendingAuth();
    const state = randomOpaqueToken(16);
    const nonce = randomOpaqueToken(16);
    const pkce = generatePkcePair();
    const expiresAt = this.now() + OIDC_AUTH_REQUEST_TTL_MS;
    this.pendingAuth.set(state, {
      state,
      nonce,
      codeVerifier: pkce.codeVerifier,
      codeChallenge: pkce.codeChallenge,
      expiresAt,
    });

    const redirectUrl = this.provider.buildAuthorizationUrl({
      redirectUri: this.redirectUri,
      scope: this.options.oidcConfig.scopes,
      state,
      nonce,
      codeChallenge: pkce.codeChallenge,
      ...(options.loginHint ? { loginHint: options.loginHint } : {}),
    });

    return { redirectUrl, state, expiresAt };
  }

  async completeCallback(callbackUrl: URL, stateCookie: string | undefined): Promise<DashboardSession> {
    await this.ensureDiscovery();
    const idpError = callbackUrl.searchParams.get('error');
    if (idpError) {
      throw new OidcAuthError('OIDC provider rejected the authorization request', 502);
    }
    const code = callbackUrl.searchParams.get('code');
    const state = callbackUrl.searchParams.get('state');
    if (!code) {
      throw new OidcAuthError('OIDC callback missing authorization code', 400);
    }
    if (!state || !stateCookie || state !== stateCookie) {
      if (state) this.pendingAuth.delete(state);
      throw new OidcAuthError('OIDC state mismatch', 403);
    }

    const pending = this.consumePendingAuth(state);
    if (!pending) {
      throw new OidcAuthError('OIDC authorization request expired or already used', 403);
    }
    if (!pending.codeChallenge) {
      throw new OidcAuthError('OIDC authorization request missing PKCE challenge', 403);
    }

    const tokenResult = await this.provider.exchangeAuthorizationCode(callbackUrl, {
      expectedNonce: pending.nonce,
      expectedState: pending.state,
      pkceCodeVerifier: pending.codeVerifier,
    });
    validateOidcClaims({
      claims: tokenResult.claims,
      issuer: this.options.oidcConfig.issuer,
      clientId: this.options.oidcConfig.clientId,
      nonce: pending.nonce,
      nowSeconds: Math.floor(this.now() / 1000),
    });
    const identity = mapOidcClaimsToIdentity(tokenResult.claims, {
      roleClaim: this.options.oidcConfig.roleClaim,
      defaultTenantId: this.options.config.defaultTenantId,
      tenantWorkdirs: this.options.config.tenantWorkdirs,
    });
    if (!identity) {
      throw new OidcAuthError('OIDC identity is not mapped to a provisioned tenant', 403);
    }

    return this.sessions.create(identity, tokenResult.idToken);
  }

  getSession(sessionId: string | undefined): DashboardSession | null {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string | undefined): boolean {
    return this.sessions.delete(sessionId);
  }

  buildEndSessionUrl(session: DashboardSession | null): URL | null {
    if (!session?.idToken) return null;
    return this.provider.buildEndSessionUrl(session.idToken, this.postLogoutRedirectUri);
  }

  private async ensureDiscovery(): Promise<void> {
    if (this.discoveryExpiresAt > this.now()) return;
    await this.refreshDiscovery();
  }

  private async refreshDiscovery(): Promise<void> {
    await this.provider.discover(this.options.oidcConfig, this.redirectUri);
    this.discoveryExpiresAt = this.now() + OIDC_DISCOVERY_TTL_MS;
  }

  private consumePendingAuth(state: string): PendingAuthRequest | null {
    const pending = this.pendingAuth.get(state);
    this.pendingAuth.delete(state);
    if (!pending || pending.expiresAt <= this.now()) return null;
    return pending;
  }

  private prunePendingAuth(): void {
    const now = this.now();
    for (const [state, pending] of this.pendingAuth) {
      if (pending.expiresAt <= now) this.pendingAuth.delete(state);
    }
  }
}

export async function createDashboardOidcManagerFromEnv(config: Config): Promise<DashboardOIDCManager | null> {
  const oidcConfig = parseDashboardOidcConfig();
  if (!oidcConfig) return null;
  const manager = new DashboardOIDCManager({ config, oidcConfig });
  await manager.initialize();
  return manager;
}

export function getDashboardSessionAuthContext(session: DashboardSession): DashboardRequestAuthContext {
  const digest = createHash('sha256')
    .update(session.tenantId)
    .update('\0')
    .update(session.userId)
    .digest('hex')
    .slice(0, 32);
  const keyId = `dashboard:${session.tenantId}:${digest}`;
  return {
    keyId,
    actor: keyId,
    tenantId: session.tenantId,
    role: session.role,
    permissions: permissionsForRole(session.role),
  };
}

export interface ClaimValidationInput {
  claims: Record<string, unknown>;
  issuer: string;
  clientId: string;
  nonce: string;
  nowSeconds: number;
}

export function validateOidcClaims(input: ClaimValidationInput): void {
  const { claims, issuer, clientId, nonce, nowSeconds } = input;
  if (claims.iss !== issuer) {
    throw new OidcAuthError('OIDC ID token issuer mismatch', 403);
  }
  if (!audienceContains(claims.aud, clientId)) {
    throw new OidcAuthError('OIDC ID token audience mismatch', 403);
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    throw new OidcAuthError('OIDC ID token is expired', 403);
  }
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > nowSeconds)) {
    throw new OidcAuthError('OIDC ID token not-before claim is invalid', 403);
  }
  if (claims.nonce !== nonce) {
    throw new OidcAuthError('OIDC ID token nonce mismatch', 403);
  }
  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw new OidcAuthError('OIDC ID token subject is missing', 403);
  }
}

export interface ClaimMappingOptions {
  roleClaim: string;
  defaultTenantId: string;
  tenantWorkdirs: Record<string, { root: string; allowedPaths?: string[] }>;
}

export function mapOidcClaimsToIdentity(
  claims: Record<string, unknown>,
  options: ClaimMappingOptions,
): DashboardIdentity | null {
  const userId = stringClaim(claims.sub);
  if (!userId) return null;
  const tenantId = mapTenantId(claims, options);
  if (!tenantId) return null;
  return {
    userId,
    ...(stringClaim(claims.email) ? { email: stringClaim(claims.email) } : {}),
    ...(stringClaim(claims.name) ? { name: stringClaim(claims.name) } : {}),
    tenantId,
    role: mapRole(claims[options.roleClaim]),
    claims: { ...claims },
  };
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function randomOpaqueToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function copyClaims(claims: IDToken): Record<string, unknown> {
  return { ...claims };
}

function audienceContains(audience: unknown, clientId: string): boolean {
  if (typeof audience === 'string') return audience === clientId;
  if (!Array.isArray(audience)) return false;
  return audience.some((entry) => entry === clientId);
}

function stringClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function mapTenantId(claims: Record<string, unknown>, options: ClaimMappingOptions): string | null {
  const knownTenants = new Set([options.defaultTenantId, ...Object.keys(options.tenantWorkdirs)].filter(Boolean));
  const email = stringClaim(claims.email);
  const emailDomain = email?.includes('@') ? email.split('@').pop() : undefined;
  const candidates = [
    stringClaim(claims['aegis:tenant']),
    stringClaim(claims.hd),
    stringClaim(claims.tid),
    emailDomain,
  ];

  for (const candidate of candidates) {
    if (!candidate || candidate === SYSTEM_TENANT) continue;
    if (knownTenants.has(candidate)) return candidate;
  }
  return null;
}

function mapRole(value: unknown): ApiKeyRole {
  if (typeof value === 'string' && isKnownRole(value)) return value;
  if (Array.isArray(value)) {
    const firstKnownRole = value.find((entry): entry is ApiKeyRole => typeof entry === 'string' && isKnownRole(entry));
    if (firstKnownRole) return firstKnownRole;
  }
  return 'viewer';
}

function isKnownRole(value: string): value is ApiKeyRole {
  return value === 'admin' || value === 'operator' || value === 'viewer';
}