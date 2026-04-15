import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ParsedEntry } from '../../types';
import { getSessionMessages, subscribeSSE } from '../../api/client';
import { useStore } from '../../store/useStore';
import { MessageBubble } from './MessageBubble';
import { SessionSSEEventDataSchema } from '../../api/schemas';

const MAX_SESSION_MESSAGES = 1000;

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

  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const seenKeys = useRef<Set<string>>(new Set());
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getSessionMessages(sessionId)
      .then((data) => {
        if (cancelled) return;
        const msgs = data.messages ?? [];
        const capped = msgs.length > MAX_SESSION_MESSAGES
          ? msgs.slice(msgs.length - MAX_SESSION_MESSAGES)
          : msgs;
        setMessages(capped);
        seenKeys.current = new Set(capped.map(dedupKey));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const unsubscribe = subscribeSSE(sessionId, (e) => {
      try {
        const result = SessionSSEEventDataSchema.safeParse(JSON.parse(e.data as string));
        if (!result.success) return;

        const parsed = result.data;
        if (parsed.event !== 'message') return;

        const data = parsed.data as unknown as ParsedEntry;
        setMessages((prev) => {
          const key = dedupKey(data);
          if (seenKeys.current.has(key)) return prev;

          seenKeys.current.add(key);
          const next = [...prev, data];
          if (next.length > MAX_SESSION_MESSAGES) {
            const evictedCount = next.length - MAX_SESSION_MESSAGES;
            for (let i = 0; i < evictedCount; i++) {
              seenKeys.current.delete(dedupKey(next[i]));
            }
            return next.slice(evictedCount);
          }
          return next;
        });
      } catch {
        // Ignore malformed events
      }
    }, token);

    return () => unsubscribe();
  }, [sessionId, token]);

  const filteredMessages = useMemo(() => messages.filter((entry) => {
    if (entry.role === 'user') return true;
    if (entry.contentType === 'thinking' && !filters.thinking) return false;
    if (entry.contentType === 'tool_use' && !filters.tool_use) return false;
    if (entry.contentType === 'tool_result' && !filters.tool_result) return false;
    return true;
  }), [messages, filters]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledRef.current = !atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, []);

  useEffect(() => {
    if (!userScrolledRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [filteredMessages.length]);

  const toggleFilter = useCallback((key: keyof FilterState) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#555] text-sm">
        <div className="animate-pulse">Loading transcript...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-error)] text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg overflow-hidden">
      <div className="sticky top-0 z-10 flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b border-[var(--color-void-lighter)] bg-[var(--color-void)] shrink-0 flex-wrap">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">Filter</span>
        {(['thinking', 'tool_use', 'tool_result'] as const).map((key) => (
          <button
            key={key}
            onClick={() => toggleFilter(key)}
            aria-pressed={filters[key]}
            className={`text-xs px-2.5 py-1 rounded border transition-colors ${
              filters[key]
                ? 'border-[var(--color-accent-cyan)]/50 text-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/10'
                : 'border-[var(--color-void-lighter)] text-[#555] hover:text-[#888]'
            }`}
          >
            {key === 'tool_use' ? 'Tools' : key === 'tool_result' ? 'Results' : 'Thinking'}
          </button>
        ))}
        <span className="text-[11px] text-[#666] ml-auto font-mono">
          {filteredMessages.length} / {messages.length}
        </span>
      </div>

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 sm:py-4 bg-[var(--color-void)]/45">
        {filteredMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#555] text-sm">
            No transcript messages yet.
          </div>
        )}

        {filteredMessages.length > 0 && (
          <div className="max-w-4xl mx-auto space-y-2 sm:space-y-3">
            {filteredMessages.map((entry, index) => {
              const key = entry.toolUseId ?? `${entry.role}-${entry.timestamp ?? index}`;
              return <MessageBubble key={key} entry={entry} />;
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-[var(--color-void-lighter)] hover:bg-[var(--color-surface-hover)] text-[var(--color-accent-cyan)] rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-[var(--color-void-lighter)] transition-colors z-20"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
