/**
 * components/overview/MetricCards.tsx — Grid of metric cards with fallback polling.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, Clock, Layers, Zap } from 'lucide-react';
import { getMetrics, getHealth } from '../../api/client';
import { LatencyBarChart } from '../metrics/LatencyBarChart';
import { useStore } from '../../store/useStore';
import { useToastStore } from '../../store/useToastStore';
import type { HealthResponse } from '../../types';
import { formatLatencyMs, formatUptime } from '../../utils/format';
import MetricCard from './MetricCard';

const LATENCY_META = [
  { key: 'hook_latency_ms', label: 'Hook', color: '#00e5ff' },
  { key: 'state_change_detection_ms', label: 'State Change', color: '#7c82ff' },
  { key: 'permission_response_ms', label: 'Permission', color: '#ffaa00' },
  { key: 'channel_delivery_ms', label: 'Delivery', color: '#00ff88' },
] as const;

export default function MetricCards() {
  const metrics = useStore((s) => s.metrics);
  const sseConnected = useStore((s) => s.sseConnected);
  const setMetrics = useStore((s) => s.setMetrics);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [nextMetrics, nextHealth] = await Promise.all([getMetrics(), getHealth()]);
      setMetrics(nextMetrics);
      setHealth(nextHealth);
    } catch (e: unknown) {
      useToastStore.getState().addToast('error', 'Failed to load metrics', e instanceof Error ? e.message : undefined);
    }
  }, [setMetrics]);

  useEffect(() => {
    fetchData();

    if (sseConnected) {
      return;
    }

    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData, sseConnected]);

  const activeSessions = metrics?.sessions.currently_active ?? health?.sessions.active ?? 0;
  const totalCreated = metrics?.sessions.total_created ?? health?.sessions.total ?? 0;
  const deliveryRate = metrics?.prompt_delivery.success_rate;
  const uptime = health?.uptime ?? metrics?.uptime ?? 0;
  const delivered = metrics?.prompt_delivery.delivered ?? 0;
  const deliveryFailed = metrics?.prompt_delivery.failed ?? 0;
  const webhookFailures = metrics?.webhooks_failed ?? 0;
  const webhookSuccesses = Math.max((metrics?.webhooks_sent ?? 0) - webhookFailures, 0);
  const latencyItems = LATENCY_META.map(({ key, label, color }) => ({
    label,
    color,
    value: metrics?.latency[key].avg ?? null,
  }));
  const latencySummaries = LATENCY_META.map(({ key, label, color }) => ({
    label,
    color,
    stats: metrics?.latency[key],
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active Sessions"
          value={activeSessions}
          icon={<Activity className="h-4 w-4" />}
          detail={`${metrics?.sessions.completed ?? 0} completed / ${metrics?.sessions.failed ?? 0} failed`}
        />
        <MetricCard
          label="Total Created"
          value={totalCreated}
          icon={<Layers className="h-4 w-4" />}
          detail={`${metrics?.sessions.avg_messages_per_session ?? 0} avg messages/session`}
        />
        <MetricCard
          label="Prompt Delivery"
          value={deliveryRate !== null && deliveryRate !== undefined ? deliveryRate.toFixed(1) : '—'}
          suffix={deliveryRate !== null && deliveryRate !== undefined ? '%' : undefined}
          icon={<Zap className="h-4 w-4" />}
          detail={`${delivered} delivered / ${deliveryFailed} failed`}
        />
        <MetricCard
          label="Webhooks"
          value={metrics?.webhooks_sent ?? 0}
          icon={<CheckCircle2 className="h-4 w-4" />}
          detail={`${webhookSuccesses} ok / ${webhookFailures} failed`}
          valueClassName="font-mono text-2xl text-[#00ff88]"
        />
        <MetricCard
          label="Auto-approvals"
          value={metrics?.auto_approvals ?? 0}
          detail={`${metrics?.screenshots_taken ?? 0} screenshots captured`}
          valueClassName="font-mono text-2xl text-[#ffaa00]"
        />
        <MetricCard
          label="Pipelines"
          value={metrics?.pipelines_created ?? 0}
          detail={`${metrics?.batches_created ?? 0} batches created`}
        />
        <MetricCard
          label="Avg Session Duration"
          value={formatUptime(metrics?.sessions.avg_duration_sec ?? 0)}
          detail={`${metrics?.sessions.avg_messages_per_session ?? 0} avg messages/session`}
        />
        <MetricCard
          label="Uptime"
          value={formatUptime(uptime)}
          icon={<Clock className="h-4 w-4" />}
          detail={sseConnected ? 'Live via SSE' : 'Polling every 10s'}
        />
      </div>

      <div className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#e6e6ee]">Latency Comparison</h3>
            <p className="text-xs text-[#777]">Average rolling latency across all active session samples.</p>
          </div>
        </div>

        <LatencyBarChart
          ariaLabel="Global latency comparison"
          items={latencyItems}
          emptyText="Latency samples will appear after hooks, approvals, and deliveries are recorded."
          formatValue={formatLatencyMs}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {latencySummaries.map((item) => (
            <div key={item.label} className="rounded-lg border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#666]">{item.label}</div>
              <div className="mt-2 font-mono text-lg tabular-nums" style={{ color: item.color }}>
                {formatLatencyMs(item.stats?.avg ?? null)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[#888]">
                <span>min {formatLatencyMs(item.stats?.min ?? null)}</span>
                <span>max {formatLatencyMs(item.stats?.max ?? null)}</span>
                <span>samples</span>
                <span className="font-mono text-[#cfd2df]">{item.stats?.count ?? 0}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
