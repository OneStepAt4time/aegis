/**
 * components/shared/SessionHealthBanner.tsx — Session failure rate alert banner.
 *
 * Displays a color-coded health indicator on the dashboard overview based on
 * the session failure rate from analytics. Related: #3000. // token-ok
 *
 * Thresholds:
 * - Green (<5%): Healthy — no banner shown
 * - Yellow (5–25%): Warning — elevated failure rate
 * - Red (>25%): Critical — session infrastructure may be broken
 *
 * The banner is dismissible per session but reappears if the failure rate
 * increases by 5+ percentage points.
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, X, AlertCircle } from 'lucide-react';
import type { AnalyticsErrorRates } from '../../../../src/api-contracts';
import { useT } from '../../i18n/context';

interface SessionHealthBannerProps {
  errorRates: AnalyticsErrorRates | undefined;
  loading: boolean;
}

type HealthLevel = 'healthy' | 'warning' | 'critical';

function getHealthLevel(errorRates: AnalyticsErrorRates | undefined): HealthLevel {
  if (!errorRates || errorRates.totalSessions < 5) return 'healthy';
  const rate = errorRates.adjustedFailureRate ?? (errorRates.failedSessions / errorRates.totalSessions);
  if (rate > 0.25) return 'critical';
  if (rate > 0.05) return 'warning';
  return 'healthy';
}

const STORAGE_KEY = 'aegis-session-health-dismissed-rate';

export function SessionHealthBanner({ errorRates, loading }: SessionHealthBannerProps) {
    const t = useT();

  const [dismissedRate, setDismissedRate] = useState<number | null>(null);

  // Load dismissed rate from sessionStorage
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) setDismissedRate(parseFloat(stored));
    } catch { /* ignore */ }
  }, []);

  if (loading || !errorRates || errorRates.totalSessions < 5) return null;

  const level = getHealthLevel(errorRates);
  if (level === 'healthy') return null;

  const failureRate = errorRates.adjustedFailureRate
    ?? (errorRates.failedSessions / errorRates.totalSessions);
  const ratePercent = (failureRate * 100).toFixed(1);
  const totalFailed = errorRates.failedSessions;
  const totalSessions = errorRates.totalSessions;
  const infraFailed = errorRates.infraFailures;

  // Re-show if rate increased by 5% since dismissal
  if (dismissedRate !== null && (failureRate - dismissedRate) < 0.05) return null;

  const handleDismiss = () => {
    setDismissedRate(failureRate);
    try { sessionStorage.setItem(STORAGE_KEY, String(failureRate)); } catch { /* ignore */ }
  };

  const isCritical = level === 'critical';

  const bgColor = isCritical
    ? 'bg-red-500/10 border-red-500/30'
    : 'bg-yellow-500/10 border-yellow-500/30';
  const textColor = isCritical
    ? 'text-red-400'
    : 'text-yellow-400';
  const Icon = isCritical ? AlertCircle : AlertTriangle;

  const title = isCritical
    ? `Critical: Session failure rate at ${ratePercent}%`
    : `Warning: Elevated session failure rate (${ratePercent}%)`;

  return (
    <div
      role="alert"
      className={`relative flex items-start gap-3 rounded-lg border px-4 py-3 ${bgColor}`}
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${textColor}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${textColor}`}>
          {title}
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          {totalFailed} of {totalSessions} sessions failed
          {infraFailed > 0 && ` (${infraFailed} infrastructure failures)`}
        </p>
        {isCritical && (
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Check ACP child process spawning and server logs.
          </p>
        )}
      </div>
      <button type="button"
        onClick={handleDismiss}
        className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors"
        aria-label={t("aria.dismissHealthAlert")}
      >
        <X className="h-4 w-4 text-[var(--color-text-muted)]" />
      </button>
    </div>
  );
}

/**
 * Compact health indicator for the KPI banner area.
 * Shows a small colored dot + label.
 */
export function SessionHealthDot({ errorRates, loading }: SessionHealthBannerProps) {
  if (loading || !errorRates || errorRates.totalSessions < 5) return null;

  const level = getHealthLevel(errorRates);
  const failureRate = errorRates.adjustedFailureRate
    ?? (errorRates.failedSessions / errorRates.totalSessions);
  const ratePercent = (failureRate * 100).toFixed(1);

  const dotColor = level === 'critical'
    ? 'bg-red-500'
    : level === 'warning'
      ? 'bg-yellow-500'
      : 'bg-green-500';

  if (level === 'healthy') return null;

  return (
    <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
      <span className={`inline-block h-2 w-2 rounded-full ${dotColor} animate-pulse`} />
      <span>{ratePercent}% failure rate</span>
    </div>
  );
}
