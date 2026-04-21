import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageSquare } from 'lucide-react';
import type { ParsedEntry } from '../../types';
import { useSessionEventsStore, selectSession } from '../../store/useSessionEventsStore';
import { TranscriptBubble } from './TranscriptBubble';

interface TranscriptViewProps {
  sessionId: string;
}

interface FilterState {
  thinking: boolean;
  tool_use: boolean;
  tool_result: boolean;
}

export function TranscriptView({ sessionId }: TranscriptViewProps) {
  const storeState = useSessionEventsStore((s) => selectSession(s, sessionId));
  const { entries, loading, error, seekMs, seekNonce } = storeState;

  const [filters, setFilters] = useState<FilterState>({
    thinking: false,
    tool_use: true,
    tool_result: true,
  });
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  const filteredMessages = useMemo(() => entries.filter(entry => {
    if (entry.role === 'user') return true;
    if (entry.contentType === 'thinking' && !filters.thinking) return false;
    if (entry.contentType === 'tool_use' && !filters.tool_use) return false;
    if (entry.contentType === 'tool_result' && !filters.tool_result) return false;
    return true;
  }), [entries, filters]);

  const getItemKey = useCallback((index: number) => {
    const entry = filteredMessages[index];
    return entry.toolUseId ?? `${entry.role}-${entry.timestamp ?? `${index}`}`;
  }, [filteredMessages]);

  const estimateSize = useCallback((index: number): number => {
    const entry = filteredMessages[index];
    if (!entry) return 80;
    switch (entry.contentType) {
      case 'thinking': return 36;
      case 'tool_use': return 100;
      case 'tool_result': return 110;
      case 'tool_error': return 110;
      case 'permission_request': return 80;
      case 'progress': return 40;
      default: return 80;
    }
  }, [filteredMessages]);

  const virtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => containerRef.current,
    estimateSize,
    overscan: 10,
    getItemKey,
    scrollMargin: 16,
  });

  // Auto-scroll to bottom when new entries arrive (unless user has scrolled up)
  useEffect(() => {
    if (!userScrolledRef.current && filteredMessages.length > 0) {
      virtualizer.scrollToIndex(filteredMessages.length - 1, { align: 'end' });
    }
  }, [filteredMessages.length, virtualizer]);

  // Seek-scroll: when the timeline sparkline fires a seek, jump to the
  // nearest transcript entry by timestamp. seekNonce ensures repeated seeks
  // to the same ms still trigger the effect.
  useEffect(() => {
    if (seekMs === null || filteredMessages.length === 0) return;

    let nearestIdx = 0;
    let nearestDelta = Infinity;
    for (let i = 0; i < filteredMessages.length; i++) {
      const ts = filteredMessages[i].timestamp;
      if (!ts) continue;
      const delta = Math.abs(Date.parse(ts) - seekMs);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearestIdx = i;
      }
    }
    userScrolledRef.current = true;
    virtualizer.scrollToIndex(nearestIdx, { align: 'start' });
    setFocusedIndex(nearestIdx);
  // seekNonce intentionally in deps so repeated same-ms seeks still fire
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekNonce]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledRef.current = !atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false;
    if (filteredMessages.length > 0) {
      virtualizer.scrollToIndex(filteredMessages.length - 1, { align: 'end' });
    }
  }, [filteredMessages.length, virtualizer]);

  const toggleFilter = useCallback((key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Keyboard navigation: j/k to move between bubbles
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'j') {
        e.preventDefault();
        setFocusedIndex(prev => Math.min(prev + 1, filteredMessages.length - 1));
      } else if (e.key === 'k') {
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredMessages.length]);

  // Listen for copy-transcript-up-to events
  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ index: number }>;
      const upToIndex = customEvent.detail.index;
      const transcript = filteredMessages
        .slice(0, upToIndex + 1)
        .map((m: ParsedEntry) => `[${m.timestamp}] ${m.role}: ${m.text}`)
        .join('\n\n');
      void navigator.clipboard.writeText(transcript);
    };
    window.addEventListener('copy-transcript-up-to', handler);
    return () => window.removeEventListener('copy-transcript-up-to', handler);
  }, [filteredMessages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        <div className="animate-pulse">Loading transcript…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-danger)] text-sm">
        ⚠ {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--color-void-lighter)] bg-[var(--color-void)] shrink-0">
        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Filter:</span>
        {(['thinking', 'tool_use', 'tool_result'] as const).map(key => (
          <button
            key={key}
            onClick={() => toggleFilter(key)}
            aria-pressed={filters[key]}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              filters[key]
                ? 'border-[var(--color-accent)]/40 text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-void-lighter)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {key === 'tool_use' ? 'Tools' : key === 'tool_result' ? 'Results' : key}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
          {filteredMessages.length} / {entries.length}
        </span>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {filteredMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--color-text-muted)] text-center gap-3">
            <MessageSquare
              size={24}
              className="opacity-20 scale-[2]"
              aria-hidden="true"
            />
            <div className="text-sm">No messages yet</div>
            <div className="text-xs opacity-60 font-mono">⌘↵ to send · /help for commands · /cost to check spend</div>
          </div>
        )}
        {filteredMessages.length > 0 && (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: virtualItem.start,
                  left: 0,
                  right: 0,
                }}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
              >
                <TranscriptBubble
                  entry={filteredMessages[virtualItem.index]}
                  index={virtualItem.index}
                  focused={focusedIndex === virtualItem.index}
                  onFocus={setFocusedIndex}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-[var(--color-void-lighter)] hover:bg-[var(--color-surface-hover)] text-[var(--color-accent)] rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-[var(--color-void-lighter)] transition-colors z-10"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
