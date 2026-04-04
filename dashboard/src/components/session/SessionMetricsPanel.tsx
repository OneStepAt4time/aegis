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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function SessionMetricsPanel({ metrics, loading }: SessionMetricsPanelProps) {
  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-48 text-[#555] text-sm animate-pulse">
        Loading metrics...
      </div>
    );
  }

  const cards: MetricCardData[] = [
    { label: 'Duration', value: formatDuration(metrics.durationSec * 1000), icon: '\u23f1', color: '#3b82f6' },
    { label: 'Messages', value: metrics.messages.toString(), icon: '\ud83d\udcac', color: '#3b82f6' },
    { label: 'Tool Calls', value: metrics.toolCalls.toString(), icon: '\ud83d\udd27', color: '#3b82f6' },
    { label: 'Approvals', value: metrics.approvals.toString(), icon: '\u2705', color: '#10b981' },
    { label: 'Auto-approvals', value: metrics.autoApprovals.toString(), icon: '\u26a1', color: '#f59e0b' },
    { label: 'Status Changes', value: metrics.statusChanges.length.toString(), icon: '\ud83d\udd04', color: '#8888ff' },
  ];

  const tu = metrics.tokenUsage;

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

      {/* Issue #488: Token usage + cost panel */}
      {tu && (
        <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg p-4">
          <h3 className="text-xs text-[#888] uppercase tracking-wider mb-3">Token Usage</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="text-[10px] text-[#888] uppercase tracking-wider mb-1">Input</div>
              <div className="text-lg font-mono font-semibold text-[#3b82f6]">{formatTokens(tu.inputTokens)}</div>
            </div>
            <div className="rounded border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="text-[10px] text-[#888] uppercase tracking-wider mb-1">Output</div>
              <div className="text-lg font-mono font-semibold text-[#10b981]">{formatTokens(tu.outputTokens)}</div>
            </div>
            <div className="rounded border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="text-[10px] text-[#888] uppercase tracking-wider mb-1">Cache Write</div>
              <div className="text-lg font-mono font-semibold text-[#f59e0b]">{formatTokens(tu.cacheCreationTokens)}</div>
            </div>
            <div className="rounded border border-[#1a1a2e] bg-[#0a0a0f] p-3">
              <div className="text-[10px] text-[#888] uppercase tracking-wider mb-1">Cache Read</div>
              <div className="text-lg font-mono font-semibold text-[#f59e0b]">{formatTokens(tu.cacheReadTokens)}</div>
            </div>
            <div className="rounded border border-[#1a1a2e] bg-[#001a1f] p-3">
              <div className="text-[10px] text-[#888] uppercase tracking-wider mb-1">Est. Cost</div>
              <div className="text-lg font-mono font-semibold text-[#00e5ff]">
                {`$${tu.estimatedCostUsd < 0.01 ? tu.estimatedCostUsd.toFixed(4) : tu.estimatedCostUsd.toFixed(3)}`}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-[#444]">
            Cost estimate uses Anthropic list prices (sonnet tier by default). Actual cost may vary by model and plan.
          </div>
        </div>
      )}

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