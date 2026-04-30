/**
 * commands/whoami.ts — `ag whoami` CLI command.
 *
 * Reads stored tokens, refreshes if expired, prints identity and role.
 */

import {
  readAuthStore,
  setStoredAuth,
  type StoredAuth,
} from '../services/auth/token-store.js';
import { parseOidcConfig, discoverOidcEndpoints, mergeDiscovery, type OidcConfig } from '../services/auth/oidc-config.js';

interface CliIO {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

function writeLine(stream: NodeJS.WritableStream, text: string = ''): void {
  stream.write(`${text}\n`);
}

/** Attempt to refresh an expired access token. */
async function refreshToken(
  auth: StoredAuth,
  config: OidcConfig,
  fetchFn: typeof fetch,
): Promise<StoredAuth> {
  if (!auth.tokens.refresh) {
    throw new Error('No refresh token available. Run ag login again.');
  }

  // Ensure we have the token endpoint
  let cfg = config;
  if (!cfg.tokenEndpoint) {
    const discovery = await discoverOidcEndpoints(cfg.issuer, fetchFn);
    cfg = mergeDiscovery(cfg, discovery);
  }

  if (!cfg.tokenEndpoint) {
    throw new Error('Cannot discover token endpoint for refresh.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.tokens.refresh,
    client_id: cfg.clientId,
  });

  const response = await fetchFn(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  const data = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error || !response.ok) {
    throw new Error(data.error_description || data.error || 'Token refresh failed');
  }

  // Update stored auth with new tokens
  const expiresIn = data.expires_in ?? 3600;
  const updated: StoredAuth = {
    ...auth,
    tokens: {
      access: data.access_token ?? auth.tokens.access,
      refresh: data.refresh_token ?? auth.tokens.refresh,
      id_token: data.id_token ?? auth.tokens.id_token,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      scope: data.scope ?? auth.tokens.scope,
    },
  };

  return updated;
}

/** Format remaining time in human-readable form. */
function formatExpiresIn(expiresAt: number): string {
  const remaining = expiresAt - Math.floor(Date.now() / 1000);
  if (remaining <= 0) return 'expired';
  if (remaining < 60) return `${remaining}s`;
  if (remaining < 3600) return `${Math.floor(remaining / 60)}m`;
  return `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`;
}

export async function handleWhoami(args: string[], io: CliIO, fetchFn: typeof fetch = fetch): Promise<number> {
  let serverUrl = '';
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) {
      serverUrl = args[++i]!;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  const store = await readAuthStore();
  const entries = Object.entries(store);

  if (entries.length === 0) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: 'Not logged in', code: 'NOT_LOGGED_IN' }));
    } else {
      writeLine(io.stdout, '  Not logged in. Run ag login first.');
    }
    return 1;
  }

  // Determine which server to show
  let serverOrigin: string;
  if (serverUrl) {
    try {
      serverOrigin = new URL(serverUrl).origin;
    } catch {
      serverOrigin = serverUrl;
    }
  } else if (entries.length === 1) {
    serverOrigin = entries[0]![0];
  } else {
    // Multiple servers — show all
    if (jsonOutput) {
      const result: Record<string, unknown> = {};
      for (const [origin, auth] of entries) {
        const identity = auth.identity.email || auth.identity.sub;
        result[origin] = { identity, role: auth.role, expires: formatExpiresIn(auth.tokens.expires_at) };
      }
      writeLine(io.stdout, JSON.stringify(result));
    } else {
      for (const [origin, auth] of entries) {
        const identity = auth.identity.email || auth.identity.sub;
        writeLine(io.stdout, `  ${identity}  ${auth.role}  (expires in ${formatExpiresIn(auth.tokens.expires_at)})  [${origin}]`);
      }
    }
    return 0;
  }

  const auth = store[serverOrigin];
  if (!auth) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: 'Not logged in to this server', server: serverOrigin }));
    } else {
      writeLine(io.stdout, `  Not logged in to ${serverOrigin}.`);
    }
    return 1;
  }

  // Check if token is expired — try refresh
  const now = Math.floor(Date.now() / 1000);
  let currentAuth = auth;
  if (auth.tokens.expires_at <= now && auth.tokens.refresh) {
    const config = parseOidcConfig();
    if (config) {
      try {
        currentAuth = await refreshToken(auth, config, fetchFn);
        // Persist refreshed tokens
        await setStoredAuth(serverOrigin, currentAuth);
      } catch {
        // Refresh failed — remove stale entry and report
        if (jsonOutput) {
          writeLine(io.stdout, JSON.stringify({ error: 'Token expired and refresh failed. Run ag login again.', code: 'REFRESH_FAILED' }));
        } else {
          writeLine(io.stderr, '  Token expired and refresh failed. Run ag login again.');
        }
        return 1;
      }
    }
  }

  const identity = currentAuth.identity.email || currentAuth.identity.name || currentAuth.identity.sub;
  const expires = formatExpiresIn(currentAuth.tokens.expires_at);

  if (jsonOutput) {
    writeLine(io.stdout, JSON.stringify({
      identity: currentAuth.identity,
      role: currentAuth.role,
      server: serverOrigin,
      idp: currentAuth.idp,
      expires_at: currentAuth.tokens.expires_at,
      expires_in: expires,
    }));
  } else {
    writeLine(io.stdout, `  ${identity}  ${currentAuth.role}  (token expires in ${expires})`);
  }

  return 0;
}
