/**
 * BudgetProgressBar.tsx — Visual progress bar for budget tracking.
 *
 * Shows current spend vs cap with color-coded severity thresholds.
 * Part of issue #3125: Budget Alerts & Cost Forecasts.
 */

import { formatCurrency } from '../../utils/formatNumber';

export interface BudgetProgressBarProps {
  /** Current spend in USD. */
  currentSpend: number;
  /** Budget cap in USD. Zero or negative means no limit. */
  cap: number;
  /** Label (e.g. "Daily" or "Monthly"). */
  label: string;
  /** Period description (e.g. "today" or "May 2026"). */
  period: string;
}

type Severity = 'green' | 'amber' | 'red';

function severityForPercentage(pct: number): Severity {
  if (pct < 50) return 'green';
  if (pct < 80) return 'amber';
  return 'red';
}

const SEVERITY_BG: Record<Severity, string> = {
  green: 'bg-[var(--color-success)]',
  amber: 'bg-[var(--color-warning)]',
  red: 'bg-[var(--color-danger)]',
};

const SEVERITY_TEXT: Record<Severity, string> = {
  green: 'text-[var(--color-success)]',
  amber: 'text-[var(--color-warning)]',
  red: 'text-[var(--color-danger)]',
};

export function BudgetProgressBar({ currentSpend, cap, label, period }: BudgetProgressBarProps) {
  const isUnlimited = cap <= 0;

  if (isUnlimited) {
    return (
      <div
        className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4"
        aria-label={`${label} budget: no limit set`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              {label} Budget
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
              {formatCurrency(currentSpend)} <span className="text-sm font-normal text-[var(--color-text-muted)]">/ {period}</span>
            </p>
          </div>
          <span className="text-xs text-[var(--color-text-muted)]">No limit set</span>
        </div>
      </div>
    );
  }

  const pct = Math.min((currentSpend / cap) * 100, 200);
  const clampedPct = Math.min(pct, 100);
  const severity = severityForPercentage(pct);
  const displayPct = Math.round(pct);
  const isOverBudget = pct >= 100;

  return (
    <div
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4"
      aria-label={`${label} budget: ${displayPct}% used, ${formatCurrency(currentSpend)} of ${formatCurrency(cap)}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {label} Budget
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
            {formatCurrency(currentSpend)}{' '}
            <span className="text-sm font-normal text-[var(--color-text-muted)]">
              / {formatCurrency(cap)} {period}
            </span>
          </p>
        </div>
        <span className={`text-sm font-mono font-bold ${SEVERITY_TEXT[severity]}`}>
          {displayPct}%
          {isOverBudget && (
            <span className="ml-1 text-xs">⚠️</span>
          )}
        </span>
      </div>

      {/* Touch target wrapper with progressbar role on the full-range track */}
      <div
        className="min-h-[44px] flex items-center"
        role="progressbar"
        aria-valuenow={displayPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} budget usage: ${displayPct}%`}
      >
        <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--color-void-lighter)]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${SEVERITY_BG[severity]}`}
            style={{ width: `${clampedPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
