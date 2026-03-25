import { useState, useEffect, useRef, useCallback } from 'react';
import type { ParsedEntry } from '../../types';
import { getSessionMessages, subscribeSSE } from '../../api/client';
import { MessageBubble } from './MessageBubble';

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
  const [filters, setFilters] = useState<FilterState>({
    thinking: false,
    tool_use: true,
    tool_result: true,
  });
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Fetch initial messages via API client
  useEffect(() => {
    let cancelled = false;

    getSessionMessages(sessionId)
      .then(data => {
        if (!cancelled) {
          setMessages(data.messages ?? []);
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
        const data: ParsedEntry = JSON.parse(e.data as string);
        setMessages(prev => [...prev, data]);
      } catch {
        // ignore malformed events
      }
    });

    return () => unsubscribe();
  }, [sessionId]);

  // Auto-scroll when new messages arrive (unless user scrolled up)
  useEffect(() => {
    if (!userScrolledRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    userScrolledRef.current = !atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const toggleFilter = useCallback((key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const filteredMessages = messages.filter(entry => {
    if (entry.role === 'user') return true;
    if (entry.contentType === 'thinking' && !filters.thinking) return false;
    if (entry.contentType === 'tool_use' && !filters.tool_use) return false;
    if (entry.contentType === 'tool_result' && !filters.tool_result) return false;
    return true;
  });

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
      >
        {filteredMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-[#555] text-sm">
            No messages yet
          </div>
        )}
        {filteredMessages.map((entry, i) => (
          <MessageBubble key={i} entry={entry} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 right-4 bg-[#1a1a2e] hover:bg-[#2a2a3e] text-[#00e5ff] rounded-full w-10 h-10 flex items-center justify-center shadow-lg border border-[#1a1a2e] transition-colors z-10"
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
