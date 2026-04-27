/**
 * components/session/RateLimitCard.tsx — rate-limit usage bars.
 *
 * Issue 04.8 of the session-cockpit epic.
 *
 * Renders a compact bar chart of usage per rate-limit window. Each
 * window has a short label (e.g. `5h`, `7d`, `Opus`, `Sonnet`), a
 * `used` count, and a `total` cap; the bar fills proportionally and
 * shifts hue from accent → warning → danger as the usage ratio
 * crosses 66% / 90%.
 *
 * Data source is provider-specific and not currently wired anywhere
 * in the server. When `limits` is `null` (the default today), the
 * card collapses to a single muted line explaining why, which the
 * user can dismiss at the component layer by not rendering the
 * card at all.
 *
 * The outer `SessionMetricsPanel` wraps the mount in a feature flag
 * (`VITE_ENABLE_RATE_LIMIT_CARD`) so the scaffolding ships behind a
 * switch until a provider adapter lands.
 */

import { Icon } from '../Icon';

export interface RateLimitWindow {
  /** Short label, e.g. "5h" / "7d" / "Opus" / "Sonnet" / "Cowork". */
  label: string;
  /** Units consumed in the current window. */
  used: number;
  /** Cap for the window. Use Infinity for "no cap reported". */
  total: number;
  /** Optional human-readable unit ("req", "tok", etc.). Default: "req". */
  unit?: string;
}

export interface RateLimitCardProps {
  /** When `null`, the card renders an unavailable notice. */
  limits: RateLimitWindow[] | null;
  /** Optional forecast string — the epic calls for "5h in ~41m" when
   *  velocity is known server-side. Hidden when absent. */
  forecast?: string;
}

/** Pure helper — returns the bar fill color for a used/total ratio. */
export function limitBarColor(ratio: number): string {
  if (ratio >= 0.9) return 'var(--color-danger)';
  if (ratio >= 0.66) return 'var(--color-warning)';
  return 'var(--color-accent-cyan)';
}

function formatPercent(used: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '—';
  return `${Math.round((used / total) * 100)}%`;
}

export function RateLimitCard({ limits, forecast }: RateLimitCardProps) {
  if (limits === null) {
    // Not a card — a single muted inline line that explains its own
    // absence. Keeps the Metrics tab compact on providers that don't
    // report rate-limit headers.
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-[var(--color-text-muted)]">
        <Icon name="Activity" size={12} />
        <span>Rate limits not reported by the current provider.</span>
      </div>
    );
  }

  if (limits.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-[var(--color-text-muted)]">
        <Icon name="Activity" size={12} />
        <span>Rate limit · waiting for samples…</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon name="Activity" size={16} className="text-[var(--color-text-muted)]" />
        <h3 className="text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
          Rate Limit
        </h3>
        {forecast && (
          <span className="ml-auto text-[10px] text-[var(--color-warning)]">
            Forecast: {forecast}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {limits.map((w) => {
          const ratio = Number.isFinite(w.total) && w.total > 0 ? w.used / w.total : 0;
          const color = limitBarColor(ratio);
          const widthPct = Math.min(100, Math.max(0, ratio * 100));
          const unit = w.unit ?? 'req';
          const totalLabel = Number.isFinite(w.total) ? w.total.toLocaleString() : '∞';
          return (
            <div key={w.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider">
                <span className="text-[var(--color-text-muted)]">{w.label}</span>
                <span className="font-mono tabular-nums text-[var(--color-text-primary)]">
                  {formatPercent(w.used, w.total)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-void-lighter)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor: color,
                    transition: 'width var(--duration-slow) var(--ease-decelerate)',
                  }}
                />
              </div>
              <div className="text-[10px] font-mono text-[var(--color-text-muted)]">
                {w.used.toLocaleString()} / {totalLabel} {unit}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
