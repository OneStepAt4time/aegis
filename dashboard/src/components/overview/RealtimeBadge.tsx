interface RealtimeBadgeProps {
  mode: 'polling' | 'paused';
  message: string;
}

const LABELS: Record<RealtimeBadgeProps['mode'], string> = {
  polling: 'Polling fallback',
  paused: 'Live updates paused',
};

export default function RealtimeBadge({ mode, message }: RealtimeBadgeProps) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-2.5 py-1 text-[11px] font-medium text-amber-300"
      title={message}
    >
      {LABELS[mode]}
    </span>
  );
}