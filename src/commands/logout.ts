/**
 * commands/logout.ts — `ag logout` CLI command.
 *
 * Revokes tokens at the IdP (best-effort) and removes stored auth.
 */

import {
  readAuthStore,
  removeStoredAuth,
  deleteAuthStore,
  resolveAuthFilePath,
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

/** Attempt token revocation at the IdP (best-effort, does not block logout). */
async function attemptRevocation(auth: StoredAuth, config: OidcConfig, fetchFn: typeof fetch): Promise<boolean> {
  if (!config.revocationEndpoint) {
    return false;
  }

  try {
    // Revoke refresh token and access token
    for (const token of [auth.tokens.refresh, auth.tokens.access]) {
      if (!token) continue;
      const body = new URLSearchParams({
        token,
        client_id: config.clientId,
        token_type_hint: token === auth.tokens.refresh ? 'refresh_token' : 'access_token',
      });
      await fetchFn(config.revocationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(5_000),
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function handleLogout(args: string[], io: CliIO, fetchFn: typeof fetch = fetch): Promise<number> {
  let serverUrl = '';
  let logoutAll = false;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server' && args[i + 1]) {
      serverUrl = args[++i]!;
    } else if (args[i] === '--all') {
      logoutAll = true;
    } else if (args[i] === '--json') {
      jsonOutput = true;
    }
  }

  // --all: delete the entire auth store
  if (logoutAll) {
    const deleted = await deleteAuthStore();
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ deleted }));
    } else {
      if (deleted) {
        writeLine(io.stdout, '  Logged out from all servers.');
      } else {
        writeLine(io.stdout, '  No stored credentials found.');
      }
    }
    return 0;
  }

  // Derive server origin
  let serverOrigin: string;
  if (serverUrl) {
    try {
      serverOrigin = new URL(serverUrl).origin;
    } catch {
      serverOrigin = serverUrl;
    }
  } else {
    // Default to first stored entry
    const store = await readAuthStore();
    const entries = Object.entries(store);
    if (entries.length === 0) {
      if (jsonOutput) {
        writeLine(io.stdout, JSON.stringify({ error: 'Not logged in', code: 'NOT_LOGGED_IN' }));
      } else {
        writeLine(io.stdout, '  Not logged in.');
      }
      return 1;
    }
    if (entries.length === 1) {
      serverOrigin = entries[0]![0];
    } else {
      // Multiple servers — list them
      if (jsonOutput) {
        writeLine(io.stdout, JSON.stringify({ error: 'Multiple servers found. Use --server or --all.', servers: entries.map(([k]) => k) }));
      } else {
        writeLine(io.stderr, '  Multiple servers found. Specify one with --server <url> or use --all.');
        for (const [origin, auth] of entries) {
          const identity = auth.identity.email || auth.identity.sub;
          writeLine(io.stderr, `    ${origin}  (${identity})`);
        }
      }
      return 1;
    }
  }

  // Read stored auth for this server
  const store = await readAuthStore();
  const auth = store[serverOrigin];
  if (!auth) {
    if (jsonOutput) {
      writeLine(io.stdout, JSON.stringify({ error: 'Not logged in to this server', server: serverOrigin }));
    } else {
      writeLine(io.stdout, `  Not logged in to ${serverOrigin}.`);
    }
    return 1;
  }

  // Attempt revocation at IdP
  let config = parseOidcConfig();
  let revoked = false;
  if (config) {
    // Discover revocation endpoint if not already known
    if (!config.revocationEndpoint) {
      try {
        const discovery = await discoverOidcEndpoints(config.issuer, fetchFn);
        config = mergeDiscovery(config, discovery);
      } catch {
        // Discovery failed — skip revocation
      }
    }
    revoked = await attemptRevocation(auth, config, fetchFn);
  }

  // Remove stored auth
  await removeStoredAuth(serverOrigin);

  const identity = auth.identity.email || auth.identity.name || auth.identity.sub;
  if (jsonOutput) {
    writeLine(io.stdout, JSON.stringify({ loggedOut: true, identity, server: serverOrigin, revoked }));
  } else {
    writeLine(io.stdout, `  Logged out (${identity}).`);
    if (!revoked && config) {
      writeLine(io.stdout, '  Note: IdP does not support token revocation. Tokens may remain valid until expiry.');
    }
  }

  return 0;
}
