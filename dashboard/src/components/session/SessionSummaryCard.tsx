import type { SessionSummary, UIState } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from '../overview/StatusDot';

const STATUS_LABELS: Record<UIState, string> = {
  idle: 'Idle',
  working: 'Working',
  permission_prompt: 'Permission prompt',
  bash_approval: 'Bash approval',
  plan_mode: 'Plan mode',
  ask_question: 'Awaiting question',
  settings: 'Settings',
  error: 'Error',
  compacting: 'Compacting',
  context_warning: 'Context warning',
  waiting_for_input: 'Waiting for input',
  unknown: 'Unknown',
};

interface SessionSummaryCardProps {
  summary: SessionSummary | null;
  loading: boolean;
}

export function SessionSummaryCard({ summary, loading }: SessionSummaryCardProps) {
  if (loading) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg px-4 py-3 animate-pulse text-[#555] text-xs">
        Loading summary…
      </div>
    );
  }

  if (!summary) return null;

  // Compute per-role message counts
  const roleCounts: Record<string, number> = {};
  for (const msg of summary.messages) {
    roleCounts[msg.role] = (roleCounts[msg.role] ?? 0) + 1;
  }
  const roles = Object.entries(roleCounts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div
      aria-label="Session summary"
      role="region"
      className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs"
    >
      {/* Total messages */}
      <div className="flex items-center gap-1.5">
        <span className="text-[#555] uppercase tracking-wider">Messages</span>
        <span className="font-mono font-semibold text-[var(--color-accent-cyan)]">{summary.totalMessages}</span>
      </div>

      {/* Per-role breakdown */}
      {roles.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[#555] uppercase tracking-wider">By role</span>
          <div className="flex gap-2">
            {roles.map(([role, count]) => (
              <span
                key={role}
                className="font-mono text-[#888] bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded px-1.5 py-0.5"
              >
                {role}{' '}<span className="text-[var(--color-accent-cyan)]">{count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className="text-[#555] uppercase tracking-wider">Status</span>
        <StatusDot status={summary.status} />
        <span className="text-[var(--color-text-primary)]">{STATUS_LABELS[summary.status] ?? summary.status}</span>
      </div>

      {/* Session age */}
      <div className="flex items-center gap-1.5">
        <span className="text-[#555] uppercase tracking-wider">Age</span>
        <span className="text-[var(--color-text-primary)] font-mono">{formatTimeAgo(summary.createdAt)}</span>
      </div>
    </div>
  );
}
