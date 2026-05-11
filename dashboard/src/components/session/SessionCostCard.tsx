/**
 * SessionCostCard.tsx — Per-session real-time cost tracking card.
 *
 * Displays running token and cost totals for a single session.
 * Part of issue #3125: Budget Alerts & Cost Forecasts.
 */

import { DollarSign, Coins } from 'lucide-react';
import { formatCurrency } from '../../utils/formatNumber';
import { formatNumber } from '../../utils/formatNumber';

export interface SessionCostCardProps {
  /** Total input tokens. */
  inputTokens: number;
  /** Total output tokens. */
  outputTokens: number;
  /** Total cache creation tokens. */
  cacheCreationTokens: number;
  /** Total cache read tokens. */
  cacheReadTokens: number;
  /** Estimated total cost in USD. */
  estimatedCostUsd: number;
}

export function SessionCostCard({
  inputTokens,
  outputTokens,
  cacheCreationTokens,
  cacheReadTokens,
  estimatedCostUsd,
}: SessionCostCardProps) {
  const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;

  return (
    <div
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4"
      aria-label={`Session cost: ${formatCurrency(estimatedCostUsd)}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="h-4 w-4 text-[var(--color-accent-cyan)]" />
        <h4 className="text-sm font-medium text-[var(--color-text-primary)]">Session Cost</h4>
      </div>

      {/* Total cost */}
      <div className="mb-3">
        <p className="text-2xl font-bold font-mono text-[var(--color-text-primary)]">
          {formatCurrency(estimatedCostUsd)}
        </p>
      </div>

      {/* Token breakdown */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Input</p>
          <p className="text-sm font-mono text-[var(--color-text-primary)]">{formatNumber(inputTokens)}</p>
        </div>
        <div className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Output</p>
          <p className="text-sm font-mono text-[var(--color-text-primary)]">{formatNumber(outputTokens)}</p>
        </div>
        <div className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Cache Create</p>
          <p className="text-sm font-mono text-[var(--color-text-primary)]">{formatNumber(cacheCreationTokens)}</p>
        </div>
        <div className="rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50 p-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">Cache Read</p>
          <p className="text-sm font-mono text-[var(--color-text-primary)]">{formatNumber(cacheReadTokens)}</p>
        </div>
      </div>

      {/* Total tokens */}
      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <Coins className="h-3 w-3" />
        <span>{formatNumber(totalTokens)} total tokens</span>
      </div>
    </div>
  );
}
