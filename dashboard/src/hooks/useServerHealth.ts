/**
 * hooks/useServerHealth.ts — Server health polling hook.
 *
 * Polls /v1/health every 30s to detect if the Aegis server is reachable.
 * Returns connection status for the health indicator.
 */

import { useState, useEffect } from 'react';

export type ServerHealthStatus = 'connected' | 'disconnected' | 'reconnecting' | 'checking';

interface ServerHealth {
  status: ServerHealthStatus;
  lastCheck: Date | null;
  downSince: Date | null;
  errorMessage: string | null;
}

const POLL_INTERVAL_MS = 30_000;
const DOWN_THRESHOLD_MS = 60_000;
const MIN_CHECK_INTERVAL_MS = 10_000;

const initialHealth: ServerHealth = {
  status: 'checking',
  lastCheck: null,
  downSince: null,
  errorMessage: null,
};

let sharedHealth = initialHealth;
let sharedDownSince: Date | null = null;
let inFlightCheck: Promise<void> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let lastCheckStartedAt = 0;
const subscribers = new Set<(health: ServerHealth) => void>();

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

function publish(next: ServerHealth): void {
  sharedHealth = next;
  for (const subscriber of subscribers) subscriber(sharedHealth);
}

function runHealthCheck(force = false): Promise<void> {
  const now = Date.now();
  if (inFlightCheck) return inFlightCheck;
  if (!force && now - lastCheckStartedAt < MIN_CHECK_INTERVAL_MS) return Promise.resolve();

  lastCheckStartedAt = now;
  inFlightCheck = (async () => {
    const result = await fetchHealth();

    if (result.ok) {
      sharedDownSince = null;
      publish({
        status: 'connected',
        lastCheck: new Date(),
        downSince: null,
        errorMessage: null,
      });
      return;
    }

    const checkedAt = new Date();
    sharedDownSince ??= checkedAt;
    const downMs = checkedAt.getTime() - sharedDownSince.getTime();
    const isExtended = downMs >= DOWN_THRESHOLD_MS;

    publish({
      status: isExtended ? 'disconnected' : 'reconnecting',
      lastCheck: checkedAt,
      downSince: sharedDownSince,
      errorMessage: isExtended
        ? 'Aegis server is unreachable. Check if the server is running.'
        : 'Connection to Aegis server lost. Reconnecting…',
    });
  })().finally(() => {
    inFlightCheck = null;
  });

  return inFlightCheck;
}

function ensurePollingStarted(): void {
  if (!interval) {
    void runHealthCheck();
    interval = setInterval(() => { void runHealthCheck(true); }, POLL_INTERVAL_MS);
  }
}

function stopPollingIfUnused(): void {
  if (subscribers.size > 0 || !interval) return;
  clearInterval(interval);
  interval = null;
}

export function __resetServerHealthForTests(): void {
  sharedHealth = initialHealth;
  sharedDownSince = null;
  inFlightCheck = null;
  lastCheckStartedAt = 0;
  subscribers.clear();
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

export function useServerHealth(): ServerHealth {
  const [health, setHealth] = useState<ServerHealth>(sharedHealth);

  useEffect(() => {
    subscribers.add(setHealth);
    setHealth(sharedHealth);
    ensurePollingStarted();
    return () => {
      subscribers.delete(setHealth);
      stopPollingIfUnused();
    };
  }, []);

  return health;
}
