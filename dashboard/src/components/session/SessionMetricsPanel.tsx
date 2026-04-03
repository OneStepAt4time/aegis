import { LatencyBarChart } from '../metrics/LatencyBarChart';
import type { SessionLatencyResponse, SessionMetrics } from '../../types';
import { formatDuration, formatLatencyMs } from '../../utils/format';

interface SessionMetricsPanelProps {
  metrics: SessionMetrics | null;
  loading: boolean;
  latency: SessionLatencyResponse | null;
  latencyLoading: boolean;
}

interface MetricCardData {
  label: string;
  value: string;
  icon: string;
  color: string;
  detail?: string;
}

const LATENCY_META = [
  { key: 'hook_latency_ms', label: 'Hook', color: '#00e5ff' },
  { key: 'state_change_detection_ms', label: 'State Change', color: '#7c82ff' },
  { key: 'permission_response_ms', label: 'Permission', color: '#ffaa00' },
  { key: 'channel_delivery_ms', label: 'Channel Delivery', color: '#00ff88' },
] as const;

export function SessionMetricsPanel({ metrics, loading, latency, latencyLoading }: SessionMetricsPanelProps) {
  if ((loading && latencyLoading) || !metrics) {
    return (
      <div className="flex items-center justify-center h-48 text-[#555] text-sm animate-pulse">
        Loading metrics…
      </div>
    );
  }

  const cards: MetricCardData[] = [
    { label: 'Duration', value: formatDuration(metrics.durationSec * 1000), icon: '⏱', color: '#00e5ff' },
    { label: 'Messages', value: metrics.messages.toString(), icon: '💬', color: '#00e5ff' },
    { label: 'Tool Calls', value: metrics.toolCalls.toString(), icon: '🔧', color: '#00e5ff' },
    { label: 'Approvals', value: metrics.approvals.toString(), icon: '✅', color: '#00ff88' },
    { label: 'Auto-approvals', value: metrics.autoApprovals.toString(), icon: '⚡', color: '#ffaa00' },
    { label: 'Status Changes', value: metrics.statusChanges.length.toString(), icon: '🔄', color: '#8888ff' },
  ];
  const latencySnapshotCards: MetricCardData[] = [
    {
      label: 'Hook Latency',
      value: formatLatencyMs(latency?.realtime?.hook_latency_ms),
      icon: '🪝',
      color: '#00e5ff',
      detail: 'Latest hook-to-receive measurement',
    },
    {
      label: 'State Detection',
      value: formatLatencyMs(latency?.realtime?.state_change_detection_ms),
      icon: '👁',
      color: '#7c82ff',
      detail: 'Latest Claude state change detection',
    },
    {
      label: 'Permission Response',
      value: formatLatencyMs(latency?.realtime?.permission_response_ms),
      icon: '✋',
      color: '#ffaa00',
      detail: 'Latest prompt-to-decision response',
    },
    {
      label: 'Channel Delivery Avg',
      value: formatLatencyMs(latency?.aggregated?.channel_delivery_ms.avg ?? null),
      icon: '📡',
      color: '#00ff88',
      detail: `${latency?.aggregated?.channel_delivery_ms.count ?? 0} rolling samples`,
    },
  ];
  const latencyChartItems = LATENCY_META.map(({ key, label, color }) => ({
    label,
    color,
    value: latency?.aggregated?.[key]?.avg ?? null,
  }));
  const latencySummaries = LATENCY_META.map(({ key, label, color }) => ({
    label,
    color,
    stats: latency?.aggregated?.[key] ?? null,
  }));

  return (
    <div className="space-y-4">
      {/* Metric cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 transition-colors duration-150 hover:border-[#00e5ff]/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{card.icon}</span>
              <span className="text-[10px] text-[#888] uppercase tracking-wider">{card.label}</span>
            </div>
            <div
              className="text-2xl font-semibold font-mono tabular-nums"
              style={{ color: card.color }}
            >
              {card.value}
            </div>
            {card.detail ? <div className="mt-2 text-xs text-[#777]">{card.detail}</div> : null}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4">
        <div className="mb-3">
          <h3 className="text-xs text-[#888] uppercase tracking-wider">Latency Snapshot</h3>
          <p className="mt-1 text-xs text-[#666]">Realtime latency where available, plus delivery averages from the rolling session window.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {latencySnapshotCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-[#1a1a2e] bg-[#0a0a0f] p-4"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[#888]">
                <span className="text-sm">{card.icon}</span>
                <span>{card.label}</span>
              </div>
              <div className="mt-2 text-2xl font-semibold font-mono tabular-nums" style={{ color: card.color }}>
                {card.value}
              </div>
              <div className="mt-2 text-xs text-[#666]">{card.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4">
        <div className="mb-4">
          <h3 className="text-xs text-[#888] uppercase tracking-wider">Aggregated Latency</h3>
          <p className="mt-1 text-xs text-[#666]">Rolling min/max/average latency samples for this session.</p>
        </div>

        <LatencyBarChart
          ariaLabel="Session latency averages"
          items={latencyChartItems}
          emptyText="No latency samples yet for this session."
          formatValue={formatLatencyMs}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {latencySummaries.map((item) => (
            <div key={item.label} className="rounded-lg border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#666]">{item.label}</div>
              <div className="mt-2 font-mono text-lg tabular-nums" style={{ color: item.color }}>
                {formatLatencyMs(item.stats?.avg ?? null)}
              </div>
              <div className="mt-2 space-y-1 text-xs text-[#888]">
                <div className="flex items-center justify-between gap-3">
                  <span>min</span>
                  <span className="font-mono text-[#cfd2df]">{formatLatencyMs(item.stats?.min ?? null)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>max</span>
                  <span className="font-mono text-[#cfd2df]">{formatLatencyMs(item.stats?.max ?? null)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>samples</span>
                  <span className="font-mono text-[#cfd2df]">{item.stats?.count ?? 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Status changes timeline */}
      {metrics.statusChanges.length > 0 && (
        <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg p-4">
          <h3 className="text-xs text-[#888] uppercase tracking-wider mb-3">Status Changes</h3>
          <div className="flex flex-wrap gap-2">
            {metrics.statusChanges.map((change, i) => (
              <div
                key={i}
                className="text-xs font-mono text-[#555] bg-[#0a0a0f] px-2 py-1 rounded border border-[#1a1a2e]"
              >
                {change}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
