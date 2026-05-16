/**
 * commands/tail.ts — `ag tail <id>` — Follow session output in real-time.
 *
 * Connects to GET /v1/sessions/:id/events SSE stream and prints events.
 * Uses SIGINT on Unix and a readline keypress fallback on Windows for Ctrl+C.
 * Includes a 30-minute max-duration safeguard so the process never hangs forever.
 *
 * #3566: On SSE routes, the server requires short-lived SSE tokens (prefixed `sse_`).
 * If the initial SSE request returns 401, the CLI fetches an SSE token via
 * POST /v1/auth/sse-token and reconnects with ?token=<sse-token>.
 */

import { platform } from 'node:os';
import * as readline from 'node:readline';
import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

/** Maximum tail duration before auto-disconnect (30 minutes). */
const MAX_TAIL_DURATION_MS = 30 * 60 * 1000;

/**
 * #3566: Fetch a short-lived SSE token from the server.
 * The caller must provide a valid bearer token (already authenticated).
 * Returns the SSE token string, or null if the request fails.
 */
async function fetchSSEToken(
  baseUrl: string,
  bearerToken: string,
  signal?: AbortSignal,
): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const res = await fetch(`${baseUrl}/v1/auth/sse-token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      signal,
    });
    if (!res.ok) {
      return null;
    }
    return await res.json() as { token: string; expiresAt: number };
  } catch {
    return null;
  }
}

export async function handleTail(args: string[], io: CliIO): Promise<number> {
  const sessionId = args.find(a => !a.startsWith('-'));
  if (!sessionId) {
    writeLine(io.stderr, '  ❌ Missing session ID. Usage: ag tail <session-id>');
    return 1;
  }

  const baseUrl = await resolveBaseUrl(args);
  const authToken = await resolveAuthToken();
  if (!(await requireServer(baseUrl, authToken, io))) return 1;

  const headers = buildHeaders(authToken);
  headers['Accept'] = 'text/event-stream';

  writeLine(io.stdout, `  Tailing session ${sessionId.slice(0, 8)}… (Ctrl+C to stop)`);

  const abortController = new AbortController();
  const onSigInt = () => {
    abortController.abort();
    writeLine(io.stdout, '\n  Stopped.');
  };

  // Platform-specific Ctrl+C handling.
  // On Windows, SIGINT is not reliably delivered — use readline keypress as fallback.
  let keypressCleanup: (() => void) | null = null;

  if (platform() === 'win32') {
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isRaw !== undefined) {
        const prevRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        const onKeypress = (_str: string, key: { ctrl?: boolean; name?: string }) => {
          if (key.ctrl && key.name === 'c') {
            onSigInt();
          }
        };
        process.stdin.on('keypress', onKeypress);
        keypressCleanup = () => {
          process.stdin.removeListener('keypress', onKeypress);
          process.stdin.setRawMode(prevRaw);
        };
      }
    }
    // Also register SIGINT as a secondary mechanism on Windows (works in some terminals)
    process.once('SIGINT', onSigInt);
  } else {
    process.once('SIGINT', onSigInt);
  }

  // 30-minute max-duration safeguard — ensures the process never hangs forever.
  const maxDurationTimer = setTimeout(() => {
    if (!abortController.signal.aborted) {
      abortController.abort();
      writeLine(io.stdout, '\n  ⏱  Stopped — maximum tail duration reached (30 min).');
    }
  }, MAX_TAIL_DURATION_MS);
  // Don't prevent Node.js from exiting naturally.
  maxDurationTimer.unref();

  // #3566: Build SSE URL — optionally includes ?token= for SSE-token auth.
  let sseUrl = `${baseUrl}/v1/sessions/${sessionId}/events`;
  let usedSSEToken = false;

  let res: Response;
  try {
    res = await fetch(sseUrl, {
      headers,
      signal: abortController.signal,
    });
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      clearTimeout(maxDurationTimer);
      return 0;
    }
    throw e;
  }

  // #3566: If 401 and we haven't tried SSE token yet, fetch one and retry.
  if (res.status === 401 && !usedSSEToken && authToken) {
    writeLine(io.stdout, '  🔑 SSE token required — fetching…');

    const sseTokenResult = await fetchSSEToken(baseUrl, authToken, abortController.signal);
    if (!sseTokenResult) {
      writeLine(io.stderr, '  ❌ Failed to obtain SSE token — your bearer token may be invalid or expired.');
      writeLine(io.stderr, '     Run `ag login` to refresh your credentials.');
      clearTimeout(maxDurationTimer);
      process.removeListener('SIGINT', onSigInt);
      keypressCleanup?.();
      return 1;
    }

    // Reconnect with ?token=<sse-token> query param
    sseUrl = `${baseUrl}/v1/sessions/${sessionId}/events?token=${encodeURIComponent(sseTokenResult.token)}`;
    usedSSEToken = true;

    try {
      res = await fetch(sseUrl, {
        headers: { 'Accept': 'text/event-stream' },
        signal: abortController.signal,
      });
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') {
        clearTimeout(maxDurationTimer);
        return 0;
      }
      throw e;
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errMsg = ((err as { error?: string }).error) || res.statusText;

    // #3566: Surface specific guidance for SSE-related 401 errors
    if (res.status === 401) {
      writeLine(io.stderr, `  ❌ Unauthorized — ${errMsg}`);
      writeLine(io.stderr, '     SSE token authentication failed. Run `ag login` to refresh credentials.');
    } else {
      writeLine(io.stderr, `  ❌ ${errMsg}`);
    }
    clearTimeout(maxDurationTimer);
    process.removeListener('SIGINT', onSigInt);
    keypressCleanup?.();
    return 1;
  }

  if (!res.body) {
    writeLine(io.stderr, '  ❌ No response body — SSE not supported.');
    clearTimeout(maxDurationTimer);
    process.removeListener('SIGINT', onSigInt);
    keypressCleanup?.();
    return 1;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const event = JSON.parse(data);
            printEvent(event, io);
          } catch {
            writeLine(io.stdout, `  ${data}`);
          }
        }
      }
    }
  } catch (e: unknown) {
    if ((e as Error).name !== 'AbortError') {
      writeLine(io.stderr, `  Connection closed.`);
    }
  } finally {
    clearTimeout(maxDurationTimer);
    process.removeListener('SIGINT', onSigInt);
    keypressCleanup?.();
  }

  return 0;
}

function printEvent(event: Record<string, any>, io: CliIO): void {
  const type = event.type ?? event.event ?? 'message';

  if (type === 'assistant' || type === 'message') {
    const content = event.content ?? event.text ?? event.delta ?? '';
    if (content) writeLine(io.stdout, `  🤖 ${content}`);
  } else if (type === 'tool_use' || type === 'tool_result') {
    const name = event.name ?? event.toolName ?? 'tool';
    writeLine(io.stdout, `  🔧 ${type}: ${name}`);
  } else if (type === 'thinking') {
    writeLine(io.stdout, `  💭 thinking...`);
  } else if (type === 'error') {
    writeLine(io.stderr, `  ❌ ${event.message ?? event.error ?? 'error'}`);
  } else {
    // Generic — show type and any text
    const text = event.text ?? event.content ?? event.message;
    if (text) writeLine(io.stdout, `  [${type}] ${text}`);
  }
}
