/**
 * api/sse.ts — Server-Sent Events subscriptions.
 */

import type { GlobalSSEEvent } from '../types';
import { GlobalSSEEventSchema } from './schemas';
import { logger } from '../utils/logger';
import { ResilientEventSource } from './resilient-eventsource';
import { createSSEToken } from './auth';

// #408: Retry SSE token creation with exponential backoff instead of
// falling back to the long-lived bearer token, which defeats short-lived token security.
const SSE_TOKEN_MAX_RETRIES = 3;
const SSE_TOKEN_BASE_DELAY_MS = 1000;

async function createSSETokenWithRetry(
  onGiveUp?: () => void,
  signal?: AbortSignal,
): Promise<import('./auth').SSETokenResponse> {
  for (let attempt = 0; attempt < SSE_TOKEN_MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await createSSEToken(signal);
    } catch { /* SSE token creation failed — retry with backoff */
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt < SSE_TOKEN_MAX_RETRIES - 1) {
        const delay = SSE_TOKEN_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve(undefined);
          }, { once: true });
        });
      }
    }
  }
  onGiveUp?.();
  throw new Error('Real-time updates unavailable');
}

/**
 * Subscribe to Server-Sent Events for a session.
 * Returns an unsubscribe function.
 *
 * #408: If a bearer token is provided, fetches a short-lived SSE token first
 * to avoid exposing the long-lived bearer token in the URL query parameter.
 * Retries SSE token creation with exponential backoff on failure.
 * If all retries fail, real-time updates are unavailable (no bearer fallback).
 */
export function subscribeSSE(
  sessionId: string,
  handler: (event: MessageEvent) => void,
  token?: string | null,
  callbacks?: { onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void; onOpen?: () => void; onClose?: () => void },
): () => void {
  const basePath = `/v1/sessions/${encodeURIComponent(sessionId)}/events`;

  let resilient: ResilientEventSource | null = null;
  let closed = false;
  const abortController = new AbortController();

  if (token) {
    // #408: Retry SSE token creation — never fall back to bearer token
    createSSETokenWithRetry(callbacks?.onGiveUp, abortController.signal)
      .then((sseToken) => {
        if (closed) return;
        const url = `${basePath}?token=${encodeURIComponent(sseToken.token)}`;
        resilient = new ResilientEventSource(url, handler, callbacks);
      })
      .catch(() => {
        // All retries exhausted or aborted — do NOT fall back to bearer token (#408)
      });
  } else {
    // No auth needed
    resilient = new ResilientEventSource(basePath, handler, callbacks);
  }

  return () => {
    closed = true;
    abortController.abort();
    resilient?.close();
  };
}

/**
 * Subscribe to global SSE events (all sessions).
 * Returns an unsubscribe function.
 *
 * #408: If a bearer token is provided, fetches a short-lived SSE token first
 * to avoid exposing the long-lived bearer token in the URL query parameter.
 * Retries SSE token creation with exponential backoff on failure.
 * If all retries fail, real-time updates are unavailable (no bearer fallback).
 */
export function subscribeGlobalSSE(
  handler: (event: GlobalSSEEvent) => void,
  token?: string | null,
  callbacks?: { onOpen?: () => void; onClose?: () => void; onReconnecting?: (attempt: number, delay: number) => void; onGiveUp?: () => void },
): () => void {
  const basePath = '/v1/events';

  let resilient: ResilientEventSource | null = null;
  let closed = false;
  const abortController = new AbortController();

  const wrappedHandler = (e: MessageEvent) => {
    try {
      const result = GlobalSSEEventSchema.safeParse(JSON.parse(e.data as string));
      if (!result.success) {
        logger.warn('sse', 'Global SSE event failed validation', result.error.message);
        return;
      }
      handler(result.data as GlobalSSEEvent);
    } catch {
      // ignore malformed events
    }
  };

  if (token) {
    // #408: Retry SSE token creation — never fall back to bearer token
    createSSETokenWithRetry(callbacks?.onGiveUp, abortController.signal)
      .then((sseToken) => {
        if (closed) return;
        const url = `${basePath}?token=${encodeURIComponent(sseToken.token)}`;
        resilient = new ResilientEventSource(url, wrappedHandler, callbacks);
      })
      .catch(() => {
        // All retries exhausted or aborted — do NOT fall back to bearer token (#408)
      });
  } else {
    resilient = new ResilientEventSource(basePath, wrappedHandler, callbacks);
  }

  return () => {
    closed = true;
    abortController.abort();
    callbacks?.onClose?.();
    resilient?.close();
  };
}
