/**
 * SessionControls — Sidebar with status, metadata, quick actions, and permission prompt.
 *
 * Displayed alongside the main content area on the Session Detail page.
 */

import { useState } from 'react';
import type { SessionHealth, SessionInfo, UIState } from '../../types';

interface SessionControlsProps {
  session: SessionInfo;
  health: SessionHealth;
  onApprove: () => void;
  onReject: () => void;
  onInterrupt: () => void;
  onEscape: () => void;
  onSend: (text: string) => void;
}

function statusColor(status: UIState): string {
  switch (status) {
    case 'idle': return 'bg-[var(--color-success)]';
    case 'working':
    case 'compacting': return 'bg-[var(--color-accent)]';
    case 'permission_prompt':
    case 'bash_approval': return 'bg-[var(--color-warning)]';
    case 'error': return 'bg-[var(--color-error)]';
    default: return 'bg-[var(--color-text-muted)]';
  }
}

function statusLabel(status: UIState): string {
  switch (status) {
    case 'idle': return 'Idle';
    case 'working': return 'Working';
    case 'compacting': return 'Compacting';
    case 'context_warning': return 'Context Warning';
    case 'waiting_for_input': return 'Waiting';
    case 'permission_prompt': return 'Permission';
    case 'plan_mode': return 'Plan Mode';
    case 'ask_question': return 'Question';
    case 'bash_approval': return 'Bash Approval';
    case 'settings': return 'Settings';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function SessionControls({
  session,
  health,
  onApprove,
  onReject,
  onInterrupt,
  onEscape,
  onSend,
}: SessionControlsProps) {
  const [sendInput, setSendInput] = useState('');
  const [sendOpen, setSendOpen] = useState(false);

  const needsApproval = health.status === 'permission_prompt' || health.status === 'bash_approval';
  const isWorking = health.status === 'working';
  const alive = health.alive;

  function handleSendSubmit() {
    const text = sendInput.trim();
    if (!text) return;
    onSend(text);
    setSendInput('');
    setSendOpen(false);
  }

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      {/* Session Info */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
          Session Info
        </h2>

        {/* Status badge */}
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor(health.status)}`} />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {statusLabel(health.status)}
          </span>
        </div>

        {/* Metadata */}
        <div className="space-y-1.5 text-xs text-[var(--color-text-muted)]">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--color-text-primary)]">Work Dir:</span>
            <span className="font-mono truncate" title={session.workDir}>
              {session.workDir}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--color-text-primary)]">Created:</span>
            <span>{formatRelativeTime(session.createdAt)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-[var(--color-text-primary)]">Last Activity:</span>
            <span>{formatRelativeTime(session.lastActivity)}</span>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-[var(--color-void-lighter)]" />

      {/* Quick Actions */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
          Quick Actions
        </h2>

        <div className="space-y-2">
          {/* Send Message */}
          <div>
            <button
              type="button"
              onClick={() => setSendOpen((v) => !v)}
              disabled={!alive}
              className="w-full min-h-[44px] rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Send Message
            </button>
            {sendOpen && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={sendInput}
                  onChange={(e) => setSendInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendSubmit();
                    }
                  }}
                  placeholder="Type a message..."
                  disabled={!alive}
                  className="w-full min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-mono text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-cta-bg)] focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSendSubmit}
                  disabled={!sendInput.trim() || !alive}
                  className="w-full min-h-[36px] rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Send
                </button>
              </div>
            )}
          </div>

          {/* Interrupt */}
          <button
            type="button"
            onClick={onInterrupt}
            disabled={!isWorking || !alive}
            className="w-full min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Interrupt
          </button>

          {/* Escape */}
          <button
            type="button"
            onClick={onEscape}
            disabled={!alive}
            className="w-full min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-lighter)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            Escape
          </button>
        </div>
      </div>

      {/* Permission Prompt — only when approval needed */}
      {needsApproval && (
        <>
          <div className="border-t border-[var(--color-void-lighter)]" />
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-warning)] mb-3">
              Permission Required
            </h2>
            <div className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-3 mb-3">
              <p className="text-xs text-[var(--color-text-primary)] break-words">
                {session.pendingPermission?.prompt ?? health.details ?? 'Permission request pending'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onApprove}
                className="flex-1 min-h-[44px] rounded border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-xs font-medium text-[var(--color-success)] transition-colors hover:bg-[var(--color-success)]/20"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={onReject}
                className="flex-1 min-h-[44px] rounded border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-xs font-medium text-[var(--color-error)] transition-colors hover:bg-[var(--color-error)]/20"
              >
                Reject
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
