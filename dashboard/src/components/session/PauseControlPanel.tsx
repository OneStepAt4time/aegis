/**
 * components/session/PauseControlPanel.tsx — Wired pause/resume/intervention controls.
 *
 * Connects useSessionIntervention hook to PauseControlBar component.
 * Shows clean empty state when no intervention is active.
 */

import { useSessionIntervention } from '../../hooks/useSessionIntervention';
import { PauseControlBar } from './PauseControlBar';

interface PauseControlPanelProps {
  sessionId: string;
  sessionStatus?: string;
}

export function PauseControlPanel({ sessionId, sessionStatus }: PauseControlPanelProps) {
  const {
    intervention,
    isLoading,
    error,
    clearError,
    pause,
    intervene,
    completeIntervention,
    resume,
  } = useSessionIntervention(sessionId);

  // Derive intervention status from the record
  const interventionStatus = intervention?.status ?? null;

  return (
    <PauseControlBar
      sessionStatus={sessionStatus}
      interventionStatus={interventionStatus}
      isLoading={isLoading}
      error={error}
      onClearError={clearError}
      onPause={async (reason) => { await pause({ reason }); }}
      onIntervene={async () => { await intervene(); }}
      onCompleteIntervention={async (guidance) => { await completeIntervention({ guidance }); }}
      onResume={async () => { await resume(); }}
    />
  );
}
