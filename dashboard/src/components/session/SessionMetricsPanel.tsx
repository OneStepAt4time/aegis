/**
 * components/session/SessionMetricsPanel.tsx — Cost + counts + tokens.
 *
 * Issue 04 of the `session-cockpit` epic. See
 * `.claude/epics/session-cockpit/epic.md`.
 *
 * Layout (top → bottom):
 *   1. Cost hero with condensed KPI banner underneath
 *   2. Token usage table (unchanged from prior iteration)
 *
 * Counts (`messages`, `toolCalls`, `approvals`) are derived from
 * `useSessionEvents` — the same event array the transcript renders.
 * This makes the "MESSAGES: 0 next to 118K tokens" contradiction
 * impossible.
 *
 * Timeline heatmap + rate-limit card + per-model accents live in
 * follow-up PRs (issues 04.6, 04.8, 04.9 of the epic).
 */

import { useReducedMotion } from 'framer-motion';
import { useSessionEvents } from '../../hooks/useSessionEvents';
import { formatDuration } from '../../utils/format';
import { Icon } from '../Icon';
import { AnimatedNumber } from '../shared/AnimatedNumber';
import { TimelineSparkline } from './TimelineSparkline';
import { RateLimitCard } from './RateLimitCard';

// Issue 04.8: rate-limit card sits behind a feature flag until a
// provider adapter starts forwarding `x-ratelimit-*` headers. Off
// by default in production — turn on via `VITE_ENABLE_RATE_LIMIT_CARD=true`.
const RATE_LIMIT_CARD_ENABLED =
  typeof import.meta !== 'undefined' &&
  (import.meta as { env?: Record<string, string> }).env?.VITE_ENABLE_RATE_LIMIT_CARD === 'true';

interface SessionMetricsPanelProps {
  sessionId: string;
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

interface BannerCellProps {
  label: string;
  /** Prefer numericValue for integer counters — it live-tweens via
   *  AnimatedNumber. `value` is a pre-formatted string used for
   *  non-numeric cells (duration, model name). */
  numericValue?: number;
  value?: string;
  title?: string;
  /** When false (the default), `numericValue` cells are rendered
   *  statically. Callers set this on the counters that change in
   *  real time. */
  animate?: boolean;
}

function BannerCell({ label, numericValue, value, title, animate }: BannerCellProps) {
  return (
    <div className="flex flex-col items-start" title={title}>
      <span className="text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="font-mono tabular-nums text-sm text-[var(--color-text-primary)]">
        {typeof numericValue === 'number'
          ? animate
            ? <AnimatedNumber value={numericValue} flash />
            : numericValue.toLocaleString()
          : value ?? '—'}
      </span>
    </div>
  );
}

export function SessionMetricsPanel({ sessionId }: SessionMetricsPanelProps) {
  const { state, counts } = useSessionEvents(sessionId);
  const metrics = state.metrics;
  // Issue 04.10: tween integer counters on change. Bypass under
  // prefers-reduced-motion so the assertion "zero motion" in the epic's
  // acceptance criteria holds.
  const reducedMotion = useReducedMotion() ?? false;
  const animate = !reducedMotion;
  const tu = metrics?.tokenUsage;

  if (state.loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)] text-sm animate-pulse">
        Loading metrics...
      </div>
    );
  }

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

  return (
    <div className="space-y-4">
      {/* ── Cost hero + KPI banner ────────────────────────────────── */}
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
            <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {totalTokens.toLocaleString()} tokens total
              {tu.estimatedCostUsd > 0.5 && (
                <span className="ml-2 text-[var(--color-warning)]">
                  · consider a cheaper model
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-2xl font-mono text-[var(--color-text-muted)]">—</div>
        )}

        {/* Condensed KPI banner — replaces the 6-card grid (epic 04.1).
             Numeric cells live-tween on change (epic 04.10). */}
        <div className="mt-4 pt-4 border-t border-[var(--color-void-lighter)] grid grid-cols-3 sm:grid-cols-6 gap-4">
          <BannerCell
            label="Duration"
            value={metrics ? formatDuration(metrics.durationSec * 1000) : '—'}
            title="Elapsed session time"
          />
          <BannerCell
            label="Messages"
            numericValue={counts.messages}
            animate={animate}
            title={`${counts.userMessages} user · ${counts.assistantMessages} assistant`}
          />
          <BannerCell
            label="Tool calls"
            numericValue={counts.toolCalls}
            animate={animate}
          />
          <BannerCell
            label="Approvals"
            numericValue={counts.approvals}
            animate={animate}
            title="Approvals granted during this session"
          />
          <BannerCell
            label="Auto"
            numericValue={metrics?.autoApprovals ?? 0}
            animate={animate}
            title="Auto-approvals (server-counted)"
          />
          <BannerCell
            label="Status"
            numericValue={metrics?.statusChanges.length ?? 0}
            animate={animate}
            title="Number of status transitions"
          />
        </div>
      </div>

      {/* ── Activity timeline (issue 04.6) ─────────────────────────── */}
      <TimelineSparkline entries={state.entries} />

      {/* ── Rate-limit card (issue 04.8, feature-flagged) ──────────── */}
      {RATE_LIMIT_CARD_ENABLED && <RateLimitCard limits={null} />}

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
              {tokenRows.map((row) => (
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
    </div>
  );
}
