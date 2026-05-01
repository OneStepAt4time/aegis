import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { ResilientWebSocket } from '../../api/resilient-websocket';
import { useStore } from '../../store/useStore';
import type { WsInboundMessage, WsOutboundMessage, UIState } from '../../types';

interface LiveTerminalProps {
  sessionId: string;
  status: UIState;
}

export function LiveTerminal({ sessionId, status }: LiveTerminalProps) {
  const token = useStore((s) => s.token);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<ResilientWebSocket | null>(null);
  const statusRef = useRef<UIState>(status);
  const prevContentRef = useRef<string>('');

  // Keep status ref in sync for the WS message handler
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failureDetail, setFailureDetail] = useState<string | null>(null);

  // Retry counter to force WebSocket reconnection
  const [retryKey, setRetryKey] = useState(0);
  const wsUrlRef = useRef<string>('');

  // Build WebSocket URL — same relative pattern as SSE (works through Vite proxy)
  // Issue #503: Token is NO LONGER passed in the URL — it's sent as the first
  // WebSocket message via the handshake auth protocol.
  const getWsUrl = useCallback((): string => {
    const base = window.location.origin;
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/terminal`;
    const wsBase = base.replace(/^http/, 'ws');
    return `${wsBase}${path}`;
  }, [sessionId]);

  // Initialize xterm.js
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      theme: {
        background: 'var(--color-void-deep)',
        foreground: 'var(--color-success)',
        cursor: 'var(--color-success)',
        cursorAccent: 'var(--color-void-deep)',
        selectionBackground: 'rgba(59, 130, 246, 0.25)',
      },
      convertEol: true,
      scrollback: 1000,
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
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // WebSocket connection
  useEffect(() => {
    const url = getWsUrl();
    wsUrlRef.current = url;
    setConnectionState('connecting');
    setFailureDetail(null);

    const ws = new ResilientWebSocket(url, {
      onMessage: (data: unknown) => {
        const msg = data as WsInboundMessage;
        const term = xtermRef.current;
        if (!term) return;

        switch (msg.type) {
          case 'pane': {
            // One-shot catchup on connect - full replace, no diffing.
            term.reset();
            term.write(msg.content);
            prevContentRef.current = msg.content;
            setErrorMsg(null);
            break;
          }

          case 'stream': {
            // Incremental PTY output - write directly, always a delta.
            term.write(msg.data);
            setErrorMsg(null);
            break;
          }

          case 'status':
            // Auth handshake returns { type: "status", status: "authenticated" }
            // Status is already tracked by useSessionPolling via SSE
            break;

          case 'error':
            setErrorMsg(msg.message);
            break;
        }
      },
      onOpen: () => {
        setConnectionState('connected');
        setErrorMsg(null);
        setFailureDetail(null);
        // Send initial resize after connecting
        // Issue #641: Guard xtermRef.current — terminal may be disposed
        // during reconnection (e.g. rapid tab switching)
        const term = xtermRef.current;
        if (fitAddonRef.current && term) {
          wsRef.current?.send({ type: 'resize', cols: term.cols, rows: term.rows });
        }
      },
      onReconnecting: () => {
        setConnectionState('reconnecting');
        setFailureDetail(null);
      },
      onGiveUp: () => {
        setConnectionState('disconnected');
        setFailureDetail(
          `WebSocket to ${url} failed after multiple retries. ` +
          `The terminal backend may not be available for this session type.`
        );
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
  }, [getWsUrl, token, retryKey]);

  // Forward user input to WebSocket
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    const disposable = term.onData((data: string) => {
      wsRef.current?.send({ type: 'input', text: data } satisfies WsOutboundMessage);
    });

    return () => {
      disposable.dispose();
    };
  }, []);

  const isLive = status === 'working';
  const isConnected = connectionState === 'connected';

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-[var(--color-void-lighter)]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[#888]">Terminal</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isConnected ? 'var(--color-accent)' : connectionState === 'reconnecting' ? 'var(--color-warning)' : '#666',
                boxShadow: isConnected ? '0 0 4px rgba(59, 130, 246, 0.25)' : 'none',
                animation: connectionState === 'reconnecting' ? 'pulse 1s ease-in-out infinite' : 'none',
              }}
            />
            <span className="text-[10px] text-[#555] uppercase">
              {connectionState === 'connecting' ? 'connecting...'
                : connectionState === 'reconnecting' ? 'RECONNECTING...'
                : connectionState === 'connected' ? 'ws live'
                : 'disconnected'}
            </span>
          </div>
          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: isLive ? 'var(--color-success)' : '#888',
                boxShadow: isLive ? '0 0 4px var(--color-success)' : 'none',
              }}
            />
            <span className="text-[10px] text-[#555] uppercase">
              {isLive ? 'active' : 'idle'}
            </span>
          </div>
        </div>
      </div>

      {/* Error banner (server-sent error messages) */}
      {errorMsg && (
        <div className="px-4 py-2 text-xs text-[var(--color-error)] bg-[var(--color-error)]/10 border-b border-[var(--color-error)]/20">
          {errorMsg}
        </div>
      )}

      {/* Failure detail banner — shows actionable info when streaming fails (issue #2347) */}
      {failureDetail && connectionState === 'disconnected' && (
        <div className="px-4 py-3 text-xs border-b border-[var(--color-warning)]/20 bg-[var(--color-warning)]/5">
          <div className="flex items-start gap-2">
            <span className="text-[var(--color-warning)] shrink-0 mt-0.5" aria-hidden="true">⚠</span>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--color-text-muted)]">{failureDetail}</p>
              <p className="mt-1 text-[var(--color-text-muted)] opacity-70">
                The transcript and metrics tabs remain available as fallback.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setFailureDetail(null);
                setRetryKey((k) => k + 1);
              }}
              className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-warning)]/30 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10 transition-colors"
              aria-label="Retry terminal connection"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Terminal */}
      <div
        ref={terminalRef}
        className="h-[calc(100vh-420px)] sm:h-[calc(100vh-460px)] min-h-[250px] sm:min-h-[300px]"
      />
    </div>
  );
}
