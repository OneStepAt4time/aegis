/**
 * components/shared/GettingStartedCard.tsx — Welcome card for new users.
 *
 * Shows when total sessions < 3 and user hasn't dismissed it.
 * CTA opens the CreateSessionModal.
 * Uses design tokens for dark/light theme compatibility.
 */

import { useState } from 'react';
import { useT } from '../../i18n/context.js';
import { Rocket, X, ArrowRight } from 'lucide-react';

interface GettingStartedCardProps {
  totalSessions: number;
  onCreateSession: () => void;
}

const DISMISS_KEY = 'aegis-getting-started-dismissed';

export default function GettingStartedCard({ totalSessions, onCreateSession }: GettingStartedCardProps) {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISS_KEY) === 'true';
  });

  // Auto-hide: if user has 3+ sessions, never show
  if (totalSessions >= 3 || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  return (
    <div
      role="complementary"
      aria-label="Getting started"
      className="relative rounded-xl border border-[var(--color-accent-cyan)]/20 bg-gradient-to-br from-[var(--color-accent-cyan)]/5 to-[var(--color-surface-strong)] p-5 sm:p-6"
    >
      {/* Dismiss button */}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-md p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-lighter)]"
        aria-label={t('gettingStarted.dismiss')}
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Icon */}
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]">
          <Rocket className="h-6 w-6" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            {t('gettingStarted.title')}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {t('gettingStarted.description')}
          </p>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onCreateSession}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-5 py-2.5 text-sm font-semibold text-[var(--color-accent-cyan)] transition-all hover:bg-[var(--color-accent-cyan)]/20 hover:border-[var(--color-accent-cyan)]/50"
        >
          {t('gettingStarted.createFirstSession')}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
