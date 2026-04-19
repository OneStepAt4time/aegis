import type { SessionMetrics } from '../../types';
import { formatDuration } from '../../utils/format';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';

interface SessionMetricsPanelProps {
  metrics: SessionMetrics | null;
  loading: boolean;
}

interface StatCard {
  label: string;
  value: string;
  icon: IconName;
  colorVar: string;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCost(usd: number): string {
  if (usd < 0.005) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function SessionMetricsPanel({ metrics, loading }: SessionMetricsPanelProps) {
  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)] text-sm animate-pulse">
        Loading metrics...
      </div>
    );
  }

  const tu = metrics.tokenUsage;
  const totalTokens = tu
    ? tu.inputTokens + tu.outputTokens + tu.cacheCreationTokens + tu.cacheReadTokens
    : 0;
  const maxRow = tu
    ? Math.max(tu.inputTokens, tu.outputTokens, tu.cacheCreationTokens, tu.cacheReadTokens, 1)
    : 1;

  const tokenRows = tu
    ? [
        { label: 'Input', value: tu.inputTokens, colorVar: 'var(--color-accent)' },
        { label: 'Output', value: tu.outputTokens, colorVar: 'var(--color-success)' },
        { label: 'Cache Create', value: tu.cacheCreationTokens, colorVar: 'var(--color-warning)' },
        { label: 'Cache Read', value: tu.cacheReadTokens, colorVar: 'var(--color-metrics-purple)' },
      ]
    : [];

  const statCards: StatCard[] = [
    { label: 'Duration', value: formatDuration(metrics.durationSec * 1000), icon: 'Clock', colorVar: 'var(--color-accent)' },
    { label: 'Messages', value: metrics.messages.toString(), icon: 'MessageSquare', colorVar: 'var(--color-accent)' },
    { label: 'Tool Calls', value: metrics.toolCalls.toString(), icon: 'Wrench', colorVar: 'var(--color-accent)' },
    { label: 'Approvals', value: metrics.approvals.toString(), icon: 'CheckCircle', colorVar: 'var(--color-success)' },
    { label: 'Auto-approvals', value: metrics.autoApprovals.toString(), icon: 'Zap', colorVar: 'var(--color-warning)' },
    { label: 'Status Changes', value: metrics.statusChanges.length.toString(), icon: 'RefreshCw', colorVar: 'var(--color-metrics-purple)' },
  ];

  return (
    <div className="space-y-4">
      {/* ── Cost hero ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="DollarSign" size={16} className="text-[var(--color-accent-cyan)]" />
          <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
            Estimated Cost
          </span>
        </div>

        {tu ? (
          <>
            <div
              className="text-4xl font-semibold font-mono tabular-nums text-[var(--color-accent-cyan)]"
              style={{ transition: 'all var(--duration-base) var(--ease-standard)' }}
              title={`$${tu.estimatedCostUsd.toFixed(6)}`}
            >
              {formatCost(tu.estimatedCostUsd)}
            </div>
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)] flex flex-wrap items-center gap-2">
              <span>{totalTokens.toLocaleString()} tokens total</span>
              {tu.estimatedCostUsd > 0.5 && (
                <span className="text-[var(--color-warning)]">· consider a cheaper model</span>
              )}
            </div>
          </>
        ) : (
          <div className="text-2xl font-mono text-[var(--color-text-muted)]">—</div>
        )}
      </div>

      {/* ── Stat cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {statCards.map(card => (
          <div
            key={card.label}
            className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4"
            style={{ transition: 'border-color var(--duration-fast)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span style={{ color: card.colorVar }} className="shrink-0 flex items-center">
                <Icon name={card.icon} size={16} />
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider leading-tight">
                {card.label}
              </span>
            </div>
            <div
              className="text-2xl font-semibold font-mono tabular-nums"
              style={{
                color: card.colorVar,
                transition: 'color var(--duration-base) var(--ease-standard)',
              }}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Token usage table ─────────────────────────────────────── */}
      {tu && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="Layers" size={16} className="text-[var(--color-text-muted)]" />
            <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
              Token Usage
            </h3>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="text-left pb-2 font-normal text-[var(--color-text-muted)] uppercase tracking-wider">
                  Type
                </th>
                <th className="pb-2 w-1/2" />
                <th className="text-right pb-2 font-normal font-mono text-[var(--color-text-muted)] uppercase tracking-wider">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {tokenRows.map(row => (
                <tr key={row.label} className="border-t border-[var(--color-void-lighter)]">
                  <td className="py-2 pr-3 text-[var(--color-text-muted)]">{row.label}</td>
                  <td className="py-2 pr-3">
                    <div className="h-1.5 rounded-full bg-[var(--color-void-lighter)] overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(row.value / maxRow) * 100}%`,
                          backgroundColor: row.colorVar,
                          transition: 'width var(--duration-slow) var(--ease-decelerate)',
                        }}
                      />
                    </div>
                  </td>
                  <td
                    className="py-2 text-right font-mono tabular-nums text-[var(--color-text-primary)]"
                    style={{ transition: 'all var(--duration-base) var(--ease-standard)' }}
                  >
                    {formatTokenCount(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
            Cost uses Anthropic list prices (sonnet tier by default). Actual cost may vary.
          </div>
        </div>
      )}

      {/* ── Status changes timeline ───────────────────────────────── */}
      {metrics.statusChanges.length > 0 && (
        <div className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="Activity" size={16} className="text-[var(--color-text-muted)]" />
            <h3 className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
              Timeline
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {metrics.statusChanges.map((change, i) => (
              <div
                key={i}
                className="text-xs font-mono text-[var(--color-text-muted)] bg-[var(--color-void)] px-2 py-1 rounded border border-[var(--color-void-lighter)]"
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
