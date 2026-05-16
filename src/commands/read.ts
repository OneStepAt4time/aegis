/**
 * commands/read.ts — `ag read <id>` — Read session output.
 *
 * Wraps GET /v1/sessions/:id/read with optional pagination.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

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

  // Parse optional flags
  let page = 1;
  let limit = 200;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--page' && args[i + 1]) page = parseInt(args[++i]!, 10) || 1;
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i]!, 10) || 200;
  }

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/read?${params}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as any).error) || res.statusText}`);
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
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
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
