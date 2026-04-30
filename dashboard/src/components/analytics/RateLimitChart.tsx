/**
 * components/analytics/RateLimitChart.tsx — Per-key quota usage bars (Issue #2283).
 *
 * Bar chart showing sessions, tokens, and spend usage per API key
 * with color-coded thresholds: <66% cyan, 66-90% amber, >90% red.
 */

import {
  BarChart,
  Bar,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import type { RateLimitKeyUsage } from '../../types';

/** Color thresholds matching the plan spec. */
const COLOR_CYAN = '#06b6d4';
const COLOR_AMBER = '#f59e0b';
const COLOR_RED = '#ef4444';

export function barColor(ratio: number): string {
  if (ratio >= 0.9) return COLOR_RED;
  if (ratio >= 0.66) return COLOR_AMBER;
  return COLOR_CYAN;
}

export interface RateLimitChartProps {
  perKey: RateLimitKeyUsage[];
}

interface ChartRow {
  name: string;
  sessions: number;
  sessionsMax: number | null;
  tokens: number;
  tokensMax: number | null;
  spend: number;
  spendMax: number | null;
  sessionRatio: number;
  tokenRatio: number;
  spendRatio: number;
}

function toChartRows(perKey: RateLimitKeyUsage[]): ChartRow[] {
  return perKey.map((k) => {
    const sr = k.maxSessions != null && k.maxSessions > 0 ? k.activeSessions / k.maxSessions : 0;
    const tr = k.maxTokens != null && k.maxTokens > 0 ? k.tokensInWindow / k.maxTokens : 0;
    const spr = k.maxSpendUsd != null && k.maxSpendUsd > 0 ? k.spendInWindowUsd / k.maxSpendUsd : 0;
    return {
      name: k.keyName,
      sessions: k.activeSessions,
      sessionsMax: k.maxSessions,
      tokens: k.tokensInWindow,
      tokensMax: k.maxTokens,
      spend: k.spendInWindowUsd,
      spendMax: k.maxSpendUsd,
      sessionRatio: sr,
      tokenRatio: tr,
      spendRatio: spr,
    };
  });
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload?: ChartRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl" role="tooltip">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-primary)]">{label}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-[var(--color-text-muted)]">Sessions:</span>
          <span className="font-mono text-[var(--color-text-primary)]">
            {row.sessions}{row.sessionsMax != null ? ` / ${row.sessionsMax}` : ''}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-[var(--color-text-muted)]">Tokens:</span>
          <span className="font-mono text-[var(--color-text-primary)]">
            {formatTokenCount(row.tokens)}{row.tokensMax != null ? ` / ${formatTokenCount(row.tokensMax)}` : ''}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-[var(--color-text-muted)]">Spend:</span>
          <span className="font-mono text-[var(--color-text-primary)]">
            {formatUsd(row.spend)}{row.spendMax != null ? ` / ${formatUsd(row.spendMax)}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export function RateLimitChart({ perKey }: RateLimitChartProps) {
  if (perKey.length === 0) {
    return (
      <div
        className="flex h-[200px] items-center justify-center text-sm text-[var(--color-text-muted)]"
        role="status"
        aria-label="No rate-limit data"
      >
        No rate-limit data available
      </div>
    );
  }

  const data = toChartRows(perKey);

  return (
    <section
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5"
      aria-label="Rate-limit usage chart"
      role="region"
    >
      <h3 className="mb-4 text-lg font-medium text-[var(--color-text-primary)]">
        Per-Key Rate-Limit Usage
      </h3>

      {/* Dimension legend */}
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_CYAN }} />
          Sessions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_AMBER }} />
          Tokens
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLOR_RED }} />
          Spend
        </span>
      </div>

      {/* Bar chart — shows max session ratio as the primary bar */}
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 60)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 0, right: 20, top: 5, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-void-lighter)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            stroke="var(--color-void-lighter)"
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: 'var(--color-text-primary)', fontSize: 12 }}
            stroke="var(--color-void-lighter)"
            width={100}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="sessionRatio"
            name="Sessions"
            radius={[0, 4, 4, 0]}
            aria-label="Session usage"
          >
            {data.map((row, i) => (
              <Cell key={`s-${i}`} fill={barColor(row.sessionRatio)} />
            ))}
          </Bar>
          <Bar
            dataKey="tokenRatio"
            name="Tokens"
            radius={[0, 4, 4, 0]}
            aria-label="Token usage"
          >
            {data.map((row, i) => (
              <Cell key={`t-${i}`} fill={barColor(row.tokenRatio)} />
            ))}
          </Bar>
          <Bar
            dataKey="spendRatio"
            name="Spend"
            radius={[0, 4, 4, 0]}
            aria-label="Spend usage"
          >
            {data.map((row, i) => (
              <Cell key={`sp-${i}`} fill={barColor(row.spendRatio)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
