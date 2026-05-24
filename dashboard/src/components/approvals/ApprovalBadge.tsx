/**
 * components/approvals/ApprovalBadge.tsx — Pending approval count badge.
 *
 * Displays the number of sessions awaiting approval.
 * Can be used in sidebar, header, or session list.
 */

interface ApprovalBadgeProps {
  count: number;
  className?: string;
}

export function ApprovalBadge({ count, className = '' }: ApprovalBadgeProps) {
  if (count <= 0) return null;

  return (
    <span
      className={`inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-[10px] font-bold leading-none text-white ${className}`}
      aria-label={`${count} session${count !== 1 ? 's' : ''} awaiting approval`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
