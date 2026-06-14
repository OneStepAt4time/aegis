/**
 * commands/send.ts — `ag send <id> "message"` — Inject a message into a running session.
 *
 * Wraps POST /v1/sessions/:id/send.
 * Issue #4487: Mid-turn messaging to busy sessions.
 *
 * Usage:
 *   ag send <session-id> "use the other approach"
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';
import { resolveSessionId } from './read.js';

export async function handleSend(args: string[], io: CliIO): Promise<number> {
  // Parse: ag send <session-id> [message...]
  // The session ID is the first positional arg, everything else is the message
  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const sessionId = positionalArgs[0];
  const messageParts = positionalArgs.slice(1);

  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Missing session ID. Usage: ag send <session-id> "message"');
    return 1;
  }

  if (messageParts.length === 0) {
    writeLine(io.stderr, '  ❌ Missing message. Usage: ag send <session-id> "message"');
    return 1;
  }

  const text = messageParts.join(' ');
  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = { ...buildHeaders(authToken), 'Content-Type': 'application/json' };

  // Resolve prefix to full UUID
  const resolvedId = await resolveSessionId(sessionId, baseUrl, headers, io);
  if (!resolvedId) return 1;

  const res = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  const result = await res.json() as { delivered?: boolean; attempts?: number };

  if (result.delivered) {
    writeLine(io.stdout, `  ✅ Message delivered (attempt ${result.attempts})`);
  } else if ((result.attempts ?? 0) === 0) {
    writeLine(io.stdout, `  ✅ Message queued — agent will pick up shortly`);
  } else {
    writeLine(io.stdout, `  ⚠️  Message sent but delivery not confirmed after ${result.attempts} attempts`);
  }

  return 0;
}
