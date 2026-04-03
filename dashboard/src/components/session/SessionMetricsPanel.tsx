import type { SessionMetrics } from '../../types';
import { formatDuration } from '../../utils/format';

interface SessionMetricsPanelProps {
  metrics: SessionMetrics | null;
  loading: boolean;
}

interface MetricCardData {
  label: string;
  value: string;
  icon: string;
  color: string;
}

export function SessionMetricsPanel({ metrics, loading }: SessionMetricsPanelProps) {
  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-48 text-[#555] text-sm animate-pulse">
        Loading metricsâ€¦
      </div>
    );
  }

  const cards: MetricCardData[] = [
    { label: 'Duration', value: formatDuration(metrics.durationSec * 1000), icon: 'â±', color: '#3b82f6' },
    { label: 'Messages', value: metrics.messages.toString(), icon: 'ðŸ’¬', color: '#3b82f6' },
    { label: 'Tool Calls', value: metrics.toolCalls.toString(), icon: 'ðŸ”§', color: '#3b82f6' },
    { label: 'Approvals', value: metrics.approvals.toString(), icon: 'âœ…', color: '#10b981' },
    { label: 'Auto-approvals', value: metrics.autoApprovals.toString(), icon: 'âš¡', color: '#f59e0b' },
    { label: 'Status Changes', value: metrics.statusChanges.length.toString(), icon: 'ðŸ”„', color: '#8888ff' },
  ];

  return (
    <div className="space-y-4">
      {/* Metric cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 transition-colors duration-150 hover:border-[#3b82f6]/30"
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
          </div>
        ))}
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

