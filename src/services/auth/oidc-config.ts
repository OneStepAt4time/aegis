/**
 * oidc-config.ts — OIDC configuration parsing for device flow and dashboard SSO.
 *
 * Reads AEGIS_OIDC_* env vars, validates them, and exports a typed config object.
 * Shared between CLI device flow (#1943) and dashboard SSO (#1942).
 */

/** Validated OIDC configuration. */
export interface OidcConfig {
  /** IdP issuer URL (e.g. https://login.microsoftonline.com/tenant-id/v2.0). */
  issuer: string;
  /** OAuth2 client ID registered with the IdP (public client for device flow). */
  clientId: string;
  /** Expected audience for tokens (defaults to clientId). */
  audience: string;
  /** Space-separated scopes (defaults to "openid profile email"). */
  scopes: string;
  /** Claim name for role mapping (default: "aegis_role"). */
  roleClaim: string;
  /** Directory for auth.json (defaults to ~/.aegis/). */
  authDir: string;
  /** Device authorization endpoint (discovered from .well-known, optional). */
  deviceAuthorizationEndpoint?: string;
  /** Token endpoint (discovered from .well-known, optional). */
  tokenEndpoint?: string;
  /** Revocation endpoint (discovered from .well-known, optional). */
  revocationEndpoint?: string;
  /** JWKS URI (discovered from .well-known, optional). */
  jwksUri?: string;
}

/** Parse AEGIS_OIDC_* environment variables into a validated config object.
 *  Returns null if required fields are missing (OIDC not configured). */
export function parseOidcConfig(env: Record<string, string | undefined> = process.env): OidcConfig | null {
  const issuer = env.AEGIS_OIDC_ISSUER?.trim();
  const clientId = env.AEGIS_OIDC_CLIENT_ID?.trim();

  if (!issuer || !clientId) return null;

  // Basic URL validation
  try {
    const url = new URL(issuer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw new Error(`AEGIS_OIDC_ISSUER is not a valid URL: ${issuer}`);
  }

  return {
    issuer,
    clientId,
    audience: env.AEGIS_OIDC_AUDIENCE?.trim() || clientId,
    scopes: env.AEGIS_OIDC_SCOPES?.trim() || 'openid profile email',
    roleClaim: env.AEGIS_OIDC_ROLE_CLAIM?.trim() || 'aegis_role',
    authDir: env.AEGIS_AUTH_DIR?.trim() || '',
  };
}

/** OIDC discovery document structure (subset of fields we need). */
export interface OidcDiscovery {
  issuer: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  revocation_endpoint?: string;
  jwks_uri?: string;
  token_endpoint_auth_methods_supported?: string[];
  response_types_supported?: string[];
}

/** Fetch and parse the OIDC discovery document from the IdP.
 *  Caches the result in the returned config object. */
export async function discoverOidcEndpoints(
  issuer: string,
  fetchFn: typeof fetch = fetch,
): Promise<OidcDiscovery> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetchFn(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`OIDC discovery failed: ${response.status} ${response.statusText} (${url})`);
  }

  const doc = await response.json() as OidcDiscovery;

  // Validate issuer matches configured value (RFC 8414 §3.1, ADR-0026)
  const normalizedIssuer = issuer.replace(/\/$/, '');
  if (doc.issuer !== normalizedIssuer && doc.issuer !== `${normalizedIssuer}/`) {
    throw new Error(`OIDC issuer mismatch: configured ${issuer} but discovery returned ${doc.issuer}`);
  }

  // Validate required fields
  if (!doc.token_endpoint) {
    throw new Error('OIDC discovery document missing required field: token_endpoint');
  }

  return doc;
}

/** Merge discovered endpoints into an OidcConfig. */
export function mergeDiscovery(config: OidcConfig, discovery: OidcDiscovery): OidcConfig {
  return {
    ...config,
    deviceAuthorizationEndpoint: discovery.device_authorization_endpoint,
    tokenEndpoint: discovery.token_endpoint,
    revocationEndpoint: discovery.revocation_endpoint,
    jwksUri: discovery.jwks_uri,
  };
}
