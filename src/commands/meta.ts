/**
 * commands/meta.ts — `ag meta <session-id> [--set key=value ...] [--delete key ...]`
 *
 * Per-session metadata KV store.
 *
 * Usage:
 *   ag meta <session-id>                     — show all metadata
 *   ag meta <session-id> --set key=value      — set one or more keys
 *   ag meta <session-id> --delete key         — remove a key
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';
import { resolveSessionId } from './read.js';

export async function handleMeta(args: string[], io: CliIO): Promise<number> {
  // Parse arguments
  const setIndex = args.indexOf('--set');
  const deleteIndex = args.indexOf('--delete');

  const positionalArgs = args.filter(a => !a.startsWith('--'));
  const setArgs = setIndex >= 0 ? args.slice(setIndex + 1, deleteIndex >= 0 ? deleteIndex : args.length) : [];
  const deleteArgs = deleteIndex >= 0 ? args.slice(deleteIndex + 1) : [];

  const sessionArg = positionalArgs[0];
  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);

  // Resolve session ID (accept short prefixes)
  let sessionId: string | null;
  try {
    sessionId = await resolveSessionId(sessionArg, baseUrl, headers, io);
  } catch {
    writeLine(io.stderr, `  ❌ Could not resolve session: ${sessionArg}`);
    return 1;
  }

  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Could not resolve session ID');
    return 1;
  }

  if (setArgs.length > 0) {
    return handleSet(sessionId, setArgs, baseUrl, headers, io);
  } else if (deleteArgs.length > 0) {
    return handleDelete(sessionId, deleteArgs, baseUrl, headers, io);
  } else {
    return handleGet(sessionId, baseUrl, headers, io);
  }
}

async function handleGet(sessionId: string, baseUrl: string, headers: Record<string, string>, io: CliIO): Promise<number> {
  const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/meta`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    writeLine(io.stderr, `  ❌ Failed to fetch metadata: ${res.statusText}`);
    return 1;
  }

  const data = await res.json() as { metadata: Record<string, string> };
  const meta = data.metadata ?? {};

  if (Object.keys(meta).length === 0) {
    writeLine(io.stdout, `  No metadata for session ${sessionId}`);
    return 0;
  }

  writeLine(io.stdout, `  Metadata for ${sessionId}`);
  writeLine(io.stdout, '  ─────────────────────');
  for (const [key, value] of Object.entries(meta)) {
    writeLine(io.stdout, `  ${key}: ${value}`);
  }
  return 0;
}

async function handleSet(sessionId: string, setArgs: string[], baseUrl: string, headers: Record<string, string>, io: CliIO): Promise<number> {
  const metadata: Record<string, string> = {};
  for (const arg of setArgs) {
    const eqIndex = arg.indexOf('=');
    if (eqIndex < 1 || eqIndex >= arg.length - 1) {
      writeLine(io.stderr, `  ❌ Invalid format: "${arg}" (expected key=value)`);
      return 1;
    }
    const key = arg.slice(0, eqIndex);
    const value = arg.slice(eqIndex + 1);
    metadata[key] = value;
  }

  const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/meta`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.json() as { error?: string } | null;
    writeLine(io.stderr, `  ❌ ${err?.error ?? res.statusText}`);
    return 1;
  }

  writeLine(io.stdout, `  ✅ Set ${Object.keys(metadata).length} key(s) on ${sessionId}`);
  return 0;
}

async function handleDelete(sessionId: string, deleteArgs: string[], baseUrl: string, headers: Record<string, string>, io: CliIO): Promise<number> {
  for (const key of deleteArgs) {
    const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/meta/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.json() as { error?: string } | null;
      writeLine(io.stderr, `  ❌ Delete "${key}": ${err?.error ?? res.statusText}`);
      return 1;
    }

    writeLine(io.stdout, `  ✅ Deleted "${key}"`);
  }
  return 0;
}
