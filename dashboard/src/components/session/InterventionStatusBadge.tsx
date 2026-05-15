/**
 * components/session/InterventionStatusBadge.tsx — Badge showing pause/intervention status.
 *
 * Renders a small status indicator for the session's intervention state.
 * Used in session lists and headers.
 */

import { Pause, Hand, Play } from 'lucide-react';

export interface InterventionStatusBadgeProps {
  status?: 'paused' | 'intervening' | 'resumed' | null;
  reason?: string;
  className?: string;
}

const STATUS_CONFIG = {
  paused: {
    label: 'Paused',
    bg: 'bg-[var(--color-warning)]/20',
    text: 'text-[var(--color-warning)]',
    icon: Pause,
  },
  intervening: {
    label: 'Intervening',
    bg: 'bg-[var(--color-accent)]/20',
    text: 'text-[var(--color-accent)]',
    icon: Hand,
  },
  resumed: {
    label: 'Resumed',
    bg: 'bg-[var(--color-success)]/20',
    text: 'text-[var(--color-success)]',
    icon: Play,
  },
} as const;

export function InterventionStatusBadge({ status, reason, className = '' }: InterventionStatusBadgeProps) {
  if (!status || status === 'resumed') return null;

  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text} ${className}`}
      title={reason || config.label}
      role="status"
      aria-label={`${config.label}${reason ? `: ${reason}` : ''}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
