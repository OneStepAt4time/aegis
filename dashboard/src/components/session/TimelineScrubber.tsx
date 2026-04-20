/**
 * components/session/TimelineScrubber.tsx — Interactive timeline for session events.
 * Shows message/tool/approval/permission events. Drag to seek, keyboard nav.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Wrench, CheckCircle, ShieldAlert } from 'lucide-react';

export interface TimelineEvent {
  timestamp: number;
  type: 'message' | 'tool' | 'approval' | 'permission';
}

interface TimelineScrubberProps {
  events: TimelineEvent[];
  currentTime?: number;
  onSeek?: (timestamp: number) => void;
  className?: string;
}

const EVENT_COLORS = {
  message: 'var(--color-accent-cyan)',
  tool: 'var(--color-accent-purple)',
  approval: 'var(--color-success)',
  permission: 'var(--color-warning)',
};

const EVENT_ICONS = {
  message: MessageSquare,
  tool: Wrench,
  approval: CheckCircle,
  permission: ShieldAlert,
};

export function TimelineScrubber({ events, currentTime, onSeek, className = '' }: TimelineScrubberProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const minTime = events.length > 0 ? Math.min(...events.map(e => e.timestamp)) : 0;
  const maxTime = events.length > 0 ? Math.max(...events.map(e => e.timestamp)) : 0;
  const duration = maxTime - minTime || 1;
  
  const getTimeForPosition = useCallback((clientX: number): number => {
    if (!containerRef.current) return minTime;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return minTime + ratio * duration;
  }, [minTime, duration]);
  
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const time = getTimeForPosition(e.clientX);
    onSeek?.(time);
  };
  
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const time = getTimeForPosition(e.clientX);
    setHoverTime(time);
  };
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  const handleMouseLeave = () => {
    setHoverTime(null);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!events.length) return;
    
    const currentIdx = currentTime 
      ? events.findIndex(ev => ev.timestamp >= currentTime)
      : 0;
    
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.shiftKey) {
        // Jump back 1 minute
        const target = (currentTime || maxTime) - 60000;
        onSeek?.(Math.max(minTime, target));
      } else {
        // Previous event
        const prevIdx = Math.max(0, currentIdx - 1);
        onSeek?.(events[prevIdx].timestamp);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.shiftKey) {
        // Jump forward 1 minute
        const target = (currentTime || minTime) + 60000;
        onSeek?.(Math.min(maxTime, target));
      } else {
        // Next event
        const nextIdx = Math.min(events.length - 1, currentIdx + 1);
        onSeek?.(events[nextIdx].timestamp);
      }
    }
  };
  
  useEffect(() => {
    if (isDragging) {
      const globalMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return;
        const time = getTimeForPosition(e.clientX);
        onSeek?.(time);
      };
      
      window.addEventListener('mousemove', globalMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', globalMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseUp, onSeek, getTimeForPosition]);
  
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  if (events.length === 0) {
    return (
      <div className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 ${className}`}>
        <div className="text-xs text-[var(--color-text-muted)] text-center">No timeline events</div>
      </div>
    );
  }
  
  return (
    <div className={`rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3 ${className}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-medium text-[var(--color-text-primary)]">Timeline</div>
        <div className="flex items-center gap-3 text-[10px] text-[var(--color-text-muted)]">
          {Object.entries(EVENT_ICONS).map(([type, Icon]) => {
            const count = events.filter(e => e.type === type).length;
            if (count === 0) return null;
            return (
              <div key={type} className="flex items-center gap-1">
                <Icon className="h-3 w-3" style={{ color: EVENT_COLORS[type as keyof typeof EVENT_COLORS] }} />
                <span>{count}</span>
              </div>
            );
          })}
        </div>
      </div>
      
      <div
        ref={containerRef}
        className="relative h-12 cursor-pointer select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuemin={minTime}
        aria-valuemax={maxTime}
        aria-valuenow={currentTime || minTime}
      >
        {/* Background track */}
        <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-[var(--color-void-lighter)]" />
        
        {/* Progress bar */}
        {currentTime && (
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--color-accent-cyan)]"
            style={{ width: `${((currentTime - minTime) / duration) * 100}%` }}
          />
        )}
        
        {/* Event markers */}
        {events.map((event, idx) => {
          const Icon = EVENT_ICONS[event.type];
          const position = ((event.timestamp - minTime) / duration) * 100;
          
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSeek?.(event.timestamp)}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full p-1 transition-transform hover:scale-125"
              style={{ 
                left: `${position}%`,
                backgroundColor: EVENT_COLORS[event.type],
              }}
              title={`${event.type} at ${formatTime(event.timestamp)}`}
            >
              <Icon className="h-2.5 w-2.5 text-[var(--color-void)]" />
            </button>
          );
        })}
        
        {/* Current position indicator */}
        {currentTime && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-text-primary)] opacity-75"
            style={{ left: `${((currentTime - minTime) / duration) * 100}%` }}
          />
        )}
        
        {/* Hover tooltip */}
        {hoverTime !== null && !isDragging && (
          <div
            className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-[10px] text-[var(--color-text-primary)] shadow-lg"
            style={{ left: `${((hoverTime - minTime) / duration) * 100}%` }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
      </div>
      
      <div className="mt-2 flex justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>{formatTime(minTime)}</span>
        <span className="italic">← → to step, shift+← → by minute</span>
        <span>{formatTime(maxTime)}</span>
      </div>
    </div>
  );
}
