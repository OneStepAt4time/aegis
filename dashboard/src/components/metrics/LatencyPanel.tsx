import type { SessionLatency } from '../../types';
import { Icon } from '../Icon';

interface LatencyPanelProps {
  latency: SessionLatency | null;
  loading: boolean;
}

interface LatencyItem {
  label: string;
  icon: 'Zap' | 'Shield' | 'Wifi';
  avg: number | null;
  latest: number | null;
  count: number;
}

function formatMs(value: number | null): string {
  if (value === null) return '--';
  return `${Math.round(value)} ms`;
}

function barWidth(avg: number | null): string {
  if (avg === null) return '0%';
  const clamped = Math.min(100, Math.round((avg / 500) * 100));
  return `${clamped}%`;
}

export function LatencyPanel({ latency, loading }: LatencyPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-36 text-[var(--color-text-muted)] text-sm animate-pulse">
        Loading latency metrics...
      </div>
    );
  }

  if (!latency || !latency.aggregated) {
    return (
      <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="Gauge" size={16} className="text-[var(--color-text-muted)]" />
          <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Latency</h3>
        </div>
        <div className="text-sm text-[var(--color-text-muted)] animate-pulse">
          Waiting for samples…
        </div>
      </div>
    );
  }

  const items: LatencyItem[] = [
    {
      label: 'Hook',
      icon: 'Zap',
      avg: latency.aggregated.hook_latency_ms.avg,
      latest: latency.realtime?.hook_latency_ms ?? null,
      count: latency.aggregated.hook_latency_ms.count,
    },
    {
      label: 'Permission',
      icon: 'Shield',
      avg: latency.aggregated.permission_response_ms.avg,
      latest: latency.realtime?.permission_response_ms ?? null,
      count: latency.aggregated.permission_response_ms.count,
    },
    {
      label: 'WS',
      icon: 'Wifi',
      avg: latency.aggregated.channel_delivery_ms.avg,
      latest: null,
      count: latency.aggregated.channel_delivery_ms.count,
    },
  ];

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="Gauge" size={16} className="text-[var(--color-text-muted)]" />
        <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Latency</h3>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {items.map(item => (
          <div key={item.label}>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[var(--color-accent-cyan)] flex items-center">
                <Icon name={item.icon} size={12} />
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
                {item.label}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
                {item.count}×
              </span>
            </div>

            <div className="h-1 rounded-full bg-[var(--color-void-lighter)] overflow-hidden mb-2">
              <div
                className="h-full bg-[var(--color-accent-cyan)] transition-all"
                style={{
                  width: barWidth(item.avg),
                  transition: 'width var(--duration-slow) var(--ease-decelerate)',
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-1 text-[10px] font-mono">
              <div>
                <div className="text-[var(--color-text-muted)] mb-0.5">Latest</div>
                <div className="text-[var(--color-accent-cyan)]">{formatMs(item.latest)}</div>
              </div>
              <div>
                <div className="text-[var(--color-text-muted)] mb-0.5">Avg</div>
                <div className="text-[var(--color-text-primary)]">{formatMs(item.avg)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}