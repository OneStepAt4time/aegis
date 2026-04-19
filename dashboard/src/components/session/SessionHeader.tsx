import { useState, useRef, useEffect } from 'react';
import { GitFork, MoreHorizontal } from 'lucide-react';
import type { SessionHealth, SessionInfo } from '../../types';
import { SessionStateBadge, uiStateToSessionBadgeStatus } from './SessionStateBadge';
import { HoldButton } from '../shared/HoldButton';
import { CopyButton } from '../shared/CopyButton';

interface SessionHeaderProps {
  session: SessionInfo;
  health: SessionHealth;
  onApprove?: () => void;
  onReject?: () => void;
  onInterrupt?: () => void;
  onKill?: () => void;
  onSaveTemplate?: () => void;
  onFork?: () => void;
}




function truncateMiddle(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const start = value.slice(0, Math.ceil(maxLen / 2) - 1);
  const end = value.slice(-(Math.floor(maxLen / 2) - 2));
  return `${start}…${end}`;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Simple overflow dropdown for secondary/destructive actions. */
function OverflowMenu({
  onSaveTemplate,
  onFork,
  onKill,
}: {
  onSaveTemplate?: () => void;
  onFork?: () => void;
  onKill?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] shadow-xl"
        >
          {onSaveTemplate && (
            <button
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); onSaveTemplate(); }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              Save as Template
            </button>
          )}
          {onFork && (
            <button
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); onFork(); }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
            >
              <GitFork className="h-3.5 w-3.5" />
              Fork
            </button>
          )}
          {onKill && (
            <div className="border-t border-[var(--color-void-lighter)] px-2 py-2">
              <HoldButton
                onConfirm={() => { setOpen(false); onKill(); }}
                holdDuration={800}
                variant="danger"
                aria-label="Hold to kill session"
                className="w-full justify-center"
              >
                Kill Session
              </HoldButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SessionHeader({
  session,
  health,
  onApprove,
  onReject,
  onInterrupt,
  onKill,
  onSaveTemplate,
  onFork,
}: SessionHeaderProps) {
  const needsApproval = health.status === 'permission_prompt' || health.status === 'bash_approval';
  const badgeStatus = uiStateToSessionBadgeStatus(health.status, health.alive);

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-3 sm:p-4">
      {/* Title row */}
      <div className="mb-2 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="truncate text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
              {session.windowName || 'Untitled Session'}
            </h1>
            <SessionStateBadge status={badgeStatus} />
            {session.permissionMode && session.permissionMode !== 'default' && (
              <span className="rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-success)]">
                {session.permissionMode}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs font-mono text-[var(--color-text-muted)]">
            {truncateMiddle(session.workDir, 48)}
          </div>
        </div>
      </div>

      {/* Metadata row */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
        <span>Created: {formatDate(session.createdAt)}</span>
        <span className="hidden sm:inline">Last activity: {formatDate(session.lastActivity)}</span>
        <span className="group inline-flex items-center gap-1 font-mono">
          <span className="hidden sm:inline">ID:</span>
          {truncateMiddle(session.id, 16)}
          <CopyButton value={session.id} label="session ID" size={16} />
        </span>
        {session.ownerKeyId && (
          <span className="group hidden font-mono sm:inline-flex items-center gap-1">
            Owner: {session.ownerKeyId.slice(0, 8)}
            {session.ownerKeyId.length > 8 ? '…' : ''}
            <CopyButton value={session.ownerKeyId} label="owner key ID" size={16} />
          </span>
        )}
        {health.details && <span className="hidden italic sm:inline">{health.details}</span>}
      </div>

      {/* Action row: [Approve] [Reject] [Interrupt] [⋯] */}
      <div className="flex flex-wrap items-center gap-2">
        {needsApproval && (
          <>
            <button
              type="button"
              onClick={onApprove}
              className="hidden min-h-[44px] rounded border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-3 py-2 text-xs font-medium text-[var(--color-success)] transition-colors hover:bg-[var(--color-success-bg-hover)] sm:inline-flex"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={onReject}
              className="hidden min-h-[44px] rounded border border-[var(--color-error)]/30 bg-[var(--color-error-bg)] px-3 py-2 text-xs font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg-hover)] sm:inline-flex"
            >
              Reject
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onInterrupt}
          className="hidden min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-cta-bg)]/10 px-3 py-2 text-xs font-medium text-[var(--color-cta-bg)] transition-colors hover:bg-[var(--color-cta-bg)]/20 sm:inline-flex"
        >
          Interrupt
        </button>

        <div className="ml-auto">
          <OverflowMenu
            onSaveTemplate={onSaveTemplate}
            onFork={onFork}
            onKill={onKill}
          />
        </div>
      </div>
    </div>
  );
}

