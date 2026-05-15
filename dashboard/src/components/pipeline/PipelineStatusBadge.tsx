/**
 * components/pipeline/PipelineStatusBadge.tsx — Status badge for pipeline states.
 */

interface PipelineStatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-cyan/10 text-cyan border-cyan/30',
  completed: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
  failed: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-red-400/30',
  pending: 'bg-[var(--color-void-lighter)] text-[var(--color-text-muted)] border-[var(--color-void-lighter)]',
};

const PULSE_STATUSES = new Set(['running']);

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  pending: 'Pending',
};

export default function PipelineStatusBadge({ status }: PipelineStatusBadgeProps) {
  const styles = STATUS_STYLES[status] ?? 'bg-[var(--color-void-lighter)] text-[var(--color-text-muted)] border-[var(--color-void-lighter)]';
  const shouldPulse = PULSE_STATUSES.has(status);
  const label = STATUS_LABELS[status] ?? status;

  return (
    <span
      role="status"
      aria-label={`Pipeline status: ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles}`}
    >
      {shouldPulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-current" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
        </span>
      )}
      {status}
    </span>
  );
}
