/**
 * components/overview/MetricCards.tsx — Grid of metric cards with polling.
 */

import { useEffect, useState } from 'react';
import { Activity, Clock, Layers, Zap } from 'lucide-react';
import { getMetrics, getHealth } from '../../api/client';
import { useStore } from '../../store/useStore';
import { useToastStore } from '../../store/useToastStore';
import { formatUptime } from '../../utils/format';
import MetricCard from './MetricCard';
import type { HealthResponse } from '../../types';

export default function MetricCards() {
  const metrics = useStore((s) => s.metrics);
  const setMetrics = useStore((s) => s.setMetrics);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const addToast = useToastStore((t) => t.addToast);

  const fetchData = async () => {
    try {
      const [m, h] = await Promise.all([getMetrics(), getHealth()]);
      setMetrics(m);
      setHealth(h);
    } catch (e: unknown) {
      addToast('error', 'Failed to load metrics', e instanceof Error ? e.message : undefined);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, []);

  const activeSessions = metrics?.sessions.currently_active ?? health?.sessions.active ?? 0;
  const totalCreated = metrics?.sessions.total_created ?? health?.sessions.total ?? 0;
  const deliveryRate = metrics?.prompt_delivery.success_rate;
  const uptime = health?.uptime ?? metrics?.uptime ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
        label="Uptime"
        value={formatUptime(uptime)}
        icon={<Clock className="h-4 w-4" />}
      />
    </div>
  );
}
