/**
 * BudgetAlertBanner.tsx — Global budget alert banner for Layout.
 *
 * Shows when spending is approaching or exceeding budget caps.
 * Reads budget settings from localStorage and current spend from analytics API.
 * Dismissible per session; re-alerts when next threshold is crossed.
 * Part of issue #3125: Budget Alerts & Cost Forecasts.
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { formatCurrency } from '../../utils/formatNumber';
import { getBudgetSettings } from '../../utils/budgetSettings';
import { useT } from '../../i18n/context';

interface AlertState {
  level: 'warning' | 'critical';
  message: string;
  dismissed: boolean;
}

const DISMISS_KEY = 'aegis:budget-alert-dismissed';

export function BudgetAlertBanner() {
    const t = useT();

  const [alert, setAlert] = useState<AlertState | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Read dismissal state once on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(DISMISS_KEY);
      if (stored) setDismissedAt(Number(stored));
    } catch { /* ignore */ }
  }, []);

  const checkBudget = useCallback(async () => {
    const settings = getBudgetSettings();
    if (!settings.budgetAlertEnabled) {
      setAlert(null);
      return;
    }

    try {
      const response = await fetch('/v1/analytics/costs', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      const dailyTrends: Array<{ date: string; estimatedCostUsd: number }> = data.dailyTrends ?? [];

      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

      const todaySpend = dailyTrends.find(d => d.date === todayStr)?.estimatedCostUsd ?? 0;
      const monthSpend = dailyTrends
        .filter(d => d.date.startsWith(monthPrefix))
        .reduce((sum, d) => sum + d.estimatedCostUsd, 0);

      // Check thresholds
      const checkThreshold = (spend: number, cap: number, label: string): AlertState | null => {
        if (cap <= 0) return null;
        const pct = (spend / cap) * 100;

        if (pct >= 100) {
          return {
            level: 'critical',
            message: `${label} budget exceeded: ${formatCurrency(spend)} of ${formatCurrency(cap)} (${Math.round(pct)}%)`,
            dismissed: false,
          };
        }
        if (pct >= 80) {
          return {
            level: 'warning',
            message: `${label} budget at ${Math.round(pct)}%: ${formatCurrency(spend)} of ${formatCurrency(cap)}`,
            dismissed: false,
          };
        }
        return null;
      };

      // Check monthly first (more impactful), then daily
      const monthlyAlert = checkThreshold(monthSpend, settings.budgetMonthlyCapUsd, 'Monthly');
      const dailyAlert = checkThreshold(todaySpend, settings.budgetDailyCapUsd, 'Daily');
      setAlert(monthlyAlert || dailyAlert);
    } catch {
      // Silently fail — don't spam errors for a banner
    }
  }, []);

  useEffect(() => {
    void checkBudget();
    // Re-check every 5 minutes
    const interval = setInterval(() => void checkBudget(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkBudget]);

  if (!alert) return null;

  // Critical alerts cannot be dismissed; warnings dismiss for 30 min
  if (alert.level === 'warning' && dismissedAt) {
    if (Date.now() - dismissedAt < 30 * 60 * 1000) return null;
  }

  const isCritical = alert.level === 'critical';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 text-sm ${
        isCritical
          ? 'border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
          : 'border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]'
      }`}
      role="alert"
      aria-label={`Budget alert: ${alert.message}`}
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 font-medium">{alert.message}</span>
      {!isCritical && (
        <button
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, String(Date.now()));
            setAlert(null);
          }}
          className="flex-shrink-0 rounded p-1 hover:opacity-70 transition-opacity"
          aria-label={t("aria.dismissBudgetAlert")}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
