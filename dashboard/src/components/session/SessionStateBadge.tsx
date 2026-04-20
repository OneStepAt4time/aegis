/**
 * components/session/SessionStateBadge.tsx
 *
 * Single canonical status badge for a Claude Code session. Replaces the four
 * redundant status indicators (ALIVE pill, ● Idle dot, subtitle text, WS
 * LIVE/IDLE chip) with one compact component.
 *
 * Usage in session header:
 *   <SessionStateBadge status="idle" wsConnected={true} />
 *
 * Usage in list rows:
 *   <SessionStateBadge status="working" />
 */

import { StatusDot } from '../StatusDot';
import type { StatusDotVariant } from '../StatusDot';

export type SessionBadgeStatus =
  | 'idle'
  | 'working'
  | 'permission'
  | 'waiting'
  | 'error'
  | 'compacting'
  | 'offline'
  | 'unknown';

export interface SessionStateBadgeProps {
  status: SessionBadgeStatus;
  /** When false, renders an offline indicator overlay. Default: true */
  wsConnected?: boolean;
  className?: string;
}

const STATUS_TO_DOT: Record<SessionBadgeStatus, StatusDotVariant> = {
  idle: 'idle',
  working: 'working',
  permission: 'waiting',
  waiting: 'waiting',
  error: 'error',
  compacting: 'compacting',
  offline: 'unknown',
  unknown: 'unknown',
};

const STATUS_LABEL: Record<SessionBadgeStatus, string> = {
  idle: 'Idle',
  working: 'Working',
  permission: 'Awaiting approval',
  waiting: 'Waiting for input',
  error: 'Error',
  compacting: 'Compacting',
  offline: 'Offline',
  unknown: 'Unknown',
};

/** Map UIState strings to SessionBadgeStatus for convenience. */
export function uiStateToSessionBadgeStatus(
  uiState: string,
  alive: boolean,
): SessionBadgeStatus {
  if (!alive) return 'offline';
  switch (uiState) {
    case 'idle': return 'idle';
    case 'working': return 'working';
    case 'permission_prompt':
    case 'bash_approval': return 'permission';
    case 'ask_question':
    case 'waiting_for_input': return 'waiting';
    case 'error': return 'error';
    case 'compacting':
    case 'context_warning': return 'compacting';
    default: return 'unknown';
  }
}

export function SessionStateBadge({
  status,
  wsConnected = true,
  className,
}: SessionStateBadgeProps) {
  const effectiveStatus: SessionBadgeStatus = !wsConnected ? 'offline' : status;
  const dotVariant = STATUS_TO_DOT[effectiveStatus];
  const label = STATUS_LABEL[effectiveStatus];

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ''}`}
      aria-label={`Session status: ${label}`}
    >
      <StatusDot variant={dotVariant} size={8} />
      <span className="text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </span>
    </span>
  );
}

export default SessionStateBadge;
