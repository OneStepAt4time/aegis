/**
 * ContextWindowMeter — Visual indicator of context window usage per session.
 *
 * Shows a progress bar with green → yellow → red color coding as context fills.
 * Parity feature with Cline's context progress bar.
 *
 * Issue: #3127
 */

interface ContextWindowMeterProps {
  /** Tokens consumed so far (input + output from transcript/metrics) */
  usedTokens: number;
  /** Context window size in tokens. Defaults to 200K (Claude Sonnet default). */
  maxTokens?: number;
  /** Show label with token counts. Default: true */
  showLabel?: boolean;
  /** Compact mode for session list. Default: false */
  compact?: boolean;
}

// Known context windows by model family
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-sonnet': 200_000,
  'claude-opus': 200_000,
  'claude-haiku': 200_000,
  'glm-5': 128_000,
  'glm-4': 128_000,
  'gpt-4': 128_000,
  'gpt-5': 256_000,
  'default': 200_000,
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function getUsageColor(percentage: number): string {
  if (percentage < 0.5) return 'bg-emerald-500';
  if (percentage < 0.75) return 'bg-yellow-500';
  if (percentage < 0.9) return 'bg-orange-500';
  return 'bg-red-500';
}

function getUsageTextColor(percentage: number): string {
  if (percentage < 0.5) return 'text-emerald-400';
  if (percentage < 0.75) return 'text-yellow-400';
  if (percentage < 0.9) return 'text-orange-400';
  return 'text-red-400';
}

function getWarningLevel(percentage: number): 'ok' | 'warning' | 'critical' {
  if (percentage < 0.75) return 'ok';
  if (percentage < 0.9) return 'warning';
  return 'critical';
}

export function ContextWindowMeter({
  usedTokens,
  maxTokens = MODEL_CONTEXT_WINDOWS['default'],
  showLabel = true,
  compact = false,
}: ContextWindowMeterProps) {
  const percentage = Math.min(usedTokens / maxTokens, 1);
  const color = getUsageColor(percentage);
  const textColor = getUsageTextColor(percentage);
  const warningLevel = getWarningLevel(percentage);

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" title={`${formatTokens(usedTokens)} / ${formatTokens(maxTokens)} tokens used`}>
        <div className="h-1.5 w-16 rounded-full bg-[var(--color-void-lighter)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${color}`}
            style={{ width: `${percentage * 100}%` }}
            role="progressbar"
            aria-valuenow={usedTokens}
            aria-valuemin={0}
            aria-valuemax={maxTokens}
            aria-label={`Context usage: ${Math.round(percentage * 100)}%`}
          />
        </div>
        <span className={`text-[10px] font-mono ${textColor}`}>
          {Math.round(percentage * 100)}%
        </span>
      </div>
    );
  }

  return (
    <div
      className="space-y-1.5"
      role="region"
      aria-label="Context window usage"
    >
      {showLabel && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-muted)]">Context Window</span>
          <span className={`text-xs font-mono ${textColor}`}>
            {formatTokens(usedTokens)} / {formatTokens(maxTokens)}
          </span>
        </div>
      )}
      <div className="h-2.5 rounded-full bg-[var(--color-void-lighter)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${color}`}
          style={{ width: `${percentage * 100}%` }}
          role="progressbar"
          aria-valuenow={usedTokens}
          aria-valuemin={0}
          aria-valuemax={maxTokens}
          aria-label={`Context usage: ${Math.round(percentage * 100)}%`}
        />
      </div>
      {warningLevel !== 'ok' && (
        <p className={`text-[10px] ${textColor}`}>
          {warningLevel === 'warning'
            ? '⚠️ Context filling up — consider starting a new session'
            : '🔴 Context nearly full — session may lose earlier context'}
        </p>
      )}
    </div>
  );
}

export { MODEL_CONTEXT_WINDOWS };
