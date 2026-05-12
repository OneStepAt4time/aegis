/**
 * SpendSummary.tsx — Summary of spending metrics with forecast.
 *
 * Shows today's spend, monthly spend, and projected monthly total.
 * Part of issue #3125: Budget Alerts & Cost Forecasts.
 */

import { formatCurrency } from '../../utils/formatNumber';
import { useT } from '../../i18n/context';

export interface SpendSummaryProps {
  /** Daily cost trends from analytics API. */
  dailyTrends: Array<{
    date: string;
    estimatedCostUsd: number;
    sessions: number;
  }>;
}

function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCurrentMonthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDaysInMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function getCurrentDay(): number {
  return new Date().getDate();
}

export function SpendSummary({ dailyTrends }: SpendSummaryProps) {
    const t = useT();

  const today = getToday();
  const monthPrefix = getCurrentMonthPrefix();
  const daysInMonth = getDaysInMonth();
  const currentDay = getCurrentDay();

  // Today's spend
  const todayEntry = dailyTrends.find((d) => d.date === today);
  const todaySpend = todayEntry?.estimatedCostUsd ?? 0;

  // Monthly spend (sum of all entries in current month)
  const monthEntries = dailyTrends.filter((d) => d.date.startsWith(monthPrefix));
  const monthSpend = monthEntries.reduce((sum, d) => sum + d.estimatedCostUsd, 0);

  // Projected monthly total
  // Use average daily spend from available data points, extrapolate to full month
  let projectedTotal = monthSpend;
  if (monthEntries.length > 0 && currentDay < daysInMonth) {
    const avgDailySpend = monthSpend / monthEntries.length;
    const remainingDays = daysInMonth - currentDay;
    projectedTotal = monthSpend + (avgDailySpend * remainingDays);
  }

  const hasData = dailyTrends.length > 0;

  if (!hasData) {
    return (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        aria-label={t("aria.spendingSummary")}
      >
        {['Today', 'This Month', 'Projected'].map((label) => (
          <div
            key={label}
            className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
              {label}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--color-text-muted)]">
              No data
            </p>
          </div>
        ))}
      </div>
    );
  }

  const stats = [
    { label: 'Today', value: formatCurrency(todaySpend), sub: `${todayEntry?.sessions ?? 0} sessions` },
    { label: 'This Month', value: formatCurrency(monthSpend), sub: `${monthEntries.reduce((s, d) => s + d.sessions, 0)} sessions` },
    { label: 'Projected Total', value: formatCurrency(projectedTotal), sub: `based on ${monthEntries.length} day${monthEntries.length !== 1 ? 's' : ''} of data` },
  ];

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      aria-label={t("aria.spendingSummary")}
    >
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {stat.label}
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">
            {stat.value}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {stat.sub}
          </p>
        </div>
      ))}
    </div>
  );
}
