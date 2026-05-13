/**
 * SessionMobileCard — mobile card view for session rows.
 * Extracted from SessionTable for maintainability.
 * @ticket #2932 // token-ok
 */

import { memo } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  Play,
  XCircle,
} from 'lucide-react';
import StatusDot from './StatusDot';
import type { SessionRowProps } from './sessionTableUtils';
import { areSessionRowPropsEqual, needsApproval, truncateDir } from './sessionTableUtils';
import { formatTimeAgo } from '../../utils/format';

export const SessionMobileCard = memo(function SessionMobileCard({
  session,
  isAlive,
  health,
  selected,
  currentAction,
  estimatedCostUsd,
  isFocused,
  onToggleSelect,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <div className={`card-glass p-5 animate-bento-reveal transition-all ${isFocused ? 'border-cyan-500 ring-1 ring-cyan-500/30' : ''}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-3 text-sm text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            aria-label={`Select session ${session.displayName || session.id}`}
            checked={selected}
            onChange={(e) => onToggleSelect(session.id, e.target.checked)}
            className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot status={session.status} health={health} />
              <Link
                to={`/sessions/${encodeURIComponent(session.id)}`}
                className="inline-flex min-h-[44px] items-center truncate font-medium text-[var(--color-text-primary)] transition-colors hover:text-cyan"
              >
                {session.displayName || session.id}
              </Link>
              {!isAlive && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-[var(--color-text-muted)]">
              {truncateDir(session.workDir, 50)}
            </div>
          </div>
        </label>

        <div className="flex shrink-0 items-center gap-1.5">
          {needsApproval(session) && (
            <button type="button"
              onClick={(e) => onApprove(e, session.id)}
              disabled={currentAction === 'approve'}
              aria-label={`Approve session ${session.displayName || session.id}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 p-2 text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          <button type="button"
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            aria-label={`Interrupt session ${session.displayName || session.id}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 p-2 text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-4 w-4" />
          </button>
          <button type="button"
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            aria-label={`Kill session ${session.displayName || session.id}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-red-900/30 p-2 text-red-400 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Kill"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-muted)]">
        <span>Age: {formatTimeAgo(session.createdAt)}</span>
        <span>Active: {formatTimeAgo(session.lastActivity)}</span>
        {estimatedCostUsd != null && estimatedCostUsd > 0 && (
          <span className="font-mono tabular-nums text-[var(--color-accent-cyan)]">
            {`$${estimatedCostUsd < 0.01 ? estimatedCostUsd.toFixed(4) : estimatedCostUsd < 1 ? estimatedCostUsd.toFixed(3) : estimatedCostUsd.toFixed(2)}`}
          </span>
        )}
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-green-400">
            <CheckCircle2 className="h-3 w-3" /> {session.permissionMode}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-void-lighter px-2 py-0.5 text-[var(--color-text-muted)]">
            default
          </span>
        )}
      </div>
    </div>
  );
}, areSessionRowPropsEqual);
