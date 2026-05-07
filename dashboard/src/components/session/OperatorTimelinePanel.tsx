/**
 * components/session/OperatorTimelinePanel.tsx — Wired operator timeline.
 *
 * Connects useSessionTimeline hook to OperatorTimeline component.
 * Shows clean empty state when no events are available.
 */

import { useSessionTimeline } from '../../hooks/useSessionTimeline';
import { OperatorTimeline } from './OperatorTimeline';

interface OperatorTimelinePanelProps {
  sessionId: string;
}

export function OperatorTimelinePanel({ sessionId }: OperatorTimelinePanelProps) {
  const {
    events,
    isLoading,
    error,
  } = useSessionTimeline(sessionId);

  if (error && events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-6 py-4 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            Timeline requires an active ACP backend connection.
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)] opacity-60">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <OperatorTimeline
      sessionId={sessionId}
      events={events}
      isLoading={isLoading}
    />
  );
}
