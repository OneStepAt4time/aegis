/**
 * commands/read.ts — `ag read <id>` — Read session output.
 *
 * Wraps GET /v1/sessions/:id/read with optional pagination.
 * Issue #3565: Handle both legacy msg.content and ParsedEntry msg.text fields.
 * Issue #3633: Support prefix matching for session IDs (8+ chars).
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

/**
 * Resolve a possibly-truncated session ID to a full UUID.
 * If the ID looks like a full UUID, return it as-is.
 * Otherwise, fetch the session list and find a unique match.
 */
async function resolveSessionId(sessionId: string, baseUrl: string, headers: Record<string, string>, io: CliIO): Promise<string | null> {
  // Full UUID — no resolution needed
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return sessionId;
  }

  // Prefix match — fetch sessions and find unique match
  const prefix = sessionId.toLowerCase();
  if (prefix.length < 1) {
    writeLine(io.stderr, '  ❌ Session ID prefix too short.');
    return null;
  }

  const res = await fetch(`${baseUrl}/v1/sessions`, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    writeLine(io.stderr, '  ❌ Failed to fetch session list for prefix matching.');
    return null;
  }

  const body = await res.json() as { sessions?: Array<{ id: string }>; data?: Array<{ id: string }> };
  const sessions = body.sessions ?? body.data ?? [];
  const matches = sessions.filter(s => s.id.toLowerCase().startsWith(prefix));

  if (matches.length === 0) {
    writeLine(io.stderr, `  ❌ No session found matching prefix "${sessionId}".`);
    writeLine(io.stderr, '  Tip: use `ag list` to see available sessions.');
    return null;
  }

  if (matches.length > 1) {
    writeLine(io.stderr, `  ❌ Ambiguous prefix "${sessionId}" — matches ${matches.length} sessions:`);
    for (const m of matches.slice(0, 5)) {
      writeLine(io.stderr, `    ${m.id.slice(0, 8)}…  ${m.id}`);
    }
    return null;
  }

  return matches[0]!.id;
}

export async function handleRead(args: string[], io: CliIO): Promise<number> {
  const sessionId = args.find(a => !a.startsWith('-'));
  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Missing session ID. Usage: ag read <session-id>');
    return 1;
  }

  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);

  // Issue #3633: Resolve prefix to full UUID
  const resolvedId = await resolveSessionId(sessionId, baseUrl, headers, io);
  if (!resolvedId) return 1;

  // Parse optional flags
  let page = 1;
  let limit = 200;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--page' && args[i + 1]) page = parseInt(args[++i]!, 10) || 1;
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i]!, 10) || 200;
  }

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const res = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/read?${params}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  const body = await res.json() as { messages?: any[]; data?: any[]; page?: number; totalPages?: number };
  const messages = body.messages ?? body.data ?? [];

  if (messages.length === 0) {
    writeLine(io.stdout, '  No messages yet.');
    return 0;
  }

  for (const msg of messages) {
    const role = msg.role ?? 'unknown';
    // #3565: /read returns ParsedEntry { text } not { content }.
    // Handle both formats with null safety.
    const raw = msg.text ?? msg.content;
    const content = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '') ?? '';
    const prefix = role === 'assistant' ? '🤖' : role === 'user' ? '👤' : '⚙️';
    // Truncate long messages for terminal readability
    const lines = content.split('\n');
    const displayLines = lines.slice(0, 50);
    for (const line of displayLines) {
      writeLine(io.stdout, `  ${prefix} ${line}`);
    }
    if (lines.length > 50) {
      writeLine(io.stdout, `  ${prefix} ... (${lines.length - 50} more lines)`);
    }
  }

  if (body.totalPages && body.page && body.totalPages > body.page) {
    writeLine(io.stdout, `\n  Page ${body.page}/${body.totalPages}. Use --page ${body.page + 1} for more.`);
  }

  return 0;
}
