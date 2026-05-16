/**
 * commands/list.ts — `ag list` — List active sessions.
 *
 * Wraps GET /v1/sessions with optional status filter.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

export async function handleList(args: string[], io: CliIO): Promise<number> {
  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);
  const params = new URLSearchParams();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status' && args[i + 1]) {
      params.set('status', args[++i]!);
    }
  }

  const url = `${baseUrl}/v1/sessions${params.toString() ? '?' + params : ''}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  const body = await res.json() as { sessions?: any[]; data?: any[] };
  const sessions = body.sessions ?? body.data ?? [];

  if (sessions.length === 0) {
    writeLine(io.stdout, '  No sessions found.');
    return 0;
  }

  writeLine(io.stdout, `  Sessions (${sessions.length}):`);
  for (const s of sessions) {
    const id = (s.id as string)?.slice(0, 8) ?? "????????";
    const name = s.displayName ?? s.name ?? 'unnamed';
    const status = s.status ?? 'unknown';
    writeLine(io.stdout, `    ${id}…  ${status.padEnd(12)}  ${name}`);
  }
  return 0;
}
