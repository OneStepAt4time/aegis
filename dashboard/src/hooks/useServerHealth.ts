/**
 * hooks/useServerHealth.ts — Server health polling hook.
 *
 * Polls /v1/health every 30s to detect if the Aegis server is reachable.
 * Returns connection status for the health indicator.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type ServerHealthStatus = 'connected' | 'disconnected' | 'reconnecting' | 'checking';

interface ServerHealth {
  status: ServerHealthStatus;
  lastCheck: Date | null;
  downSince: Date | null;
  errorMessage: string | null;
}

const POLL_INTERVAL_MS = 30_000;
const DOWN_THRESHOLD_MS = 60_000;

async function fetchHealth(): Promise<{ ok: boolean; status?: string }> {
  try {
    const res = await fetch('/v1/health', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: true, status: data.status };
  } catch {
    return { ok: false };
  }
}

export function useServerHealth(): ServerHealth {
  const [health, setHealth] = useState<ServerHealth>({
    status: 'checking',
    lastCheck: null,
    downSince: null,
    errorMessage: null,
  });

  const downSinceRef = useRef<Date | null>(null);

  const check = useCallback(async () => {
    const result = await fetchHealth();

    if (result.ok) {
      downSinceRef.current = null;
      setHealth({
        status: 'connected',
        lastCheck: new Date(),
        downSince: null,
        errorMessage: null,
      });
    } else {
      const now = new Date();
      if (!downSinceRef.current) {
        downSinceRef.current = now;
      }
      const downMs = now.getTime() - downSinceRef.current.getTime();
      const isExtended = downMs >= DOWN_THRESHOLD_MS;

      setHealth({
        status: isExtended ? 'disconnected' : 'reconnecting',
        lastCheck: now,
        downSince: downSinceRef.current,
        errorMessage: isExtended
          ? 'Aegis server is unreachable. Check if the server is running.'
          : 'Connection to Aegis server lost. Reconnecting…',
      });
    }
  }, []);

  useEffect(() => {
    // Initial check
    check();
    // Poll every 30s
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [check]);

  return health;
}
