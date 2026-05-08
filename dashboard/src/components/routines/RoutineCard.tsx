/**
 * components/routines/RoutineCard.tsx — Single routine display card.
 *
 * Shows routine title, schedule, next run time, status badge,
 * and quick action buttons (pause/resume, trigger-now, delete).
 */

import { Play, Pause, Zap, Trash2, Clock, Repeat } from 'lucide-react';
// Native relative time helper (replaces date-fns, #2934)
function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;
  const absDiff = Math.abs(diff);
  const suffix = diff > 0 ? 'from now' : 'ago';

  const minutes = Math.floor(absDiff / 60_000);
  const hours = Math.floor(absDiff / 3_600_000);
  const days = Math.floor(absDiff / 86_400_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ${suffix}`;
  if (hours < 24) return `${hours}h ${suffix}`;
  return `${days}d ${suffix}`;
}
import type { RoutineSchedule } from './CalendarGrid';

interface RoutineCardProps {
  routine: RoutineSchedule;
  onTogglePause?: (id: string) => void;
  onTriggerNow?: (id: string) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

export default function RoutineCard({
  routine,
  onTogglePause,
  onTriggerNow,
  onDelete,
  className = '',
}: RoutineCardProps) {
  const isActive = routine.status === 'active';
  const nextRunLabel = (() => {
    try {
      return formatRelative(new Date(routine.nextRunAt));
    } catch {
      return 'N/A';
    }
  })();

  return (
    <div
      className={`
        rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]
        p-4 transition-colors hover:border-[var(--color-border-hover)]
        ${className}
      `}
      role="article"
      aria-label={`Routine: ${routine.title}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {routine.title}
            </h4>
            <span
              className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium
                ${isActive
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-amber-500/20 text-amber-400'
                }
              `}
              aria-label={isActive ? 'Active' : 'Paused'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400' : 'bg-amber-400'}`} />
              {isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1" title="Cron schedule">
              <Repeat className="w-3 h-3" />
              <code className="font-mono text-[11px]">{routine.cronSchedule}</code>
            </span>
            {isActive && (
              <span className="flex items-center gap-1" title="Next run">
                <Clock className="w-3 h-3" />
                {nextRunLabel}
              </span>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1" role="group" aria-label="Routine actions">
          <button
            onClick={() => onTogglePause?.(routine.id)}
            className={`
              p-1.5 rounded transition-colors
              ${isActive
                ? 'text-amber-400 hover:bg-amber-500/10'
                : 'text-green-400 hover:bg-green-500/10'
              }
            `}
            aria-label={isActive ? 'Pause routine' : 'Resume routine'}
            title={isActive ? 'Pause' : 'Resume'}
          >
            {isActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onTriggerNow?.(routine.id)}
            className="p-1.5 rounded text-blue-400 hover:bg-blue-500/10 transition-colors"
            aria-label="Trigger routine now"
            title="Run now"
          >
            <Zap className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete?.(routine.id)}
            className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
            aria-label="Delete routine"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
