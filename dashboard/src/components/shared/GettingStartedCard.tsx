/**
 * components/shared/GettingStartedCard.tsx — Welcome card for new users.
 *
 * Shows when totalSessions < 3 and user hasn't dismissed it.
 * CTA opens the CreateSessionModal. Includes inline CLI hint for zero-config flow.
 * Uses design tokens for dark/light theme compatibility.
 */

import { useState } from 'react';
import { useT } from '../../i18n/context.js';
import { Rocket, X, ArrowRight, Copy, Check } from 'lucide-react';

interface GettingStartedCardProps {
  totalSessions: number;
  onCreateSession: () => void;
}

const DISMISS_KEY = 'aegis-getting-started-dismissed';
const CLI_COMMAND = 'ag create "Build a hello world"';

export default function GettingStartedCard({ totalSessions, onCreateSession }: GettingStartedCardProps) {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(DISMISS_KEY) === 'true';
  });
  const [copied, setCopied] = useState(false);

  // Auto-hide: if user has 3+ sessions, never show
  if (totalSessions >= 3 || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-HTTPS mobile)
    }
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

          {/* Inline CLI hint */}
          <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-void)] px-2.5 py-1">
            <code className="font-mono text-xs text-[var(--color-text-primary)]">
              {CLI_COMMAND}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? t('gettingStarted.copied') : t('gettingStarted.copyCommand')}
              className="flex items-center justify-center rounded p-0.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              {copied ? (
                <Check className="h-3 w-3 text-[var(--color-success)]" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
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
