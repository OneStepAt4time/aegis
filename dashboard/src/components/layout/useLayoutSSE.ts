/**
 * layout/useLayoutSSE.ts — Global SSE subscription with retry logic.
 */

import { useEffect, useState } from 'react';
import { logger } from '../../utils/logger';
import { subscribeGlobalSSE } from '../../api/client';
import { useStore } from '../../store/useStore';
import {
  MAX_SSE_RETRIES,
  SSE_RETRY_BASE_MS,
  SSE_RECONNECTING_MESSAGE,
  SSE_UNAVAILABLE_MESSAGE,
  SSE_SUBSCRIPTION_RETRY_MESSAGE,
} from './types';

export function useLayoutSSE(token: string | null) {
  const setSseConnected = useStore((s) => s.setSseConnected);
  const setSseError = useStore((s) => s.setSseError);
  const addActivity = useStore((s) => s.addActivity);

  const [sseConnected, setSseConnectedLocal] = useState(false);
  const [sseRetryCount, setSseRetryCount] = useState(0);
  const [sseError, setSseErrorLocal] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function attemptConnect(attempt: number): void {
      if (cancelled) return;

      try {
        unsubscribe = subscribeGlobalSSE((event) => {
          if (!event.sessionId) return;
          addActivity(event);
        }, token, {
          onOpen: () => {
            setSseConnected(true);
            setSseConnectedLocal(true);
            setSseError(null);
            setSseErrorLocal(null);
            setSseRetryCount(0);
          },
          onReconnecting: (attempt) => {
            setSseConnected(false);
            setSseConnectedLocal(false);
            setSseRetryCount(attempt);
            setSseError(SSE_RECONNECTING_MESSAGE);
            setSseErrorLocal(SSE_RECONNECTING_MESSAGE);
          },
          onClose: () => {
            setSseConnected(false);
            setSseConnectedLocal(false);
            setSseError(SSE_RECONNECTING_MESSAGE);
            setSseErrorLocal(SSE_RECONNECTING_MESSAGE);
          },
          onGiveUp: () => {
            setSseRetryCount(0);
            setSseError(SSE_UNAVAILABLE_MESSAGE);
            setSseErrorLocal(SSE_UNAVAILABLE_MESSAGE);
            setSseConnected(false);
            setSseConnectedLocal(false);
          },
        });
      } catch (err) {
        logger.error('layout', 'Failed to subscribe to global SSE (attempt %d):', attempt + 1, err);
        setSseConnected(false);
        setSseConnectedLocal(false);

        if (attempt < MAX_SSE_RETRIES) {
          const delay = SSE_RETRY_BASE_MS * Math.pow(2, attempt);
          setSseRetryCount(attempt + 1);
          setSseError(SSE_SUBSCRIPTION_RETRY_MESSAGE);
          setSseErrorLocal(SSE_SUBSCRIPTION_RETRY_MESSAGE);
          retryTimer = setTimeout(() => attemptConnect(attempt + 1), delay);
        } else {
          setSseRetryCount(0);
          setSseError(SSE_UNAVAILABLE_MESSAGE);
          setSseErrorLocal(SSE_UNAVAILABLE_MESSAGE);
          setSseConnected(false);
          setSseConnectedLocal(false);
        }
      }
    }

    attemptConnect(0);

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      unsubscribe?.();
    };
  }, [setSseConnected, setSseError, addActivity, token]);

  const sseIndicatorLabel = sseConnected
    ? 'SSE Live'
    : sseError
      ? sseRetryCount > 0
        ? `SSE Reconnecting (retry ${sseRetryCount})`
        : 'SSE Degraded'
      : 'SSE Off';

  return { sseConnected, sseRetryCount, sseError, sseIndicatorLabel };
}
