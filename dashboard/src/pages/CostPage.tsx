/**
 * pages/CostPage.tsx — Global cost & billing dashboard with charts and budgets.
 * Recharts chosen for React-friendly API and TypeScript support.
 */

import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, AlertTriangle, Calendar } from 'lucide-react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../utils/formatNumber';
import { formatDateShort } from '../utils/formatDate';

// Mock data structure (will be replaced with real API data)
interface DailyCost {
  date: string;
  cost: number;
  byKey?: Record<string, number>;
}

interface ModelCost {
  model: string;
  cost: number;
  percentage: number;
}

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

// Generate mock 14-day data
function generateMockDailyData(): DailyCost[] {
  const data: DailyCost[] = [];
  const today = new Date();
  
  for (let i = 13; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Random cost between $0.50 and $5.00
    const cost = Math.random() * 4.5 + 0.5;
    
    data.push({
      date: dateStr,
      cost: parseFloat(cost.toFixed(3)),
    });
  }
  
  return data;
}

function generateMockModelData(totalCost: number): ModelCost[] {
  const models = [
    { model: 'claude-sonnet-4.6', percentage: 45 },
    { model: 'claude-opus-4.7', percentage: 25 },
    { model: 'claude-haiku-4.5', percentage: 15 },
    { model: 'gpt-5.4', percentage: 10 },
    { model: 'gpt-4.1', percentage: 5 },
  ];
  
  return models.map(m => ({
    ...m,
    cost: (totalCost * m.percentage) / 100,
  }));
}

export default function CostPage() {
  const [dailyData, setDailyData] = useState<DailyCost[]>([]);
  const [modelData, setModelData] = useState<ModelCost[]>([]);
  const sseConnected = useStore((s) => s.sseConnected);
  
  // Load initial data
  useEffect(() => {
    const daily = generateMockDailyData();
    setDailyData(daily);
    
    const totalCost = daily.reduce((sum, d) => sum + d.cost, 0);
    setModelData(generateMockModelData(totalCost));
  }, []);
  
  // Calculate metrics
  const totalCost = dailyData.reduce((sum, d) => sum + d.cost, 0);
  const avgDailyCost = totalCost / 14;
  const last7Days = dailyData.slice(-7);
  const last7Total = last7Days.reduce((sum, d) => sum + d.cost, 0);
  const last7Avg = last7Total / 7;
  
  // Burn rate calculation
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysPassed = today.getDate();
  const daysRemaining = daysInMonth - daysPassed;
  const projectedMonthCost = (totalCost / Math.min(daysPassed, 14)) * daysInMonth;
  
  return (
    <div className="flex flex-col gap-6" aria-label="Cost and Billing">
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
          <div className="mb-1 text-xs text-[var(--color-text-muted)]">14-Day Total</div>
          <div className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
            {formatCurrency(totalCost)}
          </div>
        </div>
        
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4">
          <div className="mb-1 text-xs text-[var(--color-text-muted)]">Avg Daily (14d)</div>
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
          <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
            {last7Avg > avgDailyCost ? '+' : ''}{((last7Avg / avgDailyCost - 1) * 100).toFixed(1)}% vs 14d avg
          </div>
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
      <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
        <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
          Daily Spend (Last 14 Days)
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
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
                dataKey="cost"
                name="Daily Cost"
                fill="var(--color-accent-cyan)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
      
      {/* Model breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Pie chart */}
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Cost by Model
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={modelData}
                  dataKey="cost"
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
            </ResponsiveContainer>
          </div>
        </section>
        
        {/* Model list */}
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
          <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
            Model Details
          </h3>
          <div className="space-y-3">
            {modelData.map((model) => (
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
                    {formatCurrency(model.cost)}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {model.percentage}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      
      {/* Budget warning placeholder */}
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
                className="underline hover:text-amber-200"
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
