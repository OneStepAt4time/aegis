/**
 * components/overview/StatusDot.tsx — Colored status indicator dot.
 */

import type { UIState } from '../../types';

const STATUS_COLORS: Record<UIState, string> = {
  idle: '#00ff88',
  working: '#00e5ff',
  permission_prompt: '#ffaa00',
  bash_approval: '#ffaa00',
  plan_mode: '#ff8800',
  ask_question: '#ff3366',
  settings: '#00e5ff',
  unknown: '#666666',
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

export default function StatusDot({ status }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  const shouldPulse = PULSE_STATUSES.has(status);

  return (
    <span
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
