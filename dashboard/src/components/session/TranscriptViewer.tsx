import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ParsedEntry } from '../../types';
import { getSessionMessages, subscribeSSE } from '../../api/client';
import { useStore } from '../../store/useStore';
import { MessageBubble } from './MessageBubble';

const MAX_SESSION_MESSAGES = 1000;
const ESTIMATED_MESSAGE_HEIGHT_PX = 88;
const VIRTUAL_OVERSCAN_ROWS = 8;
const VIRTUAL_ROW_GAP_PX = 12;
const DEFAULT_VIEWPORT_HEIGHT_PX = 480;
const SCROLL_BOTTOM_THRESHOLD_PX = 60;

/** Composite dedup key: timestamp + content fingerprint (fixes #512) */
function dedupKey(m: ParsedEntry): string {
  return `${m.timestamp ?? ''}:${m.role}:${m.contentType}:${m.text.length}:${m.text.slice(0, 80)}`;
}

function messageKey(entry: ParsedEntry, index: number): string {
  return entry.toolUseId ?? `${entry.role}:${entry.contentType}:${entry.timestamp ?? index}:${entry.text.slice(0, 80)}`;
}

interface TranscriptViewerProps {
  sessionId: string;
}

interface FilterState {
  thinking: boolean;
  tool_use: boolean;
  tool_result: boolean;
}

export function TranscriptViewer({ sessionId }: TranscriptViewerProps) {
  const [messages, setMessages] = useState<ParsedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const token = useStore((s) => s.token);
  const [filters, setFilters] = useState<FilterState>({
    thinking: false,
    tool_use: true,
    tool_result: true,
  });
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const seenKeys = useRef<Set<string>>(new Set());

  // Fetch initial messages via API client
  useEffect(() => {
    let cancelled = false;

    getSessionMessages(sessionId)
      .then(data => {
        if (!cancelled) {
          const msgs = data.messages ?? [];
          const capped = msgs.length > MAX_SESSION_MESSAGES
            ? msgs.slice(msgs.length - MAX_SESSION_MESSAGES)
            : msgs;
          setMessages(capped);
          seenKeys.current = new Set(capped.map(dedupKey));
        }
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  // #124: SSE for real-time messages — uses client subscribeSSE which handles auth
  useEffect(() => {
    const unsubscribe = subscribeSSE(sessionId, (e) => {
      try {
        const raw = JSON.parse(e.data as string);
        // Issue #261: Only process message events; skip status, heartbeat,
        // approval, stall, dead, ended, hook, and subagent events.
        if (raw.event !== 'message') return;
        const data: ParsedEntry = raw.data;
        setMessages(prev => {
          const key = dedupKey(data);
          if (seenKeys.current.has(key)) return prev;
          seenKeys.current.add(key);
          const next = [...prev, data];
          if (next.length > MAX_SESSION_MESSAGES) {
            const evictedCount = next.length - MAX_SESSION_MESSAGES;
            const capped = next.slice(evictedCount);
            // Incrementally remove keys for evicted messages only
            for (let i = 0; i < evictedCount; i++) {
              seenKeys.current.delete(dedupKey(next[i]));
            }
            return capped;
          }
          return next;
        });
      } catch {
        // ignore malformed events
      }
    }, token);

    return () => unsubscribe();
  }, [sessionId, token]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
    userScrolledRef.current = !atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    userScrolledRef.current = false;
    setShowScrollBtn(false);

    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }

    bottomRef.current?.scrollIntoView({ behavior });
  }, []);

  const toggleFilter = useCallback((key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const filteredMessages = useMemo(() => messages.filter(entry => {
    if (entry.role === 'user') return true;
    if (entry.contentType === 'thinking' && !filters.thinking) return false;
    if (entry.contentType === 'tool_use' && !filters.tool_use) return false;
    if (entry.contentType === 'tool_result' && !filters.tool_result) return false;
    return true;
  }), [messages, filters]);

  const rowVirtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT_PX,
    overscan: VIRTUAL_OVERSCAN_ROWS,
    initialRect: {
      width: 0,
      height: DEFAULT_VIEWPORT_HEIGHT_PX,
    },
    getItemKey: (index) => messageKey(filteredMessages[index], index),
    measureElement: (element) => {
      const bubble = element.firstElementChild as HTMLElement | null;
      const measuredHeight = bubble?.getBoundingClientRect().height ?? element.getBoundingClientRect().height;
      return measuredHeight > 0
        ? measuredHeight + VIRTUAL_ROW_GAP_PX
        : ESTIMATED_MESSAGE_HEIGHT_PX;
    },
  });

  // Auto-scroll when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (userScrolledRef.current) return;

    const animationFrame = window.requestAnimationFrame(() => {
      scrollToBottom(messages.length > 0 ? 'smooth' : 'auto');
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [messages, scrollToBottom]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#555] text-sm">
        <div className="animate-pulse">Loading transcript…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[#ff3366] text-sm">
        ⚠ {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#1a1a2e] bg-[#0a0a0f] shrink-0">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">Filter:</span>
        {(['thinking', 'tool_use', 'tool_result'] as const).map(key => (
          <button
            key={key}
            onClick={() => toggleFilter(key)}
            aria-pressed={filters[key]}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              filters[key]
                ? 'border-[#00e5ff]/40 text-[#00e5ff] bg-[#00e5ff]/10'
                : 'border-[#1a1a2e] text-[#555] hover:text-[#888]'
            }`}
          >
            {key === 'tool_use' ? 'Tools' : key === 'tool_result' ? 'Results' : key}
          </button>
        ))}
        <span className="text-[10px] text-[#444] ml-auto">
          {filteredMessages.length} / {messages.length}
        </span>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
        data-testid="transcript-scroll-container"
      >
        {filteredMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#555] text-sm">
            No messages yet
          </div>
        )}
        {filteredMessages.length > 0 && (
          <div
            className="relative w-full"
            data-testid="transcript-virtualizer"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredMessages[virtualRow.index];

              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <MessageBubble entry={entry} />
                </div>
              );
            })}
            <div
              ref={bottomRef}
              aria-hidden="true"
              className="absolute left-0 top-0 h-px w-px"
              style={{ transform: `translateY(${rowVirtualizer.getTotalSize()}px)` }}
            />
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-4 right-4 bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#00e5ff] rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-[#1a1a2e] transition-colors z-10"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
