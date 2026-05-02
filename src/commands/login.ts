/**
 * commands/login.ts — `ag login` CLI command.
 *
 * Implements the OAuth2 device authorization grant (RFC 8628) for the CLI.
 * The CLI talks directly to the IdP — no Aegis server required.
 */


import {
  parseOidcConfig,
  discoverOidcEndpoints,
  mergeDiscovery,
  type OidcConfig,
} from '../services/auth/oidc-config.js';
import {
  readAuthStore,
  setStoredAuth,
  type StoredAuth,
} from '../services/auth/token-store.js';

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

// ── RFC 8628 Device Flow ────────────────────────────────────────────

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Request device authorization from the IdP. */
async function requestDeviceAuthorization(
  config: OidcConfig,
  fetchFn: typeof fetch = fetch,
): Promise<DeviceAuthResponse> {
  if (!config.deviceAuthorizationEndpoint) {
    throw new Error('IdP does not support device authorization flow. No device_authorization_endpoint found in discovery document.');
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes,
  });

  const response = await fetchFn(config.deviceAuthorizationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  const data = await response.json() as DeviceAuthResponse;

  if (!response.ok) {
    const errData = data as unknown as { error?: string; error_description?: string };
    throw new Error(`Device authorization failed: ${errData.error || response.statusText}${errData.error_description ? ` — ${errData.error_description}` : ''}`);
  }

  return data;
}

/** Poll the IdP token endpoint until the user completes browser auth. */
async function pollForToken(
  config: OidcConfig,
  deviceCode: string,
  interval: number,
  expiresInSeconds: number,
  fetchFn: typeof fetch = fetch,
): Promise<TokenResponse> {
  const maxElapsed = Math.min(expiresInSeconds, 900) * 1000;
  const startTime = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxElapsed) {
      throw new Error('Device code expired. Run ag login again.');
    }

    // Wait before polling
    await new Promise(resolve => setTimeout(resolve, interval * 1000));

    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant-type:device_code',
      device_code: deviceCode,
      client_id: config.clientId,
    });

    const response = await fetchFn(config.tokenEndpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json() as TokenResponse;

    if (!data.error) {
      return data;
    }

    switch (data.error) {
      case 'authorization_pending':
        // Normal — user hasn't completed auth yet. Keep polling.
        break;
      case 'slow_down':
        // RFC 8628 §3.5: Increase interval by 5s
        interval += 5;
        break;
      case 'expired_token':
        throw new Error('Device code expired. Run ag login again.');
      case 'access_denied':
        throw new Error('Authorization denied by user.');
      default:
        throw new Error(`Token error: ${data.error}${data.error_description ? ` — ${data.error_description}` : ''}`);
    }
  }
}

/** Parse id_token JWT payload (without verification — verification happens server-side). */
function parseIdTokenPayload(idToken: string): { sub: string; email?: string; name?: string; [key: string]: unknown } {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid id_token format');
  const payload = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
  return JSON.parse(payload) as { sub: string; email?: string; name?: string; [key: string]: unknown };
}

/** Extract role from id_token claims using the configured role claim. */
function extractRole(claims: Record<string, unknown>, roleClaim: string): string {
  const value = claims[roleClaim];
  if (typeof value === 'string' && ['admin', 'operator', 'viewer'].includes(value)) {
    return value;
  }
  return 'viewer';
}

/** Derive the server origin from a base URL string. */
function deriveServerOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return url.origin;
  } catch {
    return baseUrl;
  }
}

// ── Command Handler ─────────────────────────────────────────────────

export async function handleLogin(args: string[], io: CliIO, fetchFn: typeof fetch = fetch): Promise<number> {
  // Parse flags
  let serverUrl = '';
  let noOpen = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) {
      serverUrl = args[++i]!;
    } else if (args[i] === '--no-open') {
      noOpen = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  // 1. Read OIDC config
  let config: OidcConfig;
  try {
    const parsed = parseOidcConfig();
    if (!parsed) {
      if (jsonOutput) {
        writeLine(io.stdout, JSON.stringify({ error: 'OIDC not configured', code: 'CONFIG_ERROR' }));
      } else {
        writeLine(io.stderr, '  OIDC is not configured.');
        writeLine(io.stderr, '  Set AEGIS_OIDC_ISSUER and AEGIS_OIDC_CLIENT_ID environment variables.');
      }
      return 2;
    }
    config = parsed;
  } catch (e: unknown) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: 'CONFIG_ERROR' }));
    } else {
      writeLine(io.stderr, `  Configuration error: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 2;
  }

  // 2. Discover IdP endpoints
  if (!jsonOutput) {
    writeLine(io.stdout, `  Authenticating via ${config.issuer}...`);
  }

  try {
    const discovery = await discoverOidcEndpoints(config.issuer, fetchFn);
    config = mergeDiscovery(config, discovery);
  } catch (e: unknown) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: 'DISCOVERY_FAILED' }));
    } else {
      writeLine(io.stderr, `  OIDC discovery failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  }

  if (!config.deviceAuthorizationEndpoint) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: 'IdP does not support device authorization flow', code: 'UNSUPPORTED_FLOW' }));
    } else {
      writeLine(io.stderr, '  Your IdP does not support the device authorization flow.');
      writeLine(io.stderr, '  Use API keys instead (AEGIS_AUTH_TOKEN).');
    }
    return 1;
  }

  // 3. Request device authorization
  let deviceAuth: DeviceAuthResponse;
  try {
    deviceAuth = await requestDeviceAuthorization(config, fetchFn);
  } catch (e: unknown) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: 'DEVICE_AUTH_FAILED' }));
    } else {
      writeLine(io.stderr, `  Device authorization failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  }

  // 4. Display verification URI and user code
  const verificationUrl = deviceAuth.verification_uri_complete || deviceAuth.verification_uri;
  const userCode = deviceAuth.user_code;

  if (!jsonOutput) {
    writeLine(io.stdout);
    writeLine(io.stdout, '  To authenticate, visit:');
    writeLine(io.stdout, `    ${verificationUrl}`);
    writeLine(io.stdout);
    writeLine(io.stdout, `  Enter code:  ${userCode}`);
    writeLine(io.stdout);
    writeLine(io.stdout, '  Waiting for authorization...');

    // Try to open browser (best-effort, silently ignore failure)
    if (!noOpen && deviceAuth.verification_uri_complete) {
      try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error — 'open' is an optional dependency
        const { default: open } = await import('open');
        await open(deviceAuth.verification_uri_complete);
      } catch {
        // open package not available or browser launch failed — user can copy URL manually
      }
    }
  }

  // 5. Poll for token
  let tokenResponse: TokenResponse;
  try {
    const pollInterval = deviceAuth.interval ?? 5;
    tokenResponse = await pollForToken(config, deviceAuth.device_code, pollInterval, deviceAuth.expires_in, fetchFn);
  } catch (e: unknown) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: 'TOKEN_POLL_FAILED' }));
    } else {
      writeLine(io.stderr, `  ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  }

  // 6. Validate id_token and extract identity
  if (!tokenResponse.id_token || !tokenResponse.access_token) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: 'Token response missing id_token or access_token', code: 'INVALID_TOKEN_RESPONSE' }));
    } else {
      writeLine(io.stderr, '  Token response is missing required fields.');
    }
    return 1;
  }

  let claims: Record<string, unknown>;
  try {
    claims = parseIdTokenPayload(tokenResponse.id_token);
  } catch {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: 'Failed to parse id_token', code: 'INVALID_ID_TOKEN' }));
    } else {
      writeLine(io.stderr, '  Received an invalid id_token from the IdP.');
    }
    return 1;
  }

  const role = extractRole(claims, config.roleClaim);
  const identity = {
    sub: claims.sub as string,
    email: claims.email as string | undefined,
    name: claims.name as string | undefined,
  };

  // 7. Store tokens
  const serverOrigin = serverUrl ? deriveServerOrigin(serverUrl) : 'cli-local';
  const expiresIn = tokenResponse.expires_in ?? 3600;
  const storedAuth: StoredAuth = {
    idp: config.issuer,
    identity,
    tokens: {
      access: tokenResponse.access_token,
      refresh: tokenResponse.refresh_token ?? '',
      id_token: tokenResponse.id_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      scope: tokenResponse.scope ?? config.scopes,
    },
    role,
    obtained_at: new Date().toISOString(),
  };

  try {
    await setStoredAuth(serverOrigin, storedAuth, config.authDir || undefined);
  } catch (e: unknown) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: `Failed to store tokens: ${e instanceof Error ? e.message : String(e)}`, code: 'STORAGE_FAILED' }));
    } else {
      writeLine(io.stderr, `  Failed to store tokens: ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  }

  // 8. Print confirmation
  const displayIdentity = identity.email || identity.name || identity.sub;
  if (jsonOutput) {
    writeLine(io.stdout, JSON.stringify({
      identity,
      role,
      server: serverOrigin,
      expires_in: expiresIn,
    }));
  } else {
    writeLine(io.stdout, `  Logged in as ${displayIdentity} (${role})`);
  }

  return 0;
}
