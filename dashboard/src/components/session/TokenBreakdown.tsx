/**
 * TokenBreakdown — Colored token usage bars for session metrics.
 */

interface TokenBreakdownProps {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheCreationTokens?: number | null;
  cacheReadTokens?: number | null;
  estimatedCostUsd?: number | null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function TokenBreakdown(props: TokenBreakdownProps) {
  const inputTokens = props.inputTokens ?? 0;
  const outputTokens = props.outputTokens ?? 0;
  const cacheCreationTokens = props.cacheCreationTokens ?? 0;
  const cacheReadTokens = props.cacheReadTokens ?? 0;
  const estimatedCostUsd = props.estimatedCostUsd ?? null;

  const total = Math.max(inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens, 1);

  const bars = [
    { label: 'Input', value: inputTokens, color: '#3b82f6' },
    { label: 'Output', value: outputTokens, color: '#10b981' },
    { label: 'Cache Create', value: cacheCreationTokens, color: '#f59e0b' },
    { label: 'Cache Read', value: cacheReadTokens, color: '#a855f7' },
  ];

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-[#1a1a2e]">
        {bars.map(bar => (
          <div
            key={bar.label}
            style={{
              width: `${(bar.value / total) * 100}%`,
              backgroundColor: bar.color,
              minWidth: bar.value > 0 ? 2 : 0,
            }}
            title={`${bar.label}: ${formatTokens(bar.value)}`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {bars.map(bar => (
          <div key={bar.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: bar.color }}
            />
            <span className="text-[#888]">{bar.label}</span>
            <span className="text-[#ccc] font-mono">{formatTokens(bar.value)}</span>
          </div>
        ))}
        {estimatedCostUsd != null && (
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[#888]">Cost</span>
            <span className="text-[#00e5ff] font-mono">
              ${estimatedCostUsd < 0.01 ? estimatedCostUsd.toFixed(4) : estimatedCostUsd.toFixed(3)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
