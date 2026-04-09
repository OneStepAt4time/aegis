import { useState } from 'react';
import type { SessionInfo, SessionHealth, UIState } from '../../types';
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

function truncateMiddle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const start = s.slice(0, Math.ceil(maxLen / 2) - 1);
  const end = s.slice(-(Math.floor(maxLen / 2) - 2));
  return `${start}â€¦${end}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionHeader({ session, health, onApprove, onReject, onInterrupt, onKill, onSaveTemplate, onFork }: SessionHeaderProps) {
  const [confirmKill, setConfirmKill] = useState(false);
  const needsApproval = health.status === 'permission_prompt' || health.status === 'bash_approval';

  return (
    <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg p-3 sm:p-4">
      {/* Top row: status + name + badges */}
      <div className="flex items-start gap-3 mb-3">
        <div className="flex items-center gap-2 mt-1">
          <StatusDot status={health.status} />
          <span className="text-sm font-medium text-[#e0e0e0]">
            {STATUS_LABELS[health.status]}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-base sm:text-lg font-semibold text-[#e0e0e0] truncate">
            {session.windowName || 'Untitled Session'}
          </h1>
          <div className="text-xs text-[#555] font-mono truncate mt-0.5">
            {truncateMiddle(session.workDir, 40)}
          </div>
        </div>

        {/* Badges */}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          {session.permissionMode && session.permissionMode !== 'default' && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[#003322] text-[#10b981] border border-[#10b981]/30">
              {session.permissionMode}
            </span>
          )}
          {health.alive ? (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[#111118] text-[#888] border border-[#1a1a2e]">
              Alive
            </span>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-[#331111] text-[#ef4444] border border-[#ef4444]/30">
              Dead
            </span>
          )}
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-3 sm:gap-4 text-[11px] text-[#555] mb-3 flex-wrap">
        <span>Created: {formatDate(session.createdAt)}</span>
        <span className="hidden sm:inline">Last activity: {formatDate(session.lastActivity)}</span>
        <span className="font-mono hidden sm:inline">ID: {truncateMiddle(session.id, 16)}</span>
        {session.ownerKeyId && (
          <span className="font-mono hidden sm:inline">Owner: {session.ownerKeyId.slice(0, 8)}{session.ownerKeyId.length > 8 ? '…' : ''}</span>
        )}
        {health.details && <span className="text-[#888] italic">{health.details}</span>}
      </div>

      {/* Quick actions â€” wrap on mobile */}
      <div className="flex flex-wrap items-center gap-2">
        {needsApproval && (
          <>
            <button
              onClick={onApprove}
              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#003322] hover:bg-[#004433] text-[#10b981] border border-[#10b981]/30 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={onReject}
              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#331111] hover:bg-[#442222] text-[#ef4444] border border-[#ef4444]/30 transition-colors"
            >
              Reject
            </button>
          </>
        )}

        <button
          onClick={onInterrupt}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#e0e0e0] border border-[#1a1a2e] transition-colors"
        >
          Interrupt
        </button>

        <button
          onClick={onSaveTemplate}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#e0e0e0] border border-[#1a1a2e] transition-colors"
          title="Save this session as a template"
        >
          Save as Template
        </button>

        <button
          onClick={onFork}
          className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#e0e0e0] border border-[#1a1a2e] transition-colors"
          title="Fork this session"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 inline mr-1"
          >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          Fork
        </button>

        {!confirmKill ? (
          <button
            onClick={() => setConfirmKill(true)}
            className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#e0e0e0] border border-[#1a1a2e] transition-colors ml-auto"
          >
            Kill
          </button>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-[#ef4444]">Confirm kill?</span>
            <button
              onClick={() => { onKill?.(); setConfirmKill(false); }}
              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#331111] text-[#ef4444] border border-[#ef4444]/30 transition-colors"
            >
              Yes, Kill
            </button>
            <button
              onClick={() => setConfirmKill(false)}
              className="min-h-[44px] px-3 py-2 text-xs font-medium rounded bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#e0e0e0] border border-[#1a1a2e] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

