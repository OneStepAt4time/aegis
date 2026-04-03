import type { SessionLatency } from '../../types';

interface LatencyPanelProps {
  latency: SessionLatency | null;
  loading: boolean;
}

interface LatencyCard {
  label: string;
  latest: number | null;
  avg: number | null;
  max: number | null;
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
      <div className="flex items-center justify-center h-36 text-[#555] text-sm animate-pulse">
        Loading latency metrics...
      </div>
    );
  }

  if (!latency || !latency.aggregated) {
    return (
      <div className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 text-sm text-[#888]">
        No latency samples yet.
      </div>
    );
  }

  const cards: LatencyCard[] = [
    {
      label: 'State Change Detection',
      latest: latency.realtime?.state_change_detection_ms ?? null,
      avg: latency.aggregated.state_change_detection_ms.avg,
      max: latency.aggregated.state_change_detection_ms.max,
      count: latency.aggregated.state_change_detection_ms.count,
    },
    {
      label: 'Channel Delivery',
      latest: null,
      avg: latency.aggregated.channel_delivery_ms.avg,
      max: latency.aggregated.channel_delivery_ms.max,
      count: latency.aggregated.channel_delivery_ms.count,
    },
    {
      label: 'Permission Response',
      latest: latency.realtime?.permission_response_ms ?? null,
      avg: latency.aggregated.permission_response_ms.avg,
      max: latency.aggregated.permission_response_ms.max,
      count: latency.aggregated.permission_response_ms.count,
    },
    {
      label: 'Hook Processing',
      latest: latency.realtime?.hook_latency_ms ?? null,
      avg: latency.aggregated.hook_latency_ms.avg,
      max: latency.aggregated.hook_latency_ms.max,
      count: latency.aggregated.hook_latency_ms.count,
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-xs text-[#888] uppercase tracking-wider">Latency</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4"
          >
            <div className="flex items-center justify-between text-xs text-[#888] uppercase tracking-wider">
              <span>{card.label}</span>
              <span>{card.count} sample{card.count === 1 ? '' : 's'}</span>
            </div>

            <div className="mt-3 h-1.5 rounded bg-[#1a1a2e] overflow-hidden">
              <div className="h-full bg-[#00e5ff]/70 transition-all duration-300" style={{ width: barWidth(card.avg) }} />
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-xs font-mono text-[#bbb]">
              <div>
                <div className="text-[#666] mb-1">Latest</div>
                <div className="text-[#00e5ff]">{formatMs(card.latest)}</div>
              </div>
              <div>
                <div className="text-[#666] mb-1">Avg</div>
                <div className="text-[#00ff88]">{formatMs(card.avg)}</div>
              </div>
              <div>
                <div className="text-[#666] mb-1">Max</div>
                <div className="text-[#ffaa00]">{formatMs(card.max)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}