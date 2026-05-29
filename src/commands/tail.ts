/**
 * commands/tail.ts — `ag tail <id>` — Follow session output in real-time.
 *
 * Connects to GET /v1/sessions/:id/events SSE stream and prints events.
 * Issue #3566: SSE endpoints require short-lived sse_ tokens.
 * The CLI first obtains an SSE token via POST /v1/auth/sse-token, then connects.
 * Issue #3672: Support prefix matching for session IDs via resolveSessionId.
 * Issue #4461: Check session status before SSE connect; improve error messages.
 *
 * Uses SIGINT on Unix and a readline keypress fallback on Windows for Ctrl+C.
 * Includes a 30-minute max-duration safeguard so the process never hangs forever.
 */

import { platform } from 'node:os';
import * as readline from 'node:readline';
import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';
import { resolveSessionId } from './read.js';

/** Maximum tail duration before auto-disconnect (30 minutes). */
const MAX_TAIL_DURATION_MS = 30 * 60 * 1000;

/**
 * Issue #3566: Obtain a short-lived SSE token via POST /v1/auth/sse-token.
 * SSE endpoints reject long-lived bearer tokens — only sse_ prefixed tokens are accepted.
 */
async function obtainSSEToken(baseUrl: string, authToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/v1/auth/sse-token`, {
      method: 'POST',
      headers: buildHeaders(authToken),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const body = await res.json() as { token?: string };
    return body.token ?? null;
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

  // Issue #3672: Resolve prefix to full UUID
  const resolvedId = await resolveSessionId(sessionId, baseUrl, headers, io);
  if (!resolvedId) return 1;

  // Issue #4461: Check session status before attempting SSE connection.
  // If the session is in a terminal state, show a clear message instead of
  // a confusing auth error.
  const statusRes = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/status`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  if (statusRes.ok) {
    const statusBody = await statusRes.json() as { status?: string };
    const status = statusBody.status;
    const terminalStates = ['killed', 'error', 'completed', 'failed', 'closed', 'crashed'];
    if (status && terminalStates.includes(status)) {
      writeLine(io.stderr, `  ❌ Session is ${status}. Use \`ag list\` to see active sessions.`);
      return 1;
    }
  }

  // Issue #3566: Obtain SSE token before connecting to the event stream.
  const sseToken = await obtainSSEToken(baseUrl, authToken);
  if (!sseToken) {
    writeLine(io.stderr, '  ❌ Authentication failed — run `ag init` to refresh credentials.');
    return 1;
  }

  const sseHeaders = buildHeaders(sseToken);
  sseHeaders['Accept'] = 'text/event-stream';

  writeLine(io.stdout, `  Tailing session ${resolvedId.slice(0, 8)}… (Ctrl+C to stop)`);

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

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/sessions/${resolvedId}/events`, {
      headers: sseHeaders,
      signal: abortController.signal,
    });
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      clearTimeout(maxDurationTimer);
      return 0;
    }
    throw e;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errMsg = ((err as { error?: string }).error) || res.statusText;
      if (res.status === 401) {
        writeLine(io.stderr, '  ❌ Authentication failed — run `ag init` to refresh credentials.');
      } else {
        writeLine(io.stderr, `  ❌ ${errMsg}`);
      }
    clearTimeout(maxDurationTimer);
    return 1;
  }

  if (!res.body) {
    writeLine(io.stderr, '  ❌ No response body — SSE not supported.');
    clearTimeout(maxDurationTimer);
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
