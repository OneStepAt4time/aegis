/**
 * components/overview/StatusDot.tsx â€” Colored status indicator dot.
 */

import type { UIState } from '../../types';

const STATUS_COLORS: Record<UIState, string> = {
  idle: 'var(--color-success)',
  working: 'var(--color-accent)',
  permission_prompt: 'var(--color-warning)',
  bash_approval: 'var(--color-warning)',
  plan_mode: 'var(--color-dot-orange)',
  ask_question: 'var(--color-error)',
  settings: 'var(--color-accent)',
  error: 'var(--color-dot-red)',
  compacting: 'var(--color-warning)',
  context_warning: 'var(--color-warning)',
  waiting_for_input: 'var(--color-warning)',
  unknown: '#666',
};

const PULSE_STATUSES: ReadonlySet<UIState> = new Set([
  'working',
  'permission_prompt',
  'bash_approval',
  'ask_question',
]);

interface StatusDotProps {
  status: UIState;
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
  compacting: 'Compacting',
  context_warning: 'Context warning',
  waiting_for_input: 'Waiting for input',
  unknown: 'Unknown',
};

export default function StatusDot({ status }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  const shouldPulse = PULSE_STATUSES.has(status);
  const label = STATUS_LABELS[status] ?? STATUS_LABELS.unknown;

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
        backgroundColor: color,
        boxShadow: `0 0 6px ${color}66`,
        animation: shouldPulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
      }}
    />
  );
}

