/**
 * components/session/StreamTab.tsx — One Stream tab, three views.
 *
 * Issue 02 of the session-cockpit epic:
 *   - View mode lives in the URL (?view=terminal|transcript|split)
 *     so the choice survives reload and can be shared via link.
 *   - Default: Split on desktop, Transcript on mobile (viewport ≤ 768px).
 *   - Segmented control for the three views.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { UIState } from '../../types';
import { TerminalPassthrough } from './TerminalPassthrough';
import { TranscriptView } from './TranscriptView';
import { StreamSplitView } from './StreamSplitView';

type ViewMode = 'terminal' | 'transcript' | 'split';

const VIEW_MODES: readonly ViewMode[] = ['terminal', 'transcript', 'split'] as const;
const MOBILE_BREAKPOINT_PX = 768;

interface StreamTabProps {
  sessionId: string;
  status: UIState;
}

function isViewMode(value: string | null): value is ViewMode {
  return value !== null && (VIEW_MODES as readonly string[]).includes(value);
}

function detectDefaultView(): ViewMode {
  if (typeof window === 'undefined') return 'split';
  return window.innerWidth <= MOBILE_BREAKPOINT_PX ? 'transcript' : 'split';
}

export function StreamTab({ sessionId, status }: StreamTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Seed the view from ?view=… if present, otherwise from the viewport.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const fromUrl = searchParams.get('view');
    return isViewMode(fromUrl) ? fromUrl : detectDefaultView();
  });

  // On first render, if the URL didn't specify a view, stamp the default
  // in so back/forward navigation captures it.
  useEffect(() => {
    if (!isViewMode(searchParams.get('view'))) {
      const next = new URLSearchParams(searchParams);
      next.set('view', viewMode);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectView(mode: ViewMode) {
    setViewMode(mode);
    const next = new URLSearchParams(searchParams);
    next.set('view', mode);
    setSearchParams(next, { replace: false });
  }

  // Keep local state in sync with browser back/forward navigation.
  useEffect(() => {
    const urlView = searchParams.get('view');
    if (isViewMode(urlView) && urlView !== viewMode) {
      setViewMode(urlView);
    }
  }, [searchParams, viewMode]);

  return (
    <div className="flex flex-col h-full">
      {/* View mode selector */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-void-lighter)] bg-[var(--color-void)] shrink-0">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">
          View:
        </span>
        <div className="flex gap-1 bg-[var(--color-void-lighter)]/20 rounded-lg p-0.5" role="tablist" aria-label="Stream view">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={viewMode === mode}
              onClick={() => selectView(mode)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === mode
                  ? 'bg-[var(--color-accent)] text-[var(--color-void)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-lighter)]/30'
              }`}
            >
              {mode === 'terminal' ? 'Terminal' : mode === 'transcript' ? 'Transcript' : 'Split'}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          {viewMode === 'split' ? 'Terminal + Transcript' : viewMode === 'terminal' ? 'Live output' : 'Message history'}
        </div>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'terminal' && (
          <TerminalPassthrough sessionId={sessionId} status={status} />
        )}
        {viewMode === 'transcript' && (
          <TranscriptView sessionId={sessionId} />
        )}
        {viewMode === 'split' && (
          <StreamSplitView sessionId={sessionId} status={status} />
        )}
      </div>
    </div>
  );
}
