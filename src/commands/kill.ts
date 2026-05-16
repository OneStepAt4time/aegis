/**
 * commands/kill.ts — `ag kill <id>` — Terminate a session.
 *
 * Wraps DELETE /v1/sessions/:id.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

export async function handleKill(args: string[], io: CliIO): Promise<number> {
  const sessionId = args.find(a => !a.startsWith('-'));
  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Missing session ID. Usage: ag kill <session-id>');
    return 1;
  }

  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);
  const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}`, {
    method: 'DELETE',
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  writeLine(io.stdout, `  ✅ Session ${sessionId.slice(0, 8)}… killed.`);
  return 0;
}
