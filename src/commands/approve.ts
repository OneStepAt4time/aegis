/**
 * commands/approve.ts — `ag approve <id>` — Approve pending permission for a session.
 *
 * Wraps POST /v1/sessions/:id/permission/approve.
 * Issue #4685: Programmatic approval of pending tool calls.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';
import { resolveSessionId } from './read.js';

export async function handleApprove(args: string[], io: CliIO): Promise<number> {
  const sessionId = args.find(a => !a.startsWith('-'));
  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Missing session ID. Usage: ag approve <session-id>');
    return 1;
  }

  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);

  const resolvedId = await resolveSessionId(sessionId, baseUrl, headers, io);
  if (!resolvedId) return 1;

  const res = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/permission/approve`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  writeLine(io.stdout, `  ✅ Approved permission for session ${resolvedId.slice(0, 8)}…`);
  return 0;
}
