/**
 * commands/tail.ts — `ag tail <id>` — Follow session output in real-time.
 *
 * Connects to GET /v1/sessions/:id/events SSE stream and prints events.
 */

import { resolveBaseUrl, resolveAuthToken, buildHeaders, requireServer, writeLine, type CliIO } from '../cli-http.js';

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

  // Use SIGINT-wired AbortController instead of fixed timeout.
  // tail is meant to follow long-running sessions until the user hits Ctrl+C.
  const abortController = new AbortController();
  const onSigInt = () => {
    abortController.abort();
    writeLine(io.stdout, '\n  Stopped.');
  };
  process.once('SIGINT', onSigInt);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/sessions/${sessionId}/events`, {
      headers,
      signal: abortController.signal,
    });
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') return 0;
    throw e;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    writeLine(io.stderr, `  ❌ ${((err as { error?: string }).error) || res.statusText}`);
    return 1;
  }

  if (!res.body) {
    writeLine(io.stderr, '  ❌ No response body — SSE not supported.');
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
    process.removeListener('SIGINT', onSigInt);
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
