/**
 * components/overview/LastUpdatedIndicator.tsx — Shows relative time since last data refresh.
 *
 * Displays "Updated just now" / "Updated 15s ago" / "Updated 2m ago" etc.
 * Auto-updates every 10s to keep the relative time accurate.
 * Shows a stale warning when data hasn't been refreshed in >60s.
 */

import { useEffect, useState } from 'react';
import { Clock, AlertTriangle } from 'lucide-react';
import { useT } from '../../i18n/context';

interface LastUpdatedIndicatorProps {
  lastUpdated: number | null;
  staleThresholdMs?: number;
}

function formatRelative(ms: number, t: (key: string) => string): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return t('updated.justNow');
  if (seconds < 60) return t('updated.secondsAgo').replace('{n}', String(seconds));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('updated.minutesAgo').replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  return t('updated.hoursAgo').replace('{n}', String(hours));
}

export function LastUpdatedIndicator({
  lastUpdated,
  staleThresholdMs = 60_000,
}: LastUpdatedIndicatorProps) {
  const t = useT();
  const [now, setNow] = useState(Date.now());

  // Tick every 10s to keep relative time fresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  if (lastUpdated === null) return null;

  const elapsed = now - lastUpdated;
  const isStale = elapsed > staleThresholdMs;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
        isStale
          ? 'text-amber-400'
          : 'text-[var(--color-text-secondary)]'
      }`}
      aria-live="polite"
      aria-label={isStale ? t('updated.staleLabel') : formatRelative(elapsed, t)}
    >
      {isStale ? (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Clock className="h-3 w-3" aria-hidden="true" />
      )}
      {isStale ? t('updated.stale') : formatRelative(elapsed, t)}
    </span>
  );
}
