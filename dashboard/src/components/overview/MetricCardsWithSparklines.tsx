/**
 * components/overview/MetricCardsWithSparklines.tsx — Metric cards with 7-day sparklines.
 * Wired to GET /v1/metrics/aggregate timeSeries (Issue #2803). // token-ok
 */

import { useState, useEffect, useCallback } from 'react';
import { SparklineCard } from '../shared/SparklineCard';
import { getMetricsAggregate } from '../../api/client';
import { formatCurrency } from '../../utils/formatNumber';

interface MetricCardsWithSparklinesProps {
  /** Override: pass pre-fetched counts to avoid extra API calls */
  activeSessionsCount?: number;
  completedSessionsCount?: number;
  avgDailyCost?: number;
  totalMessages?: number;
}

export function MetricCardsWithSparklines({
  activeSessionsCount,
  completedSessionsCount,
  avgDailyCost,
  totalMessages,
}: MetricCardsWithSparklinesProps) {
  const [sparkData, setSparkData] = useState<{
    sessions: Array<{ day: string; value: number }>;
    messages: Array<{ day: string; value: number }>;
    cost: Array<{ day: string; value: number }>;
    toolCalls: Array<{ day: string; value: number }>;
  }>({ sessions: [], messages: [], cost: [], toolCalls: [] });
  const [summary, setSummary] = useState<{
    totalSessions: number;
    totalMessages: number;
    totalCost: number;
    totalToolCalls: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      // Fetch last 7 days of aggregated metrics
      const from = new Date();
      from.setDate(from.getDate() - 7);
      const data = await getMetricsAggregate({
        from: from.toISOString(),
        groupBy: 'day',
      });

      const ts = data.timeSeries;

      // Map timeSeries to sparkline format
      const toSparkline = (key: 'sessions' | 'messages' | 'toolCalls' | 'tokenCostUsd') =>
        ts.map((point) => ({
          day: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          value: key === 'tokenCostUsd' ? parseFloat((point[key] ?? 0).toFixed(4)) : point[key] ?? 0,
        }));

      setSparkData({
        sessions: toSparkline('sessions'),
        messages: toSparkline('messages'),
        cost: toSparkline('tokenCostUsd'),
        toolCalls: toSparkline('toolCalls'),
      });

      setSummary({
        totalSessions: data.summary.totalSessions,
        totalMessages: data.summary.totalMessages,
        totalCost: data.summary.totalTokenCostUsd,
        totalToolCalls: data.summary.totalToolCalls,
      });
    } catch {
      // Silently fail — cards show zero state, no crash
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Use props if provided, otherwise use API data
  const activeCount = activeSessionsCount ?? summary?.totalSessions ?? 0;
  const completedCount = completedSessionsCount ?? summary?.totalSessions ?? 0;
  const dailyCost = avgDailyCost ?? (summary ? summary.totalCost / 7 : 0);
  const msgCount = totalMessages ?? summary?.totalMessages ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {activeCount > 0 && (
        <SparklineCard
          label="Active Sessions"
          value={activeCount}
          data={sparkData.sessions}
          color="var(--color-accent-cyan)"
        />
      )}

      {completedCount > 0 && (
        <SparklineCard
          label="Completed (7d)"
          value={completedCount}
          data={sparkData.sessions}
          color="var(--color-success)"
        />
      )}

      {dailyCost > 0 && (
        <SparklineCard
          label="Avg Daily Cost"
          value={formatCurrency(dailyCost)}
          data={sparkData.cost}
          color="var(--color-warning)"
        />
      )}

      {msgCount > 0 && (
        <SparklineCard
          label="Messages (7d)"
          value={msgCount}
          data={sparkData.messages}
          color="var(--color-accent-purple)"
        />
      )}
    </div>
  );
}
