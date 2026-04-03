/**
 * components/overview/MetricCards.tsx — Grid of metric cards with fallback polling.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, Layers, Zap } from 'lucide-react';
import { getHealth, getMetrics } from '../../api/client';
import { useStore } from '../../store/useStore';
import { useToastStore } from '../../store/useToastStore';
import type { HealthResponse } from '../../types';
import { formatUptime } from '../../utils/format';
import MetricCard from './MetricCard';

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
  const hookLatency = metrics?.latency?.hook_latency_ms.avg ?? null;
  const permissionLatency = metrics?.latency?.permission_response_ms.avg ?? null;
  const channelLatency = metrics?.latency?.channel_delivery_ms.avg ?? null;

  const formatLatency = (value: number | null): string => (value === null ? '—' : `${Math.round(value)} ms`);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      <MetricCard
        label="Active Sessions"
        value={activeSessions}
        icon={<Activity className="h-4 w-4" />}
      />
      <MetricCard
        label="Total Created"
        value={totalCreated}
        icon={<Layers className="h-4 w-4" />}
      />
      <MetricCard
        label="Delivery Rate"
        value={deliveryRate !== null && deliveryRate !== undefined ? deliveryRate.toFixed(1) : '—'}
        suffix="%"
        icon={<Zap className="h-4 w-4" />}
      />
      <MetricCard
        label="Avg Hook Latency"
        value={formatLatency(hookLatency)}
        icon={<Clock className="h-4 w-4" />}
      />
      <MetricCard
        label="Avg Permission Latency"
        value={formatLatency(permissionLatency)}
        icon={<Clock className="h-4 w-4" />}
      />
      <MetricCard
        label="Avg Channel Latency"
        value={formatLatency(channelLatency)}
        icon={<Clock className="h-4 w-4" />}
      />
      <MetricCard
        label="Uptime"
        value={formatUptime(uptime)}
        icon={<Clock className="h-4 w-4" />}
      />
    </div>
  );
}
