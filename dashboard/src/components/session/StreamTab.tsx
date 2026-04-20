import { useState } from 'react';
import type { UIState } from '../../types';
import { TerminalPassthrough } from './TerminalPassthrough';
import { TranscriptView } from './TranscriptView';
import { StreamSplitView } from './StreamSplitView';

type ViewMode = 'terminal' | 'transcript' | 'split';

interface StreamTabProps {
  sessionId: string;
  status: UIState;
}

export function StreamTab({ sessionId, status }: StreamTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('terminal');

  return (
    <div className="flex flex-col h-full">
      {/* View mode selector */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-void-lighter)] bg-[var(--color-void)] shrink-0">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">View:</span>
        <div className="flex gap-1 bg-[var(--color-void-lighter)]/20 rounded-lg p-0.5">
          {(['terminal', 'transcript', 'split'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
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
          {viewMode === 'split' ? 'Terminal ⋅ Transcript' : viewMode === 'terminal' ? 'Live output' : 'Message history'}
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
