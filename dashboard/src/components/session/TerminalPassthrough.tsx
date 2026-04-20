import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { ResilientWebSocket } from '../../api/resilient-websocket';
import { useStore } from '../../store/useStore';
import type { AppState } from '../../store/useStore';
import { useToastStore } from '../../store/useToastStore';
import { getSessionMessages, subscribeSSE } from '../../api/client';
import type { ParsedEntry, UIState } from '../../types';
import { SessionSSEEventDataSchema, WsInboundMessageSchema } from '../../api/schemas';
import { sanitizeTerminalStream } from '../../utils/sanitizeStream';
import { ClaudeStatusStrip, parseStatusFooter, type ClaudeStatusStripProps } from './ClaudeStatusStrip';

/** Heuristic browser-side platform hint for the sanitizer. The server's OS
 * is not reliably known to the client — bootstraps are echoed by tmux the
 * same way regardless — so we only distinguish Windows from Unix here and
 * let the sanitizer fall back across both pattern families (see
 * `utils/sanitizeStream.ts`). */
function detectClientPlatform(): 'win32' | 'darwin' | 'linux' {
  if (typeof navigator === 'undefined') return 'linux';
  if (/Windows/i.test(navigator.userAgent)) return 'win32';
  if (/Mac OS X|Macintosh/i.test(navigator.userAgent)) return 'darwin';
  return 'linux';
}

/** Opt-out for debugging: `?raw=1` on the page URL disables sanitation. */
function isRawStreamOptOut(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.search.includes('raw=1');
}

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
  const addToast = useToastStore((s) => s.addToast);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<ResilientWebSocket | null>(null);
  const statusRef = useRef<UIState>(status);
  const prevPaneContentRef = useRef<string>('');

  // Message state
  const [messages, setMessages] = useState<ParsedEntry[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    thinking: false,
    tool_use: true,
    tool_result: true,
  });
  const seenKeys = useRef<Set<string>>(new Set());
  const filteredMessagesRef = useRef<ParsedEntry[]>([]);
  const prevRenderedCountRef = useRef<number>(0);

  // Connection state
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Claude CLI status strip state (Issue 003b)
  const [statusStripData, setStatusStripData] = useState<Partial<Omit<ClaudeStatusStripProps, 'className'>>>({ thinking: false });

  // Stream sanitation (issue 003a). Memoised per-mount so the info log fires
  // at most once and the platform hint is stable for the whole session.
  const sanitationCtx = useMemo(() => {
    const preserveRaw = isRawStreamOptOut();
    if (preserveRaw) {
      // eslint-disable-next-line no-console
      console.info('[aegis] terminal stream sanitation disabled via ?raw=1');
    }
    return { platform: detectClientPlatform(), preserveRaw };
  }, []);

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
          setFetchError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setFetchError(message);
          addToast('error', 'Failed to load session messages', message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => { cancelled = true; };
  }, [sessionId, addToast]);

  // Subscribe to SSE for real-time message updates
  useEffect(() => {
    const unsubscribe = subscribeSSE(sessionId, (e) => {
      try {
        const result = SessionSSEEventDataSchema.safeParse(JSON.parse(e.data as string));
        if (!result.success) {
          console.warn('SSE event failed validation', result.error.message);
          return;
        }
        const parsed = result.data;
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
        background: 'transparent',
        foreground: 'var(--color-text-primary)',
        cursor: 'var(--color-cyan-bright)',
        cursorAccent: 'var(--color-void-deep)',
        selectionBackground: 'rgba(0, 229, 255, 0.25)',
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

    const prevCount = prevRenderedCountRef.current;
    const newCount = filteredMessages.length;

    // Full reset needed if: first render, filter change (count decreased), or no messages
    if (prevCount === 0 || newCount < prevCount) {
      term.reset();

      // Issue 01.1: no ASCII box banners. The filter chip bar + status strip
      // already label what's on screen; drawing "╔══SESSION TRANSCRIPT══╗"
      // inside the terminal added 4 lines of chrome and leaked from captures.
      if (newCount > 0) {
        for (const entry of filteredMessages) {
          term.writeln(formatTranscriptEntry(entry));
        }
        term.writeln('');
      }

      // Write the current pane content
      const paneContent = prevPaneContentRef.current;
      if (paneContent) {
        term.write(paneContent);
      }
    } else if (newCount > prevCount) {
      // Incremental: only append new messages
      const newMessages = filteredMessages.slice(prevCount);
      for (const entry of newMessages) {
        term.writeln(formatTranscriptEntry(entry));
      }
    }
    // If newCount === prevCount, nothing to do (no new messages)

    prevRenderedCountRef.current = newCount;
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
        const result = WsInboundMessageSchema.safeParse(data);
        if (!result.success) {
          console.warn('WebSocket message failed validation', result.error.message);
          return;
        }
        const msg = result.data;
        const term = xtermRef.current;
        if (!term) return;

        switch (msg.type) {
          case 'pane': {
            // Issue 003a: strip shell bootstrap, hook-settings paths, the
            // Claude CLI ASCII logo and raw status-footer lines BEFORE the
            // diff against prevPaneContentRef. Sanitation is deterministic
            // and idempotent, so applying it once to each snapshot keeps
            // the delta-write optimisation valid. Opt-out via `?raw=1`.
            const sanitized = sanitizeTerminalStream(msg.content, sanitationCtx.platform, {
              preserveRaw: sanitationCtx.preserveRaw,
            });
            
            // Issue 003b: Parse status footer from raw pane content (before sanitation strips it)
            // Look for status lines near the bottom of the pane capture
            const rawLines = msg.content.split('\n');
            const bottomLines = rawLines.slice(-10); // check last 10 lines
            for (const line of bottomLines) {
              // Match Claude CLI status footer patterns
              if (/[·•]\s*[A-Z][a-zA-Z]+ing/i.test(line) || /esc\s+to\s+interrupt/i.test(line) || /\bv?\d+\.\d+\.\d+\b/.test(line)) {
                const parsed = parseStatusFooter(line);
                if (parsed && Object.keys(parsed).length > 0) {
                  setStatusStripData(prev => ({ ...prev, ...parsed }));
                  break;
                }
              }
            }
            
            // Write delta pane content to xterm
            const prev = prevPaneContentRef.current;
            const next = sanitized;
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

                // Issue 01.1: see same comment above — no ASCII box banners.
                if (filteredMessagesRef.current.length > 0) {
                  for (const entry of filteredMessagesRef.current) {
                    term.writeln(formatTranscriptEntry(entry));
                  }
                  term.writeln('');
                }

                term.write(next);
                // Update rendered count after full re-render
                prevRenderedCountRef.current = filteredMessagesRef.current.length;
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
  }, [sessionId, token, sanitationCtx]);

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
    <div className="flex flex-col h-full bg-transparent rounded-lg overflow-hidden">
      {/* Header with filters, status strip, and connection status */}
      <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-white/5 bg-white/5 backdrop-blur-md shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[#555] uppercase tracking-wider">Filter:</span>
          {(['thinking', 'tool_use', 'tool_result'] as const).map(key => (
            <button
              key={key}
              onClick={() => toggleFilter(key)}
              aria-pressed={filters[key]}
              className={`relative inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filters[key]
                  ? 'border-[var(--color-accent-cyan)]/40 text-[var(--color-accent-cyan)] bg-[var(--color-accent-cyan)]/10 font-medium'
                  : 'border-[var(--color-void-lighter)] text-[#555] hover:text-[#888] bg-transparent'
              }`}
            >
              <span>{key === 'tool_use' ? 'Tools' : key === 'tool_result' ? 'Results' : key}</span>
              <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-semibold rounded ${
                filters[key] 
                  ? 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]'
                  : 'bg-[var(--color-void-lighter)] text-[#555]'
              }`}>
                {messages.filter(m => 
                  key === 'thinking' ? m.contentType === 'thinking' :
                  key === 'tool_use' ? m.contentType === 'tool_use' :
                  key === 'tool_result' ? m.contentType === 'tool_result' : false
                ).length}
              </span>
            </button>
          ))}
          <span className="text-[10px] text-[#444]">
            {filteredMessages.length} / {messages.length} messages
          </span>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {/* Claude CLI Status Strip (Issue 003b) */}
          {(statusStripData.version || statusStripData.model || statusStripData.effort || statusStripData.thinking) && (
            <ClaudeStatusStrip 
              version={statusStripData.version}
              model={statusStripData.model}
              effort={statusStripData.effort}
              thinking={statusStripData.thinking ?? false}
            />
          )}
          
          {/* Connection indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isConnected ? 'var(--color-accent-cyan)' : connectionState === 'reconnecting' ? 'var(--color-warning-amber)' : '#666',
                boxShadow: isConnected ? '0 0 4px rgba(0, 229, 255, 0.25)' : 'none',
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
                backgroundColor: isLive ? 'var(--color-cyan-bright)' : '#888',
                boxShadow: isLive ? '0 0 4px var(--color-cyan-bright)' : 'none',
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
        <div className="px-4 py-2 text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20">
          {errorMsg}
        </div>
      )}

      {/* Message fetch error banner */}
      {fetchError && (
        <div className="px-4 py-2 text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20">
          Failed to load session messages: {fetchError}
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
