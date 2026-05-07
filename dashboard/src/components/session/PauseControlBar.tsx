/**
 * components/session/PauseControlBar.tsx — Pause/resume/intervention control bar.
 *
 * Renders contextual action buttons based on session and intervention state:
 * - Running session: "Pause" button
 * - Paused session: "Intervene" + "Resume" buttons
 * - Intervening session: "Complete Intervention" form + "Resume" button
 *
 * TODO: Wire to real hook once ACP-064 endpoints land.
 * TODO: Add keyboard shortcuts (e.g., Ctrl+Shift+P to pause).
 */

import { useState } from 'react';
import {
  Pause,
  Play,
  Hand,
  CheckCircle,
  Loader2,
} from 'lucide-react';

export interface PauseControlBarProps {
  /** Current session status from the session info. */
  sessionStatus?: string;
  /** Current intervention record, if any. */
  interventionStatus?: 'paused' | 'intervening' | 'resumed' | null;
  /** Whether an action is in progress. */
  isLoading?: boolean;
  /** Error message to display. */
  error?: string | null;
  /** Callback to clear the error. */
  onClearError?: () => void;
  /** Callback to pause the session. */
  onPause?: (reason: string) => Promise<void>;
  /** Callback to start an intervention. */
  onIntervene?: () => Promise<void>;
  /** Callback to complete an intervention with guidance. */
  onCompleteIntervention?: (guidance: string) => Promise<void>;
  /** Callback to resume the session. */
  onResume?: () => Promise<void>;
}

export function PauseControlBar({
  sessionStatus,
  interventionStatus,
  isLoading = false,
  error = null,
  onClearError,
  onPause,
  onIntervene,
  onCompleteIntervention,
  onResume,
}: PauseControlBarProps) {
  const [pauseReason, setPauseReason] = useState('');
  const [guidance, setGuidance] = useState('');
  const [showPauseForm, setShowPauseForm] = useState(false);
  const [showGuidanceForm, setShowGuidanceForm] = useState(false);

  const isRunning = sessionStatus === 'running' || sessionStatus === 'idle';
  const isPaused = interventionStatus === 'paused';
  const isIntervening = interventionStatus === 'intervening';
  const canAct = !isLoading && (isRunning || isPaused || isIntervening);

  const handlePause = async () => {
    if (!pauseReason.trim() || !onPause) return;
    await onPause(pauseReason.trim());
    setPauseReason('');
    setShowPauseForm(false);
  };

  const handleComplete = async () => {
    if (!onCompleteIntervention) return;
    await onCompleteIntervention(guidance.trim());
    setGuidance('');
    setShowGuidanceForm(false);
  };

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-3"
      role="toolbar"
      aria-label="Session pause and intervention controls"
    >
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded bg-red-500/10 px-3 py-2 text-sm text-red-400" role="alert">
          <span className="flex-1">{error}</span>
          {onClearError && (
            <button
              onClick={onClearError}
              className="text-red-400 hover:text-red-300"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Running state — show pause button */}
      {isRunning && (
        <div className="flex items-center gap-2">
          {!showPauseForm ? (
            <button
              onClick={() => setShowPauseForm(true)}
              disabled={!canAct}
              className="flex items-center gap-2 rounded-md bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Pause session"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <div className="flex flex-1 items-end gap-2">
              <div className="flex-1">
                <label htmlFor="pause-reason" className="mb-1 block text-xs text-[var(--color-text-muted)]">
                  Reason for pausing
                </label>
                <input
                  id="pause-reason"
                  type="text"
                  value={pauseReason}
                  onChange={(e) => setPauseReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePause()}
                  placeholder="e.g., security review needed"
                  className="w-full rounded-md border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-void-lighter)] focus:border-amber-500/50 focus:outline-none"
                  autoFocus
                />
              </div>
              <button
                onClick={handlePause}
                disabled={!pauseReason.trim() || isLoading}
                className="flex items-center gap-1 rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
                aria-label="Confirm pause"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                Confirm
              </button>
              <button
                onClick={() => { setShowPauseForm(false); setPauseReason(''); }}
                className="rounded-md border border-[var(--color-void-lighter)] px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                aria-label="Cancel pause"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Paused state — intervene or resume */}
      {isPaused && (
        <div className="flex items-center gap-2">
          <span className="rounded bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-400">
            Paused
          </span>
          <button
            onClick={() => onIntervene?.()}
            disabled={!canAct}
            className="flex items-center gap-2 rounded-md bg-blue-500/20 px-3 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-50"
            aria-label="Start intervention"
          >
            <Hand className="h-4 w-4" />
            Intervene
          </button>
          <button
            onClick={() => onResume?.()}
            disabled={!canAct}
            className="flex items-center gap-2 rounded-md bg-green-500/20 px-3 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-50"
            aria-label="Resume session"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Resume
          </button>
        </div>
      )}

      {/* Intervening state — complete intervention or resume */}
      {isIntervening && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-500/20 px-2 py-1 text-xs font-medium text-blue-400">
              Intervening
            </span>
            {!showGuidanceForm && (
              <button
                onClick={() => setShowGuidanceForm(true)}
                disabled={!canAct}
                className="flex items-center gap-2 rounded-md bg-blue-500/20 px-3 py-2 text-sm font-medium text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-50"
                aria-label="Complete intervention with guidance"
              >
                <CheckCircle className="h-4 w-4" />
                Complete Intervention
              </button>
            )}
          </div>

          {showGuidanceForm && (
            <div className="flex flex-col gap-2">
              <label htmlFor="intervention-guidance" className="text-xs text-[var(--color-text-muted)]">
                Guidance for the agent (optional)
              </label>
              <textarea
                id="intervention-guidance"
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder="Provide instructions for the agent to follow after resuming..."
                className="w-full rounded-md border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-void-lighter)] focus:border-blue-500/50 focus:outline-none resize-y"
                rows={3}
                autoFocus
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleComplete}
                  disabled={isLoading}
                  className="flex items-center gap-1 rounded-md bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-400 disabled:opacity-50"
                  aria-label="Submit guidance and complete intervention"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  Submit &amp; Resume
                </button>
                <button
                  onClick={() => { setShowGuidanceForm(false); setGuidance(''); }}
                  className="rounded-md border border-[var(--color-void-lighter)] px-3 py-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
                  aria-label="Cancel intervention completion"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!showGuidanceForm && (
            <button
              onClick={() => onResume?.()}
              disabled={!canAct}
              className="flex items-center gap-2 self-start rounded-md bg-green-500/20 px-3 py-2 text-sm font-medium text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-50"
              aria-label="Resume without guidance"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Resume without guidance
            </button>
          )}
        </div>
      )}
    </div>
  );
}
