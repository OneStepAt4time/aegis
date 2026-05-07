/**
 * components/session/DriverControlPanel.tsx — Wired driver/observer controls.
 *
 * Connects useSessionParticipants hook to DriverControlBar component.
 * Shows clean empty state when no participant data is available.
 */

import { useSessionParticipants } from '../../hooks/useSessionParticipants';
import { DriverControlBar } from './DriverControlBar';

interface DriverControlPanelProps {
  sessionId: string;
  currentUserId?: string;
}

export function DriverControlPanel({ sessionId, currentUserId }: DriverControlPanelProps) {
  const {
    participants,
    isLoading,
    error,
    clearError,
    claim,
    release,
    transfer,
  } = useSessionParticipants(sessionId);

  const isDriver = participants?.driver?.subscriberId === currentUserId;

  return (
    <DriverControlBar
      participants={participants}
      currentUserId={currentUserId}
      isDriver={isDriver}
      isLoading={isLoading}
      error={error}
      onClearError={clearError}
      onClaim={async () => { await claim(); }}
      onRelease={async () => { await release(); }}
      onTransfer={async (targetId, reason) => { await transfer({ targetSubscriberId: targetId, reason }); }}
    />
  );
}
