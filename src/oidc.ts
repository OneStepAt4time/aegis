/**
 * oidc.ts — SSO/OIDC integration for dashboard authentication.
 *
 * Issue #1410: Uses openid-client for spec-compliant OIDC Relying Party.
 * Provides login/callback/logout routes and session cookie management.
 * API key auth (auth.ts) is untouched — OIDC is an additional auth path.
 */

import { randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import {
  discovery,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  type Configuration,
} from 'openid-client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ApiKeyRole } from './auth.js';

export interface OidcUserInfo {
  sub: string;
  email: string;
  name?: string;
  role: ApiKeyRole;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  cookieSecret: string;
  sessionTtlMs: number;
  roleMap: Record<string, string>;
}

const SESSION_COOKIE_NAME = 'aegis_session';

/**
 * Check whether OIDC is enabled (issuer, clientId, and clientSecret all configured).
 */
export function isOidcEnabled(oidc: OidcConfig): boolean {
  return !!oidc.issuer && !!oidc.clientId && !!oidc.clientSecret;
}

/**
 * Resolve the cookie signing secret. If not configured, generate a random one
 * (sessions will not survive restarts, but this is safe for development).
 */
function resolveCookieSecret(cookieSecret: string): string {
  if (cookieSecret) return cookieSecret;
  return randomBytes(32).toString('hex');
}

/** OIDC Relying Party manager. */
export class OidcManager {
  private client: Configuration | null = null;
  private config: OidcConfig;
  private cookieSecret: string;

  constructor(oidcConfig: OidcConfig) {
    this.config = oidcConfig;
    this.cookieSecret = resolveCookieSecret(oidcConfig.cookieSecret);
  }

  /** Whether OIDC is configured and ready. */
  get enabled(): boolean {
    return isOidcEnabled(this.config);
  }

  /** Initialize the OIDC client by discovering the issuer's metadata. */
  async initialize(): Promise<void> {
    if (!this.enabled) return;

    try {
      this.client = await discovery(
        new URL(this.config.issuer),
        this.config.clientId,
        { client_secret: this.config.clientSecret },
      );
      console.log(`OIDC: discovered issuer at ${this.config.issuer}`);
    } catch (err) {
      console.error(`OIDC: discovery failed for ${this.config.issuer}:`, err);
      this.client = null;
    }
  }

  /** Generate the authorization redirect URL with PKCE. */
  getAuthorizationUrl(redirectUri: string, state: string, codeVerifier: string): string {
    if (!this.client) throw new Error('OIDC client not initialized');

    const challenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const url = buildAuthorizationUrl(this.client, {
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });

    return url.toString();
  }

  /** Handle the OAuth2 callback: exchange code for tokens and extract user info. */
  async handleCallback(
    redirectUri: string,
    code: string,
    state: string,
    codeVerifier: string,
  ): Promise<OidcUserInfo> {
    if (!this.client) throw new Error('OIDC client not initialized');

    const tokens = await authorizationCodeGrant(
      this.client,
      new URL(redirectUri),
      { expectedState: state },
      { code_verifier: codeVerifier },
    );

    const claims = tokens.claims();
    if (!claims) throw new Error('OIDC: no ID token claims in response');

    const sub = (claims.sub as string) ?? '';
    const email = (claims.email as string) ?? '';
    const name = claims.name as string | undefined;

    return {
      sub,
      email,
      name,
      role: this.resolveRole(email),
    };
  }

  /** Create a signed session cookie value (HMAC-SHA256). */
  createSessionCookie(user: OidcUserInfo): { value: string; maxAge: number } {
    const payload = JSON.stringify({
      sub: user.sub,
      email: user.email,
      name: user.name,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.config.sessionTtlMs / 1000,
    });

    const sig = createHmac('sha256', this.cookieSecret).update(payload).digest('hex');
    const value = Buffer.from(`${sig}.${payload}`).toString('base64url');

    return { value, maxAge: Math.floor(this.config.sessionTtlMs / 1000) };
  }

  /**
   * Validate a session cookie and return user info if valid.
   * Returns null if the cookie is missing, expired, or tampered.
   */
  validateSessionCookie(cookieValue: string): OidcUserInfo | null {
    try {
      const decoded = Buffer.from(cookieValue, 'base64url').toString('utf-8');
      const dotIdx = decoded.indexOf('.');
      if (dotIdx === -1) return null;

      const sig = decoded.slice(0, dotIdx);
      const payload = decoded.slice(dotIdx + 1);
      const expectedSig = createHmac('sha256', this.cookieSecret).update(payload).digest('hex');

      const sigBuf = Buffer.from(sig, 'utf-8');
      const expectedBuf = Buffer.from(expectedSig, 'utf-8');
      if (sigBuf.length !== expectedBuf.length) return null;
      if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

      const data = JSON.parse(payload) as {
        sub: string;
        email: string;
        name?: string;
        role: ApiKeyRole;
        exp: number;
      };

      // Check expiration
      if (Date.now() / 1000 > data.exp) return null;

      return { sub: data.sub, email: data.email, name: data.name, role: data.role };
    } catch {
      return null;
    }
  }

  /** Set the session cookie on a response. */
  setSessionCookie(reply: FastifyReply, user: OidcUserInfo): void {
    const { value, maxAge } = this.createSessionCookie(user);
    reply.setCookie(SESSION_COOKIE_NAME, value, {
      path: '/dashboard',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
    });
  }

  /** Clear the session cookie. */
  clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/dashboard' });
  }

  /** Resolve the Aegis role from the user's email using the role map. */
  private resolveRole(email: string): ApiKeyRole {
    if (!email) return 'viewer';

    for (const [pattern, role] of Object.entries(this.config.roleMap)) {
      if (pattern === '*' || email.endsWith(pattern)) {
        if (role === 'admin' || role === 'operator' || role === 'viewer') return role;
      }
    }
    return 'viewer';
  }

  /**
   * Register OIDC routes on the Fastify instance.
   * Routes: GET /v1/auth/oidc/login, GET /v1/auth/oidc/callback, GET /v1/auth/oidc/logout
   */
  registerRoutes(app: FastifyInstance): void {
    if (!this.enabled) return;

    // In-memory PKCE state store (state → verifier). Entries expire after 10 minutes.
    const pendingStates = new Map<string, { verifier: string; expiresAt: number }>();
    const STATE_TTL_MS = 10 * 60 * 1000;

    // Clean expired states every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of pendingStates) {
        if (now > entry.expiresAt) pendingStates.delete(key);
      }
    }, 60_000).unref();

    // GET /v1/auth/oidc/login — redirect to IdP
    app.get('/v1/auth/oidc/login', async (req, reply) => {
      const state = randomBytes(16).toString('hex');
      const verifier = randomBytes(32).toString('base64url');

      pendingStates.set(state, { verifier, expiresAt: Date.now() + STATE_TTL_MS });

      const protocol = req.protocol;
      const host = req.host;
      const redirectUri = `${protocol}://${host}/v1/auth/oidc/callback`;
      const authUrl = this.getAuthorizationUrl(redirectUri, state, verifier);
      return reply.redirect(authUrl, 302);
    });

    // GET /v1/auth/oidc/callback — exchange code, set session cookie
    app.get<{
      Querystring: { code?: string; state?: string; error?: string };
    }>('/v1/auth/oidc/callback', async (req, reply) => {
      const { code, state, error } = req.query;

      if (error) {
        return reply.status(400).send({ error: `OIDC authorization failed: ${error}` });
      }

      if (!code || !state) {
        return reply.status(400).send({ error: 'Missing code or state parameter' });
      }

      const pending = pendingStates.get(state);
      if (!pending || Date.now() > pending.expiresAt) {
        pendingStates.delete(state);
        return reply.status(400).send({ error: 'Invalid or expired OAuth state' });
      }
      pendingStates.delete(state);

      const protocol = req.protocol;
      const host = req.host;
      const redirectUri = `${protocol}://${host}/v1/auth/oidc/callback`;

      try {
        const user = await this.handleCallback(redirectUri, code, state, pending.verifier);
        this.setSessionCookie(reply, user);
        return reply.redirect('/dashboard', 302);
      } catch (err) {
        console.error('OIDC callback error:', err);
        return reply.status(500).send({ error: 'OIDC authentication failed' });
      }
    });

    // GET /v1/auth/oidc/logout — clear session cookie
    app.get('/v1/auth/oidc/logout', async (_req, reply) => {
      this.clearSessionCookie(reply);
      return reply.redirect('/dashboard', 302);
    });
  }
}
