/**
 * components/shared/StaleDataBanner.tsx — Warning banner shown when SSE is disconnected.
 * Displayed on SessionDetailPage when sseError is truthy.
 */

import { AlertTriangle } from 'lucide-react';

interface StaleDataBannerProps {
  error: string;
}

export function StaleDataBanner({ error }: StaleDataBannerProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300"
      role="alert"
      aria-label="Live updates disconnected — data may be stale"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        Live updates disconnected — data may be stale. {error}
      </span>
    </div>
  );
}
