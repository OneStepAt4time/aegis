/**
 * components/overview/StatusDot.tsx — Colored status indicator dot.
 */

import type { UIState } from '../../types';
import type { SessionHealthState } from '../../types';

const STATUS_COLORS: Record<UIState, string> = {
  idle: 'var(--color-success)',
  working: 'var(--color-accent)',
  permission_prompt: 'var(--color-warning)',
  bash_approval: 'var(--color-warning)',
  plan_mode: 'var(--color-dot-orange)',
  ask_question: 'var(--color-error)',
  settings: 'var(--color-accent)',
  error: 'var(--color-dot-red)',
  rate_limit: 'var(--color-dot-red)',
  compacting: 'var(--color-warning)',
  context_warning: 'var(--color-warning)',
  waiting_for_input: 'var(--color-warning)',
  unknown: '#666',
};

const HEALTH_COLORS: Record<SessionHealthState, string> = {
  stall: 'var(--color-warning)',
  dead: 'var(--color-dot-red)',
};

const PULSE_STATUSES: ReadonlySet<UIState> = new Set([
  'working',
  'permission_prompt',
  'bash_approval',
  'ask_question',
]);

interface StatusDotProps {
  status: UIState;
  health?: SessionHealthState | null;
}

const STATUS_LABELS: Record<UIState, string> = {
  idle: 'Idle',
  working: 'Working',
  permission_prompt: 'Permission prompt',
  bash_approval: 'Bash approval',
  plan_mode: 'Plan mode',
  ask_question: 'Awaiting question',
  settings: 'Settings',
  error: 'Error',
  rate_limit: 'Rate limited',
  compacting: 'Compacting',
  context_warning: 'Context warning',
  waiting_for_input: 'Waiting for input',
  unknown: 'Unknown',
};

const HEALTH_LABELS: Record<SessionHealthState, string> = {
  stall: 'Stalled',
  dead: 'Dead',
};

export default function StatusDot({ status, health }: StatusDotProps) {
  // Health state (stall/dead) overrides the status color for emphasis
  const isStall = health === 'stall';
  const isDead = health === 'dead';

  const baseColor = isDead
    ? HEALTH_COLORS.dead
    : isStall
    ? HEALTH_COLORS.stall
    : STATUS_COLORS[status] ?? STATUS_COLORS.unknown;

  const shouldPulse = isStall || PULSE_STATUSES.has(status);
  // Dead uses faster pulse to signal urgency
  const pulseDuration = isDead ? '0.8s' : isStall ? '2s' : '1.5s';

  const label = isDead
    ? HEALTH_LABELS.dead
    : isStall
    ? HEALTH_LABELS.stall
    : STATUS_LABELS[status] ?? STATUS_LABELS.unknown;

  return (
    <span
      role="img"
      aria-label={`Status: ${label}`}
      title={label}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: baseColor,
        boxShadow: `0 0 6px ${baseColor}66`,
        animation: shouldPulse ? `pulse ${pulseDuration} ease-in-out infinite` : undefined,
      }}
    />
  );
}
