import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { ResilientWebSocket } from '../../api/resilient-websocket';
import { useStore } from '../../store/useStore';
import type { AppState } from '../../store/useStore';
import type { UIState } from '../../types';
import { WsInboundMessageSchema } from '../../api/schemas';

interface TerminalPassthroughProps {
  sessionId: string;
  status: UIState;
}

export function TerminalPassthrough({ sessionId, status }: TerminalPassthroughProps) {
  const token = useStore((s: AppState) => s.token);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<ResilientWebSocket | null>(null);
  const prevPaneContentRef = useRef<string>('');

  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'reconnecting' | 'disconnected'>('connecting');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      lineHeight: 1.28,
      letterSpacing: 0.15,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      theme: {
        background: 'var(--color-void-deep)',
        foreground: 'var(--color-cyan-bright)',
        cursor: 'var(--color-cyan-bright)',
        cursorAccent: 'var(--color-void-deep)',
        selectionBackground: 'rgba(0, 229, 255, 0.22)',
      },
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

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

  useEffect(() => {
    const wsBase = window.location.origin.replace(/^http/, 'ws');
    const path = `/v1/sessions/${encodeURIComponent(sessionId)}/terminal`;
    const ws = new ResilientWebSocket(`${wsBase}${path}`, {
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
            const prev = prevPaneContentRef.current;
            const next = msg.content;
            if (prev && next.startsWith(prev)) {
              term.write(next.slice(prev.length));
            } else {
              term.reset();
              term.write(next);
            }
            prevPaneContentRef.current = next;
            setErrorMsg(null);
            break;
          }
          case 'status':
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
      onReconnecting: () => setConnectionState('reconnecting'),
      onGiveUp: () => setConnectionState('disconnected'),
      onClose: () => setConnectionState('disconnected'),
    }, token ?? undefined);

    wsRef.current = ws;

    return () => {
      wsRef.current = null;
      ws.close();
    };
  }, [sessionId, token]);

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

  const isLive = status === 'working';
  const isConnected = connectionState === 'connected';

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)] border border-[var(--color-void-lighter)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 text-xs border-b border-[var(--color-void-lighter)] bg-[var(--color-void)] shrink-0 flex-wrap gap-2">
        <span className="font-mono uppercase tracking-wider text-[10px] text-[#888]">Claude Session TTY</span>

        <div className="flex items-center gap-3 ml-auto">
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
              {connectionState === 'connecting' ? 'connecting...'
                : connectionState === 'reconnecting' ? 'reconnecting...'
                : connectionState === 'connected' ? 'ws live'
                : 'disconnected'}
            </span>
          </div>

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

      {errorMsg && (
        <div className="px-4 py-2 text-xs text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20">
          {errorMsg}
        </div>
      )}

      <div ref={terminalRef} className="session-terminal flex-1 min-h-0" />
    </div>
  );
}
