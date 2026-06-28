/**
 * utils/statusStyles.ts — Single source of truth for status → color.
 *
 * Encodes the Command Center "Status color map" from `dashboard/DESIGN.md` §4.
 * Every component that renders a session/agent status (dots, pills, badges)
 * draws its color from here instead of hardcoding tokens, so the mapping
 * lives in exactly one place.
 *
 * Design tokens (see `src/index.css` @theme):
 * - cyan    `var(--color-accent-cyan)`  → idle / ready (the "alive" signal)
 * - amber   `var(--color-accent)`       → working / running
 * - warning `var(--color-warning)`      → awaiting approval / degraded / stalled
 * - success `var(--color-success)`      → completed / nominal
 * - danger  `var(--color-danger)`       → error / killed / crashed
 * - muted   `var(--color-placeholder)`  → unknown
 *
 * All data colors on the `#111827` surface pass WCAG AA (≥ 4.5:1). Pill text
 * uses the `*-glow` token variants, which the light-theme overrides in
 * `index.css` remap to AA-safe values per theme.
 */

import type { UIState } from '../types';

/**
 * Status keys this map covers: every `UIState` value plus the lifecycle
 * variant `stalled` (a session-health state, not a `UIState`). `completed`,
 * `killed`, and `crashed` are already part of the `UIState` union.
 */
export type StatusKey = UIState | 'stalled';

export interface StatusStyle {
  /** CSS variable for the status dot fill (e.g. `var(--color-accent-cyan)`). */
  dotColor: string;
  /** Lowercase, operator-console human label (DESIGN §6 voice). */
  label: string;
  /** Tailwind pill fragment: token-based border + bg + text, AA on navy. */
  className: string;
}

// ── Token shorthands (DESIGN §1 data palette) ───────────────────────────────

const CYAN = 'var(--color-accent-cyan)';
const AMBER = 'var(--color-accent)';
const WARNING = 'var(--color-warning)';
const SUCCESS = 'var(--color-success)';
const DANGER = 'var(--color-danger)';
const MUTED = 'var(--color-placeholder)';

// Pill class fragments per bucket. The `/40` `/10` opacity modifiers match the
// existing token usage in the dashboard (e.g. `bg-[var(--color-success)]/15`).
const CYAN_PILL =
  'border-[var(--color-accent-cyan)]/40 bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]';
const AMBER_PILL =
  'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]';
const WARNING_PILL =
  'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning-glow)]';
const SUCCESS_PILL =
  'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success-glow)]';
const DANGER_PILL =
  'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger-glow)]';
const MUTED_PILL =
  'border-[var(--color-placeholder)]/40 bg-[var(--color-placeholder)]/10 text-[var(--color-text-muted)]';

/**
 * The canonical status → style map. Exhaustive over `StatusKey` — adding a new
 * `UIState` value forces a compile error here until it is mapped.
 */
export const STATUS_STYLES: Record<StatusKey, StatusStyle> = {
  // cyan — alive / ready
  idle: { dotColor: CYAN, label: 'idle', className: CYAN_PILL },

  // amber — actively working
  working: { dotColor: AMBER, label: 'working', className: AMBER_PILL },
  settings: { dotColor: AMBER, label: 'settings', className: AMBER_PILL },

  // warning — awaiting human / degraded / stalled
  compacting: { dotColor: WARNING, label: 'compacting', className: WARNING_PILL },
  context_warning: { dotColor: WARNING, label: 'context warning', className: WARNING_PILL },
  waiting_for_input: { dotColor: WARNING, label: 'waiting for input', className: WARNING_PILL },
  permission_prompt: { dotColor: WARNING, label: 'awaiting approval', className: WARNING_PILL },
  bash_approval: { dotColor: WARNING, label: 'awaiting approval', className: WARNING_PILL },
  plan_mode: { dotColor: WARNING, label: 'plan review', className: WARNING_PILL },
  pending: { dotColor: WARNING, label: 'pending', className: WARNING_PILL },
  awaiting_approval: { dotColor: WARNING, label: 'awaiting approval', className: WARNING_PILL },
  stalled: { dotColor: WARNING, label: 'stalled', className: WARNING_PILL },

  // danger — failed / blocked / dead
  ask_question: { dotColor: DANGER, label: 'awaiting input', className: DANGER_PILL },
  error: { dotColor: DANGER, label: 'error', className: DANGER_PILL },
  rate_limit: { dotColor: DANGER, label: 'rate limited', className: DANGER_PILL },
  killed: { dotColor: DANGER, label: 'killed', className: DANGER_PILL },
  crashed: { dotColor: DANGER, label: 'crashed', className: DANGER_PILL },

  // success — done
  completed: { dotColor: SUCCESS, label: 'completed', className: SUCCESS_PILL },

  // muted — unknown
  unknown: { dotColor: MUTED, label: 'unknown', className: MUTED_PILL },
};

/**
 * Resolve the canonical style for a status string. Any value outside the
 * status contract (defensive — e.g. a future backend status the dashboard
 * hasn't shipped support for yet) falls back to the muted `unknown` style.
 */
export function getStatusStyle(status: string): StatusStyle {
  // Map is keyed by `StatusKey`; widen for a safe lookup-with-fallback over an
  // arbitrary string. The `?? unknown` guarantees a valid style is returned.
  return STATUS_STYLES[status as StatusKey] ?? STATUS_STYLES.unknown;
}
