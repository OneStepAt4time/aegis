/**
 * components/shared/StaleDataBanner.tsx — Warning banner shown when SSE is disconnected.
 * Displayed on SessionDetailPage when sseError is truthy.
 */

import { AlertTriangle } from 'lucide-react';
import { useT } from '../../i18n/context';

interface StaleDataBannerProps {
  error: string;
}

export function StaleDataBanner({ error }: StaleDataBannerProps) {
  const t = useT();
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-2.5 text-sm text-[var(--color-warning-glow)]"
      role="alert"
aria-label={t('notifications.staleData', { error })}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        {t('notifications.staleData', { error })}
      </span>
    </div>
  );
}
