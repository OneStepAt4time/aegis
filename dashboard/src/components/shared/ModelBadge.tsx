/**
 * components/shared/ModelBadge.tsx — Compact model name badge.
 *
 * Color-coded per CCMeter convention (shared with ModelDistributionBar):
 *   Opus   → Purple
 *   Sonnet → Blue
 *   Haiku  → Green
 *   Other  → Muted
 *
 * Renders nothing when model is undefined/null (graceful degradation
 * for sessions created before the model field was added to the API).
 */


const MODEL_STYLES: Record<string, { color: string; label: string }> = {
  opus: { color: 'var(--color-accent-purple)', label: 'Opus' },
  sonnet: { color: 'var(--color-cta-bg)', label: 'Sonnet' },
  haiku: { color: 'var(--color-success)', label: 'Haiku' },
};

function getModelStyle(model: string): { color: string; label: string } {
  const lower = model.toLowerCase();
  for (const [key, style] of Object.entries(MODEL_STYLES)) {
    if (lower.includes(key)) return style;
  }
  return { color: 'var(--color-text-muted)', label: model };
}

export interface ModelBadgeProps {
  /** Raw model identifier (e.g. "claude-opus-4.7"). When undefined, renders nothing. */
  model?: string | null;
  className?: string;
}

export function ModelBadge({ model, className = '' }: ModelBadgeProps) {
  if (!model) return null;

  const { color, label } = getModelStyle(model);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${className}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
      title={model}
    >
      {label}
    </span>
  );
}
