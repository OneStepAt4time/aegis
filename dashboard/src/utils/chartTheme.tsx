/**
 * chartTheme.ts — Centralized Recharts theme using CSS design tokens.
 *
 * All chart components should import from this file instead of
 * hardcoding colors, stroke values, or tooltip styles.
 *
 * @ticket #3399 // token-ok
 */

/* ------------------------------------------------------------------ */
/*  Color palette — mirrors CSS custom properties from index.css      */
/* ------------------------------------------------------------------ */

/** Semantic color tokens (CSS var references for Recharts Cell/Bar fill). */
export const CHART_COLORS = {
  cyan: 'var(--color-accent-cyan)',
  purple: 'var(--color-accent-purple)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  muted: 'var(--color-text-muted)',
} as const;

/** Raw RGB values — useful for constructing rgba() gradient stops. */
export const CHART_RGB = {
  cyan: '6, 182, 212',
  purple: '139, 92, 246',
  success: '34, 197, 94',
  warning: '245, 158, 11',
  danger: '239, 68, 68',
  info: '59, 130, 246',
} as const;

/** Model → color mapping (canonical source for all charts). */
export const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4.7': CHART_COLORS.purple,
  'claude-sonnet-4.6': CHART_COLORS.cyan,
  'claude-haiku-4.5': CHART_COLORS.success,
  'gpt-5.4': CHART_COLORS.warning,
  'gpt-4.1': CHART_COLORS.info,
  other: CHART_COLORS.muted,
};

/** Agent → color mapping (for contribution charts). */
export const AGENT_COLORS: Record<string, string> = {
  Daedalus: CHART_COLORS.cyan,
  Hephaestus: CHART_COLORS.purple,
  Argus: CHART_COLORS.success,
  Athena: CHART_COLORS.warning,
  Scribe: CHART_COLORS.info,
  Hermes: CHART_COLORS.warning,
  Orpheus: CHART_COLORS.cyan,
  Themis: CHART_COLORS.danger,
  other: CHART_COLORS.muted,
};

/** Token breakdown colors (stacked bars). */
export const TOKEN_COLORS = {
  inputTokens: CHART_COLORS.cyan,
  outputTokens: CHART_COLORS.purple,
  cacheReadTokens: CHART_COLORS.success,
  cacheWriteTokens: CHART_COLORS.warning,
} as const;

/** Token breakdown display labels. */
export const TOKEN_LABELS: Record<string, string> = {
  inputTokens: 'Input',
  outputTokens: 'Output',
  cacheReadTokens: 'Cache Read',
  cacheWriteTokens: 'Cache Write',
};

/* ------------------------------------------------------------------ */
/*  Shared axis / grid defaults                                       */
/* ------------------------------------------------------------------ */

export const CHART_GRID = {
  strokeDasharray: '3 3',
  stroke: 'var(--color-void-lighter)',
} as const;

export const CHART_TICK = {
  fill: 'var(--color-text-muted)',
  fontSize: 11,
} as const;

export const CHART_AXIS = {
  stroke: 'var(--color-void-lighter)',
} as const;

/* ------------------------------------------------------------------ */
/*  Animation / shape defaults                                        */
/* ------------------------------------------------------------------ */

export const CHART_ANIMATION = {
  duration: 500,
} as const;

export const CHART_DOT = {
  r: 3,
} as const;

export const CHART_ACTIVE_DOT = {
  r: 5,
} as const;

export const CHART_STROKE = {
  width: 2,
} as const;

export const CHART_BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/* ------------------------------------------------------------------ */
/*  Tooltip styling constants                                         */
/* ------------------------------------------------------------------ */

export const TOOLTIP_STYLE = {
  container: 'rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 shadow-xl',
  label: 'mb-2 text-xs font-medium text-[var(--color-text-primary)]',
  row: 'flex items-center justify-between gap-4 text-xs',
  rowLabel: 'text-[var(--color-text-muted)]',
  rowValue: 'font-mono font-medium text-[var(--color-text-primary)]',
} as const;

/* ------------------------------------------------------------------ */
/*  SVG gradient helpers                                              */
/* ------------------------------------------------------------------ */

export interface GradientStop {
  offset: string;
  color: string;
  opacity?: number;
}

/** Predefined gradient definitions keyed by semantic name. */
export const CHART_GRADIENTS: Record<string, { id: string; x1: string; y1: string; x2: string; y2: string; stops: GradientStop[] }> = {
  cyan: {
    id: 'gradientCyan',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
    stops: [
      { offset: '0%', color: `rgba(${CHART_RGB.cyan}, 0.3)` },
      { offset: '100%', color: `rgba(${CHART_RGB.cyan}, 0)` },
    ],
  },
  purple: {
    id: 'gradientPurple',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
    stops: [
      { offset: '0%', color: `rgba(${CHART_RGB.purple}, 0.3)` },
      { offset: '100%', color: `rgba(${CHART_RGB.purple}, 0)` },
    ],
  },
  success: {
    id: 'gradientSuccess',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
    stops: [
      { offset: '0%', color: `rgba(${CHART_RGB.success}, 0.3)` },
      { offset: '100%', color: `rgba(${CHART_RGB.success}, 0)` },
    ],
  },
  warning: {
    id: 'gradientWarning',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
    stops: [
      { offset: '0%', color: `rgba(${CHART_RGB.warning}, 0.3)` },
      { offset: '100%', color: `rgba(${CHART_RGB.warning}, 0)` },
    ],
  },
  danger: {
    id: 'gradientDanger',
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
    stops: [
      { offset: '0%', color: `rgba(${CHART_RGB.danger}, 0.3)` },
      { offset: '100%', color: `rgba(${CHART_RGB.danger}, 0)` },
    ],
  },
};

/**
 * GradientDefs — renders SVG <defs> with <linearGradient> elements.
 *
 * Import and place inside any Recharts chart that needs area fills.
 * Pass an array of gradient names: <GradientDefs gradients={['cyan', 'purple']} />
 */
export function GradientDefs({ gradients }: { gradients: string[] }) {
  return (
    <defs>
      {gradients.map((name) => {
        const g = CHART_GRADIENTS[name];
        if (!g) return null;
        return (
          <linearGradient key={g.id} id={g.id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
            {g.stops.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity} />
            ))}
          </linearGradient>
        );
      })}
    </defs>
  );
}

/**
 * ChartTooltipContent — shared tooltip wrapper with consistent dark-theme styling.
 *
 * Usage:
 *   <Tooltip content={<ChartTooltipContent label="May 15" entries={[
 *     { name: 'Cost', value: '$4.20' },
 *   ]} />} />
 */
export function ChartTooltipContent({
  label,
  entries,
  children,
}: {
  label?: string;
  entries?: Array<{ name: string; value: string; color?: string }>;
  children?: React.ReactNode;
}) {
  return (
    <div className={TOOLTIP_STYLE.container}>
      {label && <p className={TOOLTIP_STYLE.label}>{label}</p>}
      {entries?.map((entry, i) => (
        <div key={i} className={TOOLTIP_STYLE.row}>
          {entry.color && (
            <span
              className="mr-1.5 inline-block h-2 w-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
          )}
          <span className={TOOLTIP_STYLE.rowLabel}>{entry.name}:</span>
          <span className={TOOLTIP_STYLE.rowValue}>{entry.value}</span>
        </div>
      ))}
      {children}
    </div>
  );
}
