/**
 * components/pipeline/PipelineStatusBadge.tsx — Status badge for pipeline states.
 */

interface PipelineStatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-cyan/10 text-cyan border-cyan/30',
  completed: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
  failed: 'bg-red-400/10 text-red-400 border-red-400/30',
  pending: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

const PULSE_STATUSES = new Set(['running']);

export default function PipelineStatusBadge({ status }: PipelineStatusBadgeProps) {
  const styles = STATUS_STYLES[status] ?? 'bg-gray-500/10 text-gray-500 border-gray-500/30';
  const shouldPulse = PULSE_STATUSES.has(status);

  return (
    <span
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
