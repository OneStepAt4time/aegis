/**
 * ApprovalNotification — global toast + sidebar badge for pending approvals.
 *
 * Shows a toast when a new approval_request arrives, and a badge
 * in the header with the count of pending approvals.
 *
 * Related: #3622 Tier 1
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useApprovalStore } from "../../store/useApprovalStore";
import { useToastStore } from "../../store/useToastStore";
import { useT } from '../../i18n/context';

/**
 * ApprovalNotification — invisible component that watches for new
 * pending approvals and shows toasts.
 *
 * Place this once in the app root or Layout.
 */
export function ApprovalNotification() {
  const t = useT();
  // Subscribe to the Map (stable reference) — NOT s.list() which creates new arrays
  const pending = useApprovalStore((s) => s.pending);
  const count = pending.size;
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const previousCount = useRef(count);
  const knownIds = useRef(new Set<string>());

  // Show toast when new approval arrives
  useEffect(() => {
    if (count > previousCount.current) {
      const list = Array.from(pending.values());
      for (const approval of list) {
        if (!knownIds.current.has(approval.sessionId)) {
          knownIds.current.add(approval.sessionId);
          addToast(
            "warning",
            t('sessionDetail.permissionRequiredToast', { name: approval.sessionName }),
            t('sessionDetail.clickToReview'),
            { duration: 15_000 },
          );
        }
      }
    }
    previousCount.current = count;

    // Clean up known IDs for removed approvals
    const currentIds = new Set(pending.keys());
    for (const id of knownIds.current) {
      if (!currentIds.has(id)) knownIds.current.delete(id);
    }
  }, [count, pending, addToast, navigate]);

  return null;
}

/**
 * ApprovalBadge — renders the pending count badge.
 * Place in the header toolbar.
 */
export function ApprovalBadge() {
  // Subscribe to pending Map size (primitive, no re-render loop)
  const count = useApprovalStore((s) => s.pending.size);

  if (count === 0) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning)]/20 border border-[var(--color-warning)]/30 px-2 py-0.5 text-xs font-bold text-[var(--color-warning-glow)] cursor-pointer"
      aria-label={`${count} pending approval${count > 1 ? "s" : ""}`}
      title={`${count} session${count > 1 ? "s" : ""} awaiting approval`}
    >
      <AlertTriangle className="h-3 w-3" />
      {count}
    </span>
  );
}
