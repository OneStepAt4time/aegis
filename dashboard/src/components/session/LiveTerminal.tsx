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

  // Keep status ref in sync for the WS message handler
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        background: '#000000',
        foreground: '#00ff88',
        cursor: '#00ff88',
        cursorAccent: '#000000',
        selectionBackground: '#00e5ff40',
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
    const ws = new ResilientWebSocket(url, {
      onMessage: (data: unknown) => {
        const msg = data as WsInboundMessage;
        const term = xtermRef.current;
        if (!term) return;

        switch (msg.type) {
          case 'pane':
            // Backend sends full pane snapshots — reset then write
            term.reset();
            term.write(msg.content);
            setErrorMsg(null);
            break;

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
        // Send initial resize after connecting
        if (fitAddonRef.current) {
          const { cols, rows } = xtermRef.current!;
          wsRef.current?.send({ type: 'resize', cols, rows });
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
  }, [getWsUrl]);

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
    <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-[#1a1a2e]">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[#888]">Terminal</span>
        </div>
        <div className="flex items-center gap-3">
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
        className="h-[calc(100vh-420px)] sm:h-[calc(100vh-460px)] min-h-[250px] sm:min-h-[300px]"
      />
    </div>
  );
}
