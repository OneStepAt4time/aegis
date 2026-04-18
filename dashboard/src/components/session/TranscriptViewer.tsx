import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ParsedEntry } from '../../types';
import { getSessionTranscript, subscribeSSE } from '../../api/client';
import { useStore } from '../../store/useStore';
import { MessageBubble } from './MessageBubble';
import { SessionSSEEventDataSchema } from '../../api/schemas';

const MAX_SESSION_MESSAGES = 1000;

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

  // Fetch initial messages via API client
  useEffect(() => {
    let cancelled = false;

    getSessionTranscript(sessionId, MAX_SESSION_MESSAGES)
      .then(data => {
        if (!cancelled) {
          const msgs = (data.messages ?? []).map(({ _cursor_id: _cursorId, ...entry }) => entry);
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
        const result = SessionSSEEventDataSchema.safeParse(JSON.parse(e.data as string));
        if (!result.success) {
          console.warn('SSE event failed validation', result.error.message);
          return;
        }
        const parsed = result.data;
        // Issue #261: Only process message events; skip status, heartbeat,
        // approval, stall, dead, ended, hook, and subagent events.
        if (parsed.event !== 'message') return;
        const data = parsed.data as unknown as ParsedEntry;
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

  const filteredMessages = useMemo(() => messages.filter(entry => {
    if (entry.role === 'user') return true;
    if (entry.contentType === 'thinking' && !filters.thinking) return false;
    if (entry.contentType === 'tool_use' && !filters.tool_use) return false;
    if (entry.contentType === 'tool_result' && !filters.tool_result) return false;
    return true;
  }), [messages, filters]);

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

  // Auto-scroll when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledRef.current && filteredMessages.length > 0) {
      virtualizer.scrollToIndex(filteredMessages.length - 1, { align: 'end' });
    }
  }, [filteredMessages.length, virtualizer]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#555] text-sm">
        <div className="animate-pulse">Loading transcript…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-error)] text-sm">
        ⚠ {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--color-void-lighter)] bg-[var(--color-void)] shrink-0">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">Filter:</span>
        {(['thinking', 'tool_use', 'tool_result'] as const).map(key => (
          <button
            key={key}
            onClick={() => toggleFilter(key)}
            aria-pressed={filters[key]}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              filters[key]
                ? 'border-[var(--color-accent)]/40 text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-void-lighter)] text-[#555] hover:text-[#888]'
            }`}
          >
            {key === 'tool_use' ? 'Tools' : key === 'tool_result' ? 'Results' : key}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[#444]">
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
                <MessageBubble entry={filteredMessages[virtualItem.index]} />
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
