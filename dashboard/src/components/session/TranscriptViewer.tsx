import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ParsedEntry } from '../../types';
import { getSessionMessages, subscribeSSE } from '../../api/client';
import { useStore } from '../../store/useStore';
import { MessageBubble } from './MessageBubble';

const MAX_SESSION_MESSAGES = 1000;
const VIRTUAL_ROW_ESTIMATE_PX = 96;
const VIRTUAL_OVERSCAN_ROWS = 10;

/** Composite dedup key: timestamp + content fingerprint (fixes #512) */
function dedupKey(m: ParsedEntry): string {
  return `${m.timestamp ?? ''}:${m.role}:${m.contentType}:${m.text.length}:${m.text.slice(0, 80)}`;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const seenKeys = useRef<Set<string>>(new Set());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

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

  // #124: SSE for real-time messages â€” uses client subscribeSSE which handles auth
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

  // Auto-scroll when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledRef.current) {
      const el = containerRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledRef.current = !atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateViewport = () => setViewportHeight(el.clientHeight);
    updateViewport();

    const observer = new ResizeObserver(updateViewport);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const virtualWindow = useMemo(() => {
    const total = filteredMessages.length;
    if (total === 0) {
      return {
        startIndex: 0,
        endIndex: 0,
        visible: [] as ParsedEntry[],
        topSpacerPx: 0,
        bottomSpacerPx: 0,
      };
    }

    const visibleRows = Math.max(1, Math.ceil((viewportHeight || 1) / VIRTUAL_ROW_ESTIMATE_PX));
    const rawStart = Math.floor(scrollTop / VIRTUAL_ROW_ESTIMATE_PX) - VIRTUAL_OVERSCAN_ROWS;
    const startIndex = Math.max(0, rawStart);
    const endIndex = Math.min(total, startIndex + visibleRows + VIRTUAL_OVERSCAN_ROWS * 2);

    return {
      startIndex,
      endIndex,
      visible: filteredMessages.slice(startIndex, endIndex),
      topSpacerPx: startIndex * VIRTUAL_ROW_ESTIMATE_PX,
      bottomSpacerPx: Math.max(0, (total - endIndex) * VIRTUAL_ROW_ESTIMATE_PX),
    };
  }, [filteredMessages, scrollTop, viewportHeight]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#555] text-sm">
        <div className="animate-pulse">Loading transcriptâ€¦</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[#ef4444] text-sm">
        âš  {error}
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
                ? 'border-[#3b82f6]/40 text-[#3b82f6] bg-[#3b82f6]/10'
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
      >
        {filteredMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#555] text-sm">
            No messages yet
          </div>
        )}
        {filteredMessages.length > 0 && (
          <>
            {virtualWindow.topSpacerPx > 0 && <div style={{ height: virtualWindow.topSpacerPx }} />}
            {virtualWindow.visible.map((entry, i) => (
              <MessageBubble
                key={entry.toolUseId ?? `${entry.role}-${entry.timestamp ?? `${virtualWindow.startIndex + i}`}`}
                entry={entry}
              />
            ))}
            {virtualWindow.bottomSpacerPx > 0 && <div style={{ height: virtualWindow.bottomSpacerPx }} />}
          </>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#3b82f6] rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-[#1a1a2e] transition-colors z-10"
          title="Scroll to bottom"
        >
          â†“
        </button>
      )}
    </div>
  );
}

