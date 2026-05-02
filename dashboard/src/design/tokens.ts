/**
 * Aegis Dashboard — Design Tokens
 *
 * Single source of truth for every color, spacing, radius, duration, easing,
 * and shadow used in the dashboard. Components MUST import from this module
 * instead of hard-coding hex / rgb / cubic-bezier literals.
 *
 * Mirror: CSS custom properties declared in `dashboard/src/index.css`.
 * Gate:   `scripts/dashboard-tokens-gate.cjs` (wired into `npm run gate`).
 *
 * See `docs/dashboard/design-tokens.md` for migration guidance.
 */

export const tokens = {
  /**
   * Dark-mode palette (default).
   * Mirrors the `@theme { ... }` block in `index.css`.
   */
  color: {
    // Deep SaaS dark-mode palette
    void: '#020617',
    voidDeep: '#000000',
    voidDark: '#0f172a',
    voidLight: '#1e293b',
    voidLighter: '#334155',
    surface: '#0f172a',
    surfaceHover: '#1e293b',

    // Text
    textPrimary: '#f8fafc',
    textMuted: '#94a3b8',

    // Accents
    accent: '#3b82f6',
    accentDim: '#3b82f620',
    accentCyan: '#06b6d4',
    accentPurple: '#8b5cf6',

    // Semantic / status
    danger: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',

    // Charts & metrics
    metricsPurple: '#8b5cf6',
    successBg: '#064e3b',
    errorBg: '#4c1d1f',
  },

  /**
   * Light-mode overrides.
   * Mirrors the `[data-theme="light"] { ... }` block in `index.css`.
   * Only keys that change in light mode are listed.
   */
  colorLight: {
    void: '#f8fafc',
    voidDeep: '#ffffff',
    voidDark: '#f1f5f9',
    voidLight: '#e2e8f0',
    voidLighter: '#cbd5e1',
    surface: '#ffffff',
    surfaceHover: '#f1f5f9',
    // WCAG AA — 17.6:1 ratio on light backgrounds
    textPrimary: '#020617',
    // Slate-700 on #f8fafc = 7.1:1 ratio (AA normal + large)
    textMuted: '#334155',
    traceLine: '#94a3b8',
  },

  /**
   * Semantic action colors.
   * Enforced pairing — never use raw colors for these actions.
   *   kill / revoke / reject  → danger / warning
   *   approve / create        → success
   */
  action: {
    destructive: '#ef4444', // kill, revoke, reject
    caution: '#f59e0b',     // pending-destructive, confirm
    constructive: '#22c55e', // approve, create, confirm-positive
    informative: '#3b82f6', // info, neutral-action
  },

  /** Spacing scale (px). Pair with Tailwind's built-in scale where possible. */
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    '2xl': 32,
    '3xl': 48,
  },

  /** Border-radius scale (px). `full` = pill. */
  radius: {
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },

  /** Motion durations (ms). */
  duration: {
    instant: 0,
    fast: 120,
    base: 200,
    slow: 320,
    cinematic: 480,
  },

  /** Motion easings (CSS `cubic-bezier()` form). */
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasisIn: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
    emphasisOut: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
    accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
  },

  /**
   * Shadows. Dark-mode tuned by default — for light-mode use
   * `.card-glass` helpers in `index.css` which already fork on `[data-theme]`.
   */
  shadow: {
    card:
      '0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 4px 24px -2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.02)',
    cardHover:
      '0 30px 60px -15px rgba(0, 0, 0, 0.9), 0 12px 40px -4px rgba(0, 0, 0, 0.5), 0 0 25px rgba(6, 182, 212, 0.15), inset 0 1px 0 rgba(255,255,255,0.05)',
    terminal: 'inset 0 2px 15px rgba(0,0,0,0.5)',
    statusGlow: '0 0 10px currentColor',
    cardLight:
      '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.06), 0 20px 40px -10px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,1)',
    cardLightHover:
      '0 2px 4px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.1), 0 30px 60px -15px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,1)',
  },

  /**
   * Z-index scale. Keep all overlays routed through this scale to avoid
   * stacking-context drift.
   */
  zIndex: {
    base: 0,
    dropdown: 1000,
    sticky: 1100,
    overlay: 1200,
    modal: 1300,
    toast: 1400,
    tooltip: 1500,
    noise: 9999,
  },

  /** Glamour-specific tokens for issue #2014. */
  glamour: {
    /** SVG gradient stroke IDs for RingGauge. */
    gaugeGradientId: 'ring-gauge-gradient',
    gaugeGlowId: 'ring-gauge-glow',
    /** Side-rail width (px) for LiveAuditStream. */
    sideRailWidth: 280,
    /** Sidebar glow gradient (CSS linear-gradient). */
    sidebarGlow: 'linear-gradient(180deg, rgba(6,182,212,0.06) 0%, transparent 40%, transparent 60%, rgba(139,92,246,0.04) 100%)',
    /** Command palette backdrop gradient (CSS radial-gradient). */
    paletteBackdrop: 'radial-gradient(ellipse at 50% 30%, rgba(6,182,212,0.08) 0%, transparent 60%)',
    /** Glow blur radius for RingGauge SVG filter (px). */
    gaugeGlowBlur: 12,
    /** Spring animation config for framer-motion gauge fill. */
    gaugeSpring: { stiffness: 120, damping: 20, mass: 1 } as const,
    /** Stagger delay (ms) for command palette results. */
    paletteStaggerMs: 30,
    /** Max live events shown in the side-rail. */
    sideRailMaxEvents: 50,

    /**
     * Heatmap colour scales (GitHub-style contribution grid).
     * Pre-computed rgba() strings so the SVG fill attribute can use them directly.
     * Each scale is anchored on a CSS var, so light/dark overrides propagate.
     */
    heatmap: {
      cyan: {
        empty: 'var(--color-void-light)',
        level1: 'rgba(var(--color-accent-cyan-rgb), 0.2)',
        level2: 'rgba(var(--color-accent-cyan-rgb), 0.4)',
        level3: 'rgba(var(--color-accent-cyan-rgb), 0.65)',
        level4: 'rgba(var(--color-accent-cyan-rgb), 0.9)',
      },
      purple: {
        empty: 'var(--color-void-light)',
        level1: 'rgba(var(--color-accent-purple-rgb), 0.2)',
        level2: 'rgba(var(--color-accent-purple-rgb), 0.4)',
        level3: 'rgba(var(--color-accent-purple-rgb), 0.65)',
        level4: 'rgba(var(--color-accent-purple-rgb), 0.9)',
      },
      green: {
        empty: 'var(--color-void-light)',
        level1: 'rgba(var(--color-success-rgb), 0.2)',
        level2: 'rgba(var(--color-success-rgb), 0.4)',
        level3: 'rgba(var(--color-success-rgb), 0.65)',
        level4: 'rgba(var(--color-success-rgb), 0.9)',
      },
    },
  },
} as const;

export type Tokens = typeof tokens;
export type ColorToken = keyof typeof tokens.color;
export type SpacingToken = keyof typeof tokens.spacing;
export type RadiusToken = keyof typeof tokens.radius;
export type DurationToken = keyof typeof tokens.duration;
export type EasingToken = keyof typeof tokens.easing;
export type ShadowToken = keyof typeof tokens.shadow;
