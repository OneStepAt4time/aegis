interface LatencyBarDatum {
  label: string;
  value: number | null | undefined;
  color: string;
}

interface LatencyBarChartProps {
  ariaLabel: string;
  items: LatencyBarDatum[];
  emptyText?: string;
  formatValue?: (value: number) => string;
}

function defaultFormatter(value: number): string {
  return `${Math.round(value)} ms`;
}

export function LatencyBarChart({
  ariaLabel,
  items,
  emptyText = 'No latency samples yet.',
  formatValue = defaultFormatter,
}: LatencyBarChartProps) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined);

  if (visibleItems.length === 0) {
    return (
      <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-[#1a1a2e] bg-[#0a0a0f] text-sm text-[#666]">
        {emptyText}
      </div>
    );
  }

  const maxValue = Math.max(...visibleItems.map((item) => item.value ?? 0), 1);

  return (
    <div role="img" aria-label={ariaLabel} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => {
        const hasValue = item.value !== null && item.value !== undefined;
        const height = hasValue ? Math.max(((item.value ?? 0) / maxValue) * 100, 12) : 0;

        return (
          <div key={item.label} className="rounded-lg border border-[#1a1a2e] bg-[#0a0a0f] p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#666]">{item.label}</div>
            <div className="mt-1 h-5 font-mono text-sm tabular-nums text-[#d7d7df]">
              {hasValue ? formatValue(item.value ?? 0) : '—'}
            </div>
            <div className="mt-3 flex h-24 items-end rounded-md bg-[#111118] px-2 pb-2 pt-1">
              <div
                className="w-full rounded-sm transition-all duration-300"
                style={{
                  height: `${height}%`,
                  background: `linear-gradient(180deg, ${item.color}, ${item.color}55)`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}