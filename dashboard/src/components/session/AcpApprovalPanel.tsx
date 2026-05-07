/**
 * components/session/AcpApprovalPanel.tsx — Wired ACP approval panel.
 *
 * Connects useAcpApproval hook to AcpApprovalModal component.
 * Shows nothing when no approval is pending (clean empty state).
 */

import { useAcpApproval } from '../../hooks/useAcpApproval';
import { AcpApprovalModal } from './AcpApprovalModal';

interface AcpApprovalPanelProps {
  sessionId: string;
}

export function AcpApprovalPanel({ sessionId }: AcpApprovalPanelProps) {
  const {
    approval,
    countdown,
    isExpired,
    isLoading,
    error,
    clearError,
    approve,
    reject,
  } = useAcpApproval({ sessionId });

  // No pending approval — clean empty state, nothing to show
  if (!approval) {
    return (
      <div className="flex items-center justify-center p-4">
        <p className="text-xs text-[var(--color-text-muted)] opacity-60">
          No pending approvals
        </p>
      </div>
    );
  }

  return (
    <AcpApprovalModal
      approval={approval}
      countdown={countdown}
      isExpired={isExpired}
      isLoading={isLoading}
      error={error}
      onClearError={clearError}
      onApprove={approve}
      onReject={reject}
    />
  );
}
