/**
 * budgetSettings.ts — Shared budget settings reader from localStorage.
 *
 * Single source of truth for budget configuration parsing.
 * Used by CostPage, BudgetAlertBanner, and any future budget-aware components.
 */

export interface BudgetSettings {
  budgetDailyCapUsd: number;
  budgetMonthlyCapUsd: number;
  budgetAlertEnabled: boolean;
}

const STORAGE_KEY = 'aegis:settings';

export function getBudgetSettings(): BudgetSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        budgetDailyCapUsd: Number(parsed.budgetDailyCapUsd) || 0,
        budgetMonthlyCapUsd: Number(parsed.budgetMonthlyCapUsd) || 0,
        budgetAlertEnabled: Boolean(parsed.budgetAlertEnabled),
      };
    }
  } catch { /* ignore parse errors */ }
  return { budgetDailyCapUsd: 0, budgetMonthlyCapUsd: 0, budgetAlertEnabled: false };
}
