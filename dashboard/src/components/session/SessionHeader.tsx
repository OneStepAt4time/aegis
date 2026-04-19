import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Copy, GitFork } from 'lucide-react';
import type { SessionHealth, SessionInfo, UIState } from '../../types';
import StatusDot from '../overview/StatusDot';

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

const STATUS_LABELS: Record<UIState, string> = {
  idle: 'Idle',
  working: 'Working',
  permission_prompt: 'Permission',
  plan_mode: 'Planning',
  ask_question: 'Question',
  bash_approval: 'Bash Approval',
  settings: 'Settings',
  error: 'Error',
  compacting: 'Compacting',
  context_warning: 'Context Warning',
  waiting_for_input: 'Waiting',
  unknown: 'Unknown',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center text-[var(--color-accent-cyan)]/60 transition-colors hover:text-[var(--color-accent-cyan)]"
      aria-label="Copy session ID"
    >
      {copied ? (
        <Check className="h-3 w-3 text-[var(--color-success)]" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
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

  return (
    <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-3 sm:p-4">
      <Link
        to="/sessions/history"
        className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Sessions
      </Link>

      <div className="mb-3 flex items-start gap-3">
        <div className="mt-1 flex items-center gap-2" aria-live="polite" aria-atomic="true">
          <StatusDot status={health.status} />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {STATUS_LABELS[health.status]}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold text-[var(--color-text-primary)] sm:text-lg">
            {session.windowName || 'Untitled Session'}
          </h1>
          <div className="mt-0.5 truncate text-xs font-mono text-[#555]">
            {truncateMiddle(session.workDir, 40)}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {session.permissionMode && session.permissionMode !== 'default' && (
          <span className="rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-success)]">
            {session.permissionMode}
          </span>
        )}
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            health.alive
              ? 'border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-[#888]'
              : 'border-[var(--color-error)]/30 bg-[var(--color-error-bg)] text-[var(--color-error)]'
          }`}
        >
          {health.alive ? 'Alive' : 'Dead'}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-[#555]">
        <span>Created: {formatDate(session.createdAt)}</span>
        <span className="hidden sm:inline">Last activity: {formatDate(session.lastActivity)}</span>
        <span className="inline-flex items-center gap-1 font-mono">
          <span className="hidden sm:inline">ID:</span>
          {truncateMiddle(session.id, 16)}
          <CopyButton text={session.id} />
        </span>
        {session.ownerKeyId && (
          <span className="hidden font-mono sm:inline">
            Owner: {session.ownerKeyId.slice(0, 8)}
            {session.ownerKeyId.length > 8 ? '…' : ''}
          </span>
        )}
        {health.details && <span className="hidden italic text-[#888] sm:inline">{health.details}</span>}
      </div>

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
          className="hidden min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] sm:inline-flex"
        >
          Interrupt
        </button>

        <button
          type="button"
          onClick={onSaveTemplate}
          className="min-h-[44px] flex-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] sm:flex-none"
          title="Save this session as a template"
        >
          Save as Template
        </button>

        <button
          type="button"
          onClick={onFork}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] sm:flex-none"
          title="Fork this session"
        >
          <GitFork className="h-4 w-4" />
          Fork
        </button>

        <button
          type="button"
          onClick={onKill}
          className="hidden min-h-[44px] rounded border border-[var(--color-error)]/30 bg-[var(--color-error-bg)]/20 px-3 py-2 text-xs font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-bg)]/35 sm:ml-auto sm:inline-flex"
        >
          Kill
        </button>
      </div>
    </div>
  );
}
