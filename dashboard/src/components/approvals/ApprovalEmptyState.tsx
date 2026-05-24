/**
 * components/approvals/ApprovalEmptyState.tsx — Empty state for no pending approvals.
 */

import { CheckCircle2 } from 'lucide-react';

export function ApprovalEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success)]/10">
        <CheckCircle2 className="h-6 w-6 text-[var(--color-success)]" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-[var(--color-text-primary)]">
          No sessions pending approval
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          When a session needs your approval, it will appear here.
        </p>
      </div>
    </div>
  );
}
