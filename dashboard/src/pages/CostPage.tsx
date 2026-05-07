/**
 * pages/CostPage.tsx — Global cost & billing dashboard with charts and budgets.
 * Wired to GET /v1/analytics/costs (Issue #2802).
 */

import { useState, useEffect, useCallback } from 'react';
import { useT } from '../i18n/context';
import { DollarSign, TrendingUp, AlertTriangle, Calendar } from 'lucide-react';
import { SkeletonStatCard, SkeletonCard } from '../components/shared/Skeleton';
import EmptyState from '../components/shared/EmptyState';
import { ErrorState } from '../components/ErrorState';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import { ChartFrame } from '../components/shared/ChartFrame';
import { getAnalyticsCosts } from '../api/client';
import type { AnalyticsCostsResponse } from '../types';

const MODEL_COLORS: Record<string, string> = {
  'claude-sonnet-4.6': 'var(--color-accent-cyan)',
  'claude-opus-4.7': 'var(--color-accent-purple)',
  'claude-haiku-4.5': 'var(--color-success)',
  'gpt-5.4': 'var(--color-warning)',
  'gpt-4.1': 'var(--color-info)',
  other: 'var(--color-text-muted)',
};

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-primary)]">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--color-text-muted)]">{entry.name}:</span>
          <span className="font-mono font-medium text-[var(--color-text-primary)]">
            {formatCurrency(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CostPage() {
  const t = useT();
  const [costData, setCostData] = useState<AnalyticsCostsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const sseConnected = useStore((s) => s.sseConnected);

  const fetchData = useCallback(async () => {
    try {
      const data = await getAnalyticsCosts();
      setCostData(data);
      setDataError(null);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load cost data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Derived data from real API response
  const dailyData = costData?.dailyTrends ?? [];
  const modelData = costData?.byModel ?? [];
  const totalCost = costData?.totalCostUsd ?? 0;
  const daysWithData = dailyData.length || 1;
  const avgDailyCost = totalCost / daysWithData;

  // Last 7 days calculation
  const last7 = dailyData.slice(-7);
  const last7Total = last7.reduce((sum, d) => sum + d.estimatedCostUsd, 0);
  const last7Avg = last7.length > 0 ? last7Total / last7.length : 0;

  // Burn rate calculation
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysPassed = today.getDate();
  const daysRemaining = daysInMonth - daysPassed;
  // Guard: avoid inflated projections from too few data points (Argus review)
  const projectedMonthCost = daysWithData >= 3
    ? (totalCost / daysWithData) * daysInMonth
    : last7Avg > 0 ? last7Avg * daysInMonth : 0;

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-[var(--color-accent-cyan)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Cost & Billing</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">Usage tracking, burn rate, and budget alerts</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonStatCard key={i} />)}
        </div>
        <SkeletonCard className="h-72" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard className="h-72" />
          <SkeletonCard className="h-72" />
        </div>
      </div>
    );
  }

  // Error state
  if (dataError) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-[var(--color-accent-cyan)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Cost & Billing</h1>
          </div>
        </div>
        <ErrorState variant="server-5xx" message={dataError} onRetry={() => { setIsLoading(true); void fetchData(); }} />
      </div>
    );
  }

  // Empty state — no cost data recorded
  const hasData = dailyData.length > 0 && dailyData.some((d) => d.estimatedCostUsd > 0);
  if (!hasData) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-[var(--color-accent-cyan)]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Cost & Billing</h1>
          </div>
        </div>
        <EmptyState
          icon={<DollarSign className="h-8 w-8" />}
          title="No cost data yet"
          description="Cost metrics will appear once Aegis starts tracking usage. Start a session to begin collecting data."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <DollarSign className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Cost & Billing</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Usage tracking, burn rate, and budget alerts
            {sseConnected && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                Live
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-muted)]">
            {daysWithData > 7 ? `${daysWithData}-Day` : 'Total'} Cost
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(totalCost)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-muted)]">Avg Daily</div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(avgDailyCost)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <TrendingUp className="h-3 w-3" />
            Last 7 Days Avg
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(last7Avg)}
          </div>
          {avgDailyCost > 0 && (
            <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
              {last7Avg > avgDailyCost ? '+' : ''}{((last7Avg / avgDailyCost - 1) * 100).toFixed(1)}% vs avg
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <Calendar className="h-3 w-3" />
            Projected Month
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(projectedMonthCost)}
          </div>
          <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
            {daysPassed}d past, {daysRemaining}d remaining
          </div>
        </div>
      </div>

      {/* Daily spend chart */}
      {dailyData.length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Daily Spend ({dailyData.length} days)
          </h3>
          <ChartFrame className="h-64 min-w-0" label={t("cost.loadingDailySpend")}>
            {({ width, height }) => (
              <BarChart width={width} height={height} data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <YAxis
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                  tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                  stroke="var(--color-void-lighter)"
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar
                  dataKey="estimatedCostUsd"
                  name={t("cost.dailyCost")}
                  fill="var(--color-accent-cyan)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            )}
          </ChartFrame>
        </section>
      )}

      {/* Model breakdown */}
      {modelData.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Pie chart */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
            <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
              Cost by Model
            </h3>
            <ChartFrame className="h-64 min-w-0" label={t("cost.loadingCostByModel")}>
              {({ width, height }) => (
                <PieChart width={width} height={height}>
                  <Pie
                    data={modelData}
                    dataKey="estimatedCostUsd"
                    nameKey="model"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                    labelLine={{ stroke: 'var(--color-text-muted)' }}
                  >
                    {modelData.map((entry) => (
                      <Cell
                        key={entry.model}
                        fill={MODEL_COLORS[entry.model] || MODEL_COLORS.other}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              )}
            </ChartFrame>
          </section>

          {/* Model list */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
            <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
              Model Details
            </h3>
            <div className="space-y-3">
              {modelData.map((model) => {
                const pct = totalCost > 0 ? (model.estimatedCostUsd / totalCost) * 100 : 0;
                return (
                  <div key={model.model} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: MODEL_COLORS[model.model] || MODEL_COLORS.other }}
                      />
                      <span className="text-sm font-mono text-[var(--color-text-primary)]">
                        {model.model}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono font-medium text-[var(--color-text-primary)]">
                        {formatCurrency(model.estimatedCostUsd)}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {pct.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* Budget warning */}
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4" aria-label="Budget alerts">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-amber-200">Budget Alerts</h4>
            <p className="mt-1 text-xs text-amber-300/80">
              Configure daily and monthly spending caps in{' '}
              <button
                type="button"
                onClick={() => window.location.hash = '#budget'}
                className="inline-flex min-h-[44px] items-center underline hover:text-amber-200"
              >
                Settings
              </button>
              {' '}to receive warnings at 80% and optional hard stops at 100%.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
