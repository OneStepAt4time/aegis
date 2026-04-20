import { useState, useRef, useEffect } from 'react';
import type { UIState } from '../../types';
import { TerminalPassthrough } from './TerminalPassthrough';
import { TranscriptView } from './TranscriptView';

interface StreamSplitViewProps {
  sessionId: string;
  status: UIState;
}

export function StreamSplitView({ sessionId, status }: StreamSplitViewProps) {
  const [leftWidth, setLeftWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.max(20, Math.min(80, newWidth)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={containerRef}
      className="flex h-full relative"
      style={{ userSelect: isDragging ? 'none' : 'auto' }}
    >
      {/* Left pane: Terminal */}
      <div
        className="h-full overflow-hidden border-r border-[var(--color-void-lighter)]"
        style={{ width: `${leftWidth}%` }}
      >
        <TerminalPassthrough sessionId={sessionId} status={status} />
      </div>

      {/* Drag handle */}
      <button
        type="button"
        onMouseDown={handleMouseDown}
        className={`w-1 h-full bg-[var(--color-void-lighter)] hover:bg-[var(--color-accent)] cursor-col-resize transition-colors shrink-0 ${
          isDragging ? 'bg-[var(--color-accent)]' : ''
        }`}
        aria-label="Resize panes"
      />

      {/* Right pane: Transcript */}
      <div
        className="h-full overflow-hidden"
        style={{ width: `${100 - leftWidth}%` }}
      >
        <TranscriptView sessionId={sessionId} />
      </div>
    </div>
  );
}
