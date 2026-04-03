/**
 * components/overview/MetricCards.tsx — Grid of metric cards with polling.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, Layers, Orbit, Send, Webhook, Zap } from 'lucide-react';
import { getMetrics, getHealth } from '../../api/client';
import { useStore } from '../../store/useStore';
import { useToastStore } from '../../store/useToastStore';
import { appendDeliveryRateSample, buildMetricsOverviewModel } from '../../utils/metricsOverview';
import MetricCard from './MetricCard';
import type { HealthResponse } from '../../types';

interface MetricsDetailPanelProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  stats: Array<{
    label: string;
    value: string;
    tone?: 'default' | 'success' | 'warning' | 'danger';
  }>;
  children?: React.ReactNode;
}

function detailToneClass(tone?: 'default' | 'success' | 'warning' | 'danger'): string {
  if (tone === 'success') return 'text-emerald-300';
  if (tone === 'warning') return 'text-amber-300';
  if (tone === 'danger') return 'text-rose-300';
  return 'text-[#f4f7fb]';
}

function MetricsDetailPanel({ title, icon, description, stats, children }: MetricsDetailPanelProps) {
  return (
    <section className="rounded-xl border border-void-lighter bg-[#111118] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-[#d8d8df]">
            <span className="text-[#00e5ff]">{icon}</span>
            {title}
          </div>
          <p className="mt-1 text-xs text-[#7f8192]">{description}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat) => (
          <div key={`${title}-${stat.label}`} className="rounded-lg border border-white/5 bg-black/10 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[#6e7387]">{stat.label}</div>
            <div className={`mt-1 font-mono text-lg ${detailToneClass(stat.tone)}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function DeliveryRateTrend({ values }: { values: number[] }) {
  if (values.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-xs text-[#6e7387]">
        Trend appears after a few metric refreshes.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-[#6e7387]">
        <span>Delivery Trend</span>
        <span>{values.length} samples</span>
      </div>
      <div aria-label="Delivery rate trend" className="flex h-20 items-end gap-1 rounded-lg border border-white/5 bg-black/10 px-3 py-3">
        {values.map((value, index) => {
          const height = Math.max(10, Math.round((value / 100) * 52));
          return (
            <div key={`delivery-rate-${index}`} className="flex min-w-0 flex-1 flex-col items-center justify-end">
              <div
                data-testid="delivery-rate-bar"
                className="w-full rounded-t bg-gradient-to-t from-[#0ea5e9] via-[#22d3ee] to-[#a7f3d0]"
                style={{ height: `${height}px` }}
                title={`${value.toFixed(1)}%`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MetricCards() {
  const metrics = useStore((s) => s.metrics);
  const setMetrics = useStore((s) => s.setMetrics);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [deliveryRateTrend, setDeliveryRateTrend] = useState<number[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [m, h] = await Promise.all([getMetrics(), getHealth()]);
      setMetrics(m);
      setHealth(h);
      setDeliveryRateTrend((currentTrend) => appendDeliveryRateSample(currentTrend, m.prompt_delivery.success_rate));
    } catch (e: unknown) {
      useToastStore.getState().addToast('error', 'Failed to load metrics', e instanceof Error ? e.message : undefined);
    }
  }, [setMetrics, setHealth]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const model = buildMetricsOverviewModel(metrics, health, deliveryRateTrend);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label={model.summaryCards[0].label}
          value={model.summaryCards[0].value}
          icon={<Activity className="h-4 w-4" />}
          suffix={model.summaryCards[0].suffix}
        />
        <MetricCard
          label={model.summaryCards[1].label}
          value={model.summaryCards[1].value}
          icon={<Layers className="h-4 w-4" />}
          suffix={model.summaryCards[1].suffix}
        />
        <MetricCard
          label={model.summaryCards[2].label}
          value={model.summaryCards[2].value}
          icon={<Zap className="h-4 w-4" />}
          suffix={model.summaryCards[2].suffix}
        />
        <MetricCard
          label={model.summaryCards[3].label}
          value={model.summaryCards[3].value}
          icon={<Clock className="h-4 w-4" />}
          suffix={model.summaryCards[3].suffix}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <MetricsDetailPanel
          title="Prompt Delivery"
          icon={<Send className="h-4 w-4" />}
          description="Success and failure signals from the prompt delivery pipeline."
          stats={model.promptDelivery}
        >
          <DeliveryRateTrend values={model.deliveryRateTrend} />
        </MetricsDetailPanel>

        <MetricsDetailPanel
          title="Webhooks"
          icon={<Webhook className="h-4 w-4" />}
          description="Outbound webhook reliability and failure pressure."
          stats={model.webhooks}
        />

        <MetricsDetailPanel
          title="Automation"
          icon={<Orbit className="h-4 w-4" />}
          description="Auto-approvals and workflow creation volume across the system."
          stats={model.automation}
        />
      </div>
    </div>
  );
}
