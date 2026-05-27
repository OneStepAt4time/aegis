/**
 * components/overview/StatusDot.tsx — Colored status indicator dot.
 *
 * Includes a one-shot flash animation when the status changes,
 * making SSE-driven status transitions visually obvious.
 */

import { useEffect, useRef, useState } from 'react';
import type { UIState } from '../../types';
import { useT } from '../../i18n/context';
import type { SessionHealthState } from '../../types';

const STATUS_COLORS: Record<UIState, string> = {
  idle: 'var(--color-success)',
  working: 'var(--color-cta-bg)',
  permission_prompt: 'var(--color-warning)',
  bash_approval: 'var(--color-warning)',
  plan_mode: 'var(--color-dot-orange)',
  ask_question: 'var(--color-error)',
  settings: 'var(--color-cta-bg)',
  error: 'var(--color-dot-red)',
  rate_limit: 'var(--color-dot-red)',
  compacting: 'var(--color-warning)',
  context_warning: 'var(--color-warning)',
  waiting_for_input: 'var(--color-warning)',
  pending: 'var(--color-dot-pending)',
  awaiting_approval: 'var(--color-dot-awaiting-approval)',
  unknown: 'var(--color-dot-unknown)',
  killed: 'var(--color-dot-killed)',
  completed: 'var(--color-dot-completed)',
  crashed: 'var(--color-dot-crashed)',
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

const STATUS_KEYS: Record<UIState, string> = {
  idle: 'statusDot.idle',
  working: 'statusDot.working',
  permission_prompt: 'statusDot.permissionPrompt',
  bash_approval: 'statusDot.bashApproval',
  plan_mode: 'statusDot.planMode',
  ask_question: 'statusDot.askQuestion',
  settings: 'statusDot.settings',
  error: 'statusDot.error',
  rate_limit: 'statusDot.rateLimited',
  compacting: 'statusDot.compacting',
  context_warning: 'statusDot.contextWarning',
  waiting_for_input: 'statusDot.waitingForInput',
  pending: 'statusDot.pending',
  awaiting_approval: 'statusDot.pendingApproval',
  unknown: 'statusDot.unknown',
  killed: 'statusDot.killed',
  completed: 'statusDot.completed',
  crashed: 'statusDot.crashed',
};

const HEALTH_KEYS: Record<SessionHealthState, string> = {
  stall: 'statusDot.stalled',
  dead: 'statusDot.dead',
};

const FLASH_DURATION_MS = 800;

export default function StatusDot({ status, health }: StatusDotProps) {
  const t = useT();
  const prevStatusRef = useRef(status);
  const [flashing, setFlashing] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    ? t(HEALTH_KEYS.dead)
    : isStall
    ? t(HEALTH_KEYS.stall)
    : t(STATUS_KEYS[status] ?? STATUS_KEYS.unknown);

  // Trigger flash animation when status changes
  useEffect(() => {
    if (prevStatusRef.current !== status) {
      prevStatusRef.current = status;
      setFlashing(true);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashing(false), FLASH_DURATION_MS);
    }
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, [status]);

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
        boxShadow: flashing
          ? `0 0 12px ${baseColor}, 0 0 24px ${baseColor}88`
          : `0 0 6px ${baseColor}66`,
        animation: shouldPulse ? `pulse ${pulseDuration} ease-in-out infinite` : undefined,
        transition: 'box-shadow 0.4s ease-out',
      }}
    />
  );
}
