/**
 * pages/CostPage.tsx — Global cost & billing dashboard with charts and budgets.
 * Wired to GET /v1/analytics/costs (Issue #2802). // token-ok
 * Cost analytics panels added (Issue #3273). // token-ok
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SessionInfo, SessionsListResponse } from '../types';
import { useT } from '../i18n/context';
import { DollarSign, TrendingUp, AlertTriangle, Calendar } from 'lucide-react';
import { SkeletonStatCard, SkeletonCard } from '../components/shared/Skeleton';
import EmptyState from '../components/shared/EmptyState';
import { ErrorState } from '../components/ErrorState';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar as ChartBar, Pie as ChartPie } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip);
import {
  CHART_RGB,
} from '../utils/chartTheme';

import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';
import { getAnalyticsCosts, getCostSummary, getCostByModel, getSessions } from '../api/client';
import type { AnalyticsCostsResponse, CostSummaryResponse, CostByModelResponse } from '../types';
import { BudgetProgressBar } from '../components/shared/BudgetProgressBar';
import { SpendSummary } from '../components/cost/SpendSummary';
import { SessionCostTable } from '../components/cost/SessionCostTable';
import { ForecastChart } from '../components/cost/ForecastChart';
import { BurnRateChart } from '../components/cost/BurnRateChart';
import { TokenBreakdownChart } from '../components/cost/TokenBreakdownChart';
import { CostByModelChart } from '../components/cost/CostByModelChart';
import { getBudgetSettings, type BudgetSettings } from '../utils/budgetSettings';

const MODEL_COLORS: Record<string, string> = {
  'claude-sonnet-4.6': 'var(--color-accent-cyan)',
  'claude-opus-4.7': 'var(--color-accent-purple)',
  'claude-haiku-4.5': 'var(--color-success)',
  'gpt-5.4': 'var(--color-warning)',
  'gpt-4.1': 'var(--color-info)',
  other: 'var(--color-text-muted)',
};

type TimeRange = '7d' | '30d' | '90d';

const TIME_RANGES: Array<{ value: TimeRange; label: string }> = [
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: '90d', label: '90 Days' },
];

function TimeRangePicker({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  const t = useT();
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]" role="group" aria-label={t('aria.timeRangeSelector')}>
      {TIME_RANGES.map((range) => (
        <button
          key={range.value}
          type="button"
          onClick={() => onChange(range.value)}
          className={`min-h-[44px] px-3 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
            value === range.value
              ? 'bg-[var(--color-accent-cyan)] text-[var(--color-void)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
          }`}
          aria-pressed={value === range.value}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}





interface BudgetOverviewProps {
  dailyData: Array<{ date: string; estimatedCostUsd: number; sessions: number }>;
  budgetSettings: BudgetSettings;
  navigateToSettings: () => void;
}

function BudgetOverview({ dailyData, budgetSettings, navigateToSettings }: BudgetOverviewProps) {
  const t = useT();
  if (!budgetSettings.budgetAlertEnabled) {
    return (
      <section className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4" aria-label={t("aria.budgetAlerts")}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-[var(--color-warning-glow)]">{t('cost.budgetAlertSection.title')}</h4>
            <p className="mt-1 text-xs text-[var(--color-warning)]/80">
              {t('cost.budgetAlertSection.description')}{' '}
              <button
                type="button"
                onClick={navigateToSettings}
                className="inline-flex min-h-[44px] items-center underline hover:text-[var(--color-warning-glow)]"
              >
                Settings
              </button>
              {' '}to receive warnings at 80% and optional hard stops at 100%.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const today = new Date();
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const todayStr = `${monthPrefix}-${String(today.getDate()).padStart(2, '0')}`;
  const todaySpend = dailyData.find(d => d.date === todayStr)?.estimatedCostUsd ?? 0;
  const monthSpend = dailyData.filter(d => d.date.startsWith(monthPrefix)).reduce((s, d) => s + d.estimatedCostUsd, 0);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BudgetProgressBar
          currentSpend={todaySpend}
          cap={budgetSettings.budgetDailyCapUsd}
          label={t("cost.daily")}
          period="today"
        />
        <BudgetProgressBar
          currentSpend={monthSpend}
          cap={budgetSettings.budgetMonthlyCapUsd}
          label={t("cost.monthly")}
          period={`${today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
        />
      </div>
      <SpendSummary dailyTrends={dailyData} />
      <ForecastChart dailyTrends={dailyData} monthlyCap={budgetSettings.budgetMonthlyCapUsd} />
    </>
  );
}

export default function CostPage() {
  const navigate = useNavigate();
  const t = useT();
  const [costData, setCostData] = useState<AnalyticsCostsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [costSummary, setCostSummary] = useState<CostSummaryResponse | null>(null);
  const [costByModel, setCostByModel] = useState<CostByModelResponse | null>(null);
  const sseConnected = useStore((s) => s.sseConnected);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [data, summary, byModel, sessionsResult] = await Promise.allSettled([
        getAnalyticsCosts(),
        getCostSummary().catch(() => null),
        getCostByModel().catch(() => null),
        getSessions({ limit: 50 }).catch(() => ({ sessions: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } } satisfies SessionsListResponse)),
      ]);
      if (data.status === 'fulfilled') setCostData(data.value);
      if (summary.status === 'fulfilled' && summary.value) setCostSummary(summary.value);
      if (byModel.status === 'fulfilled' && byModel.value) setCostByModel(byModel.value);
      if (sessionsResult.status === 'fulfilled' && sessionsResult.value) setSessions(sessionsResult.value.sessions);
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
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('cost.usageTracking')}</p>
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
        {/* Cost analytics skeleton */}
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
  const hasSessions = (costData?.totalSessions ?? 0) > 0;
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
          title={t("cost.noCostData")}
          description={hasSessions
            ? t('cost.sessionsRunningNoCost')
            : t('cost.costWillAppear')
          }
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
            {t('cost.usageTracking')}
            {sseConnected && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--color-success)]">
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
            {daysWithData > 7 ? t('cost.costLabel', { days: daysWithData }) : t('cost.costLabelShort')}
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(totalCost)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-muted)]">{t('cost.avgDaily')}</div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(avgDailyCost)}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <TrendingUp className="h-3 w-3" />
            {t('cost.last7DaysAvg')}
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(last7Avg)}
          </div>
          {avgDailyCost > 0 && (
            <div className="mt-1 text-xs text-[var(--color-text-muted)]">
              {t('cost.vsAvg', { pct: `${last7Avg > avgDailyCost ? '+' : ''}${((last7Avg / avgDailyCost - 1) * 100).toFixed(1)}` })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <Calendar className="h-3 w-3" />
            {t('cost.projectedMonth')}
          </div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(projectedMonthCost)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            {t('cost.daysPastRemaining', { passed: daysPassed, remaining: daysRemaining })}
          </div>
        </div>
      </div>

      {/* Daily spend chart */}
      {dailyData.length > 0 && (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label={t('aria.dailySpendChart')}>
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            {t('cost.dailySpendDays', { count: dailyData.length })}
          </h3>
          <div className="h-64 min-w-0">
            <ChartBar data={{
              labels: dailyData.map((d) => d.date),
              datasets: [{
                label: t("cost.dailyCost"),
                data: dailyData.map((d) => d.estimatedCostUsd),
                backgroundColor: `rgba(${CHART_RGB.cyan}, 0.7)`,
                borderRadius: 4,
                borderSkipped: false,
              }],
            }} options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15, 15, 25, 0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 8, padding: 12, titleFont: { size: 11 }, titleColor: '#9ca3af', bodyFont: { family: 'monospace', size: 13, weight: 'bold' }, bodyColor: '#f3f4f6', displayColors: false, callbacks: { title: (items) => formatDateShort(items[0]?.label ?? ''), label: (ctx) => formatCurrency(ctx.parsed.y ?? 0) } } },
              scales: { x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { size: 11 }, maxTicksLimit: 8, callback: function(v, i) { return i % Math.ceil(dailyData.length / 8) === 0 ? formatDateShort(this.getLabelForValue(v as number)) : ''; } }, border: { color: 'rgba(255,255,255,0.06)' } }, y: { grid: { color: 'rgba(255,255,255,0.06)', drawTicks: false }, ticks: { color: '#9ca3af', font: { size: 11 }, callback: (v) => `$${((v as number) ?? 0).toFixed(2)}` }, border: { color: 'rgba(255,255,255,0.06)' } } },
            } satisfies ChartOptions<'bar'>} />
          </div>
        </section>
      )}

      {/* ── Cost Analytics Panels (#3273) ── */} // token-ok
      <section aria-label={t('aria.costAnalytics')}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-medium text-[var(--color-text-primary)]">
            {t('cost.costAnalyticsTitle')}
            {costSummary?.burnRateUsdPerHour && costSummary.burnRateUsdPerHour > 0 && (
              <span className="ml-3 text-sm font-normal text-[var(--color-accent-cyan)]">
                {t('cost.burnRatePerHour', { rate: formatCurrency(costSummary.burnRateUsdPerHour) })}
              </span>
            )}
          </h2>
          <TimeRangePicker value={timeRange} onChange={setTimeRange} />
        </div>

        {/* Burn rate — full width */}
        <div className="mb-4">
          <BurnRateChart data={dailyData.map(d => ({ date: d.date, cost: d.estimatedCostUsd }))} />
        </div>

        {/* Token breakdown + Cost by model — side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TokenBreakdownChart />
          <CostByModelChart data={(costByModel?.models ?? []).map(m => ({ model: m.model, cost: m.estimatedCostUsd }))} />
        </div>
      </section>

      {/* Model breakdown */}
      {modelData.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Pie chart */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label={t('aria.costByModelChart')}>
            <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
              {t('cost.costByModel')}
            </h3>
            <div className="h-64 min-w-0">
              <ChartPie data={{
                labels: modelData.map((m) => m.model),
                datasets: [{ data: modelData.map((m) => m.estimatedCostUsd), backgroundColor: modelData.map((m) => { const rgb = CHART_RGB[m.model === 'claude-opus-4.7' ? 'purple' : m.model === 'claude-sonnet-4.6' ? 'cyan' : m.model === 'claude-haiku-4.5' ? 'success' : m.model === 'gpt-5.4' ? 'warning' : m.model === 'gpt-4.1' ? 'info' : 'cyan']; return `rgba(${rgb}, 0.7)`; }), borderWidth: 0 }],
              }} options={{
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(15,15,25,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1, cornerRadius: 8, padding: 12, displayColors: false, callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.parsed ?? 0)}` } } },
              } satisfies ChartOptions<'pie'>} />
            </div>
          </section>

          {/* Model list */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5" aria-label={t('aria.modelDetails')}>
            <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
              {t('cost.modelDetails')}
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

      {/* Session cost breakdown table */}
      <SessionCostTable sessions={sessions} />

      {/* Budget progress & spending summary */}
      <BudgetOverview
        dailyData={dailyData}
        budgetSettings={getBudgetSettings()}
        navigateToSettings={() => navigate('/settings#budget')}
      />
    </div>
  );
}
