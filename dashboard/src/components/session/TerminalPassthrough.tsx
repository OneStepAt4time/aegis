import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { ResilientWebSocket } from '../../api/resilient-websocket';
import { useStore } from '../../store/useStore';
import type { AppState } from '../../store/useStore';
import { getSessionMessages, subscribeSSE } from '../../api/client';
import type { ParsedEntry, WsInboundMessage, UIState } from '../../types';

interface TerminalPassthroughProps {
  sessionId: string;
  status: UIState;
}

interface FilterState {
  thinking: boolean;
  tool_use: boolean;
  tool_result: boolean;
}

const MAX_SESSION_MESSAGES = 1000;

/** Composite dedup key for messages (fixes #512) */
function dedupKey(m: ParsedEntry): string {
  return `${m.timestamp ?? ''}:${m.role}:${m.contentType}:${m.text.length}:${m.text.slice(0, 80)}`;
}

/** Format a transcript entry as readable text for xterm output */
function formatTranscriptEntry(entry: ParsedEntry): string {
  const role = entry.role === 'assistant' ? 'Agent' : entry.role === 'user' ? 'You' : entry.role;
  const contentTypeLabel = entry.contentType === 'tool_use' ? '[Tool]' : entry.contentType === 'tool_result' ? '[Result]' : entry.contentType === 'thinking' ? '[Thinking]' : '';
  
  const header = contentTypeLabel ? `${role} ${contentTypeLabel}` : role;
  const headerLine = `\u001b[36m${header}\u001b[0m:`;
  const textLine = entry.text.split('\n')[0].slice(0, 200) + (entry.text.length > 200 ? '…' : '');
  
  return `${headerLine} ${textLine}`;
}

export function TerminalPassthrough({ sessionId, status }: TerminalPassthroughProps) {
  const token = useStore((s: AppState) => s.token);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<ResilientWebSocket | null>(null);
  const statusRef = useRef<UIState>(status);
  const prevPaneContentRef = useRef<string>('');

  // Message state
  const [messages, setMessages] = useState<ParsedEntry[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    thinking: false,
    tool_use: true,
    tool_result: true,
  });
  const seenKeys = useRef<Set<string>>(new Set());
  const filteredMessagesRef = useRef<ParsedEntry[]>([]);

  // Connection state
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep status ref in sync
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Apply filters
  const filteredMessages = useMemo(() => messages.filter(entry => {
    if (entry.role === 'user') return true;
    if (entry.contentType === 'thinking' && !filters.thinking) return false;
    if (entry.contentType === 'tool_use' && !filters.tool_use) return false;
    if (entry.contentType === 'tool_result' && !filters.tool_result) return false;
    return true;
  }), [messages, filters]);

  // Keep filteredMessages ref in sync
  useEffect(() => {
    filteredMessagesRef.current = filteredMessages;
  }, [filteredMessages]);

  // Fetch initial transcript messages
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
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  // Subscribe to SSE for real-time message updates
  useEffect(() => {
    const unsubscribe = subscribeSSE(sessionId, (e) => {
      try {
        const raw = JSON.parse(e.data as string);
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
            for (let i = 0; i < evictedCount; i++) {
              seenKeys.current.delete(dedupKey(next[i]));
            }
            return capped;
          }
          return next;
        });
      } catch {
        // Ignore malformed events
      }
    }, token);

    return () => unsubscribe();
  }, [sessionId, token]);

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      theme: {
        background: '#000000',
        foreground: '#00ff88',
        cursor: '#00ff88',
        cursorAccent: '#000000',
        selectionBackground: '#00e5ff40',
      },
      convertEol: true,
      scrollback: 2000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const { cols, rows } = term;
      wsRef.current?.send({ type: 'resize', cols, rows });
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Render filtered transcript + terminal content when filters or messages change
  useEffect(() => {
    const term = xtermRef.current;
    if (!term || loadingMessages) return;

    // Clear and re-render the unified view
    term.reset();
    
    // Write transcript section header
    if (filteredMessages.length > 0) {
      term.writeln('\u001b[33m╔═══════════════════════════════════════════════════════════╗\u001b[0m');
      term.writeln('\u001b[33m║                       SESSION TRANSCRIPT                      ║\u001b[0m');
      term.writeln('\u001b[33m╚═══════════════════════════════════════════════════════════╝\u001b[0m');
      term.writeln('');

      // Write filtered messages
      for (const entry of filteredMessages) {
        term.writeln(formatTranscriptEntry(entry));
      }

      term.writeln('');
      term.writeln('\u001b[33m╔═══════════════════════════════════════════════════════════╗\u001b[0m');
      term.writeln('\u001b[33m║                      LIVE TERMINAL OUTPUT                    ║\u001b[0m');
      term.writeln('\u001b[33m╚═══════════════════════════════════════════════════════════╝\u001b[0m');
      term.writeln('');
    }

    // Write the current pane content
    const paneContent = prevPaneContentRef.current;
    if (paneContent) {
      term.write(paneContent);
    }

    // Auto-scroll to bottom
    fitAddonRef.current?.fit();
  }, [filteredMessages, loadingMessages]);

  // WebSocket connection for live pane content
  useEffect(() => {
    const getWsUrl = (): string => {
      const base = window.location.origin;
      const path = `/v1/sessions/${encodeURIComponent(sessionId)}/terminal`;
      const wsBase = base.replace(/^http/, 'ws');
      return `${wsBase}${path}`;
    };

    const url = getWsUrl();
    const ws = new ResilientWebSocket(url, {
      onMessage: (data: unknown) => {
        const msg = data as WsInboundMessage;
        const term = xtermRef.current;
        if (!term) return;

        switch (msg.type) {
          case 'pane': {
            // Write delta pane content to xterm
            const prev = prevPaneContentRef.current;
            const next = msg.content;
            if (prev && next.startsWith(prev)) {
              term.write(next.slice(prev.length));
            } else {
              // Content diverged — need to re-render everything
              // Save current pane content and re-render the full view
              prevPaneContentRef.current = next;
              // Trigger re-render with current filter state
              const term = xtermRef.current;
              if (term) {
                term.reset();

                // Re-write transcript section
                if (filteredMessagesRef.current.length > 0) {
                  term.writeln('\u001b[33m╔═══════════════════════════════════════════════════════════╗\u001b[0m');
                  term.writeln('\u001b[33m║                       SESSION TRANSCRIPT                      ║\u001b[0m');
                  term.writeln('\u001b[33m╚═══════════════════════════════════════════════════════════╝\u001b[0m');
                  term.writeln('');

                  for (const entry of filteredMessagesRef.current) {
                    term.writeln(formatTranscriptEntry(entry));
                  }

                  term.writeln('');
                  term.writeln('\u001b[33m╔═══════════════════════════════════════════════════════════╗\u001b[0m');
                  term.writeln('\u001b[33m║                      LIVE TERMINAL OUTPUT                    ║\u001b[0m');
                  term.writeln('\u001b[33m╚═══════════════════════════════════════════════════════════╝\u001b[0m');
                  term.writeln('');
                }

                term.write(next);
              }
            }
            prevPaneContentRef.current = next;
            setErrorMsg(null);
            break;
          }

          case 'status':
            // Auth handshake
            break;

          case 'error':
            setErrorMsg(msg.message);
            break;
        }
      },
      onOpen: () => {
        setConnectionState('connected');
        setErrorMsg(null);
        const term = xtermRef.current;
        if (fitAddonRef.current && term) {
          wsRef.current?.send({ type: 'resize', cols: term.cols, rows: term.rows });
        }
      },
      onReconnecting: () => {
        setConnectionState('reconnecting');
      },
      onGiveUp: () => {
        setConnectionState('disconnected');
      },
      onClose: () => {
        setConnectionState('disconnected');
      },
    }, token ?? undefined);

    wsRef.current = ws;

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [sessionId, token]);

  // Forward user input to WebSocket
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    const disposable = term.onData((data: string) => {
      wsRef.current?.send({ type: 'input', text: data });
    });

    return () => {
      disposable.dispose();
    };
  }, []);

  const toggleFilter = useCallback((key: keyof FilterState) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const isLive = status === 'working';
  const isConnected = connectionState === 'connected';

  return (
    <div className="flex flex-col h-full bg-[#111118] border border-[#1a1a2e] rounded-lg overflow-hidden">
      {/* Header with filters and connection status */}
      <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-[#1a1a2e] bg-[#0a0a0f] shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3">
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
          <span className="text-[10px] text-[#444]">
            {filteredMessages.length} / {messages.length} messages
          </span>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {/* Connection indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isConnected ? '#00e5ff' : connectionState === 'reconnecting' ? '#ffaa00' : '#666',
                boxShadow: isConnected ? '0 0 4px #00e5ff40' : 'none',
                animation: connectionState === 'reconnecting' ? 'pulse 1s ease-in-out infinite' : 'none',
              }}
            />
            <span className="text-[10px] text-[#555] uppercase">
              {connectionState === 'connecting' ? 'connecting…'
                : connectionState === 'reconnecting' ? 'reconnecting…'
                : connectionState === 'connected' ? 'ws live'
                : 'disconnected'}
            </span>
          </div>

          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isLive ? '#00ff88' : '#888',
                boxShadow: isLive ? '0 0 4px #00ff88' : 'none',
              }}
            />
            <span className="text-[10px] text-[#555] uppercase">
              {isLive ? 'active' : 'idle'}
            </span>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="px-4 py-2 text-xs text-[#ff3366] bg-[#ff336610] border-b border-[#ff336620]">
          {errorMsg}
        </div>
      )}

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
      />
    </div>
  );
}
