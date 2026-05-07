/**
 * hooks/useTerminalDebug.ts — React hook for ACP terminal debug tab.
 *
 * Manages terminal lifecycle (open/reconnect/close) and exposes
 * state to TerminalDebugTab.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { AcpTerminalState, AcpTerminalSize } from '../types/acp-terminal';
import {
  openTerminal,
  sendTerminalInput,
  resizeTerminal,
  reconnectTerminal,
  closeTerminal,
} from '../api/acp-terminal-client';

export interface UseTerminalDebugReturn {
  terminalState: AcpTerminalState;
  terminalId: string | null;
  error: string | null;
  output: string;
  open: () => Promise<void>;
  sendInput: (data: string) => Promise<void>;
  resize: (size: AcpTerminalSize) => Promise<void>;
  reconnect: () => Promise<void>;
  close: () => Promise<void>;
}

export function useTerminalDebug(sessionId: string | undefined): UseTerminalDebugReturn {
  const [terminalState, setTerminalState] = useState<AcpTerminalState>('disconnected');
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const reconnectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearInterval(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const open = useCallback(async () => {
    if (!sessionId) return;
    setTerminalState('connecting');
    setError(null);
    try {
      const result = await openTerminal(sessionId);
      setTerminalId(result.terminalId);
      setTerminalState('connected');
      // Start polling reconnect for snapshot updates
      clearTimer();
      reconnectTimerRef.current = setInterval(async () => {
        try {
          const snapshot = await reconnectTerminal(sessionId, result.terminalId);
          setOutput(snapshot.replayedOutput);
        } catch {
          // Ignore polling errors
        }
      }, 3000);
    } catch (e) {
      setTerminalState('error');
      setError(e instanceof Error ? e.message : 'Failed to open terminal');
    }
  }, [sessionId, clearTimer]);

  const sendInput = useCallback(async (data: string) => {
    if (!sessionId || !terminalId) return;
    try {
      await sendTerminalInput(sessionId, terminalId, data);
      setOutput((prev) => (prev ? `${prev}\n` : '') + `$ ${data}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send input');
    }
  }, [sessionId, terminalId]);

  const resize = useCallback(async (size: AcpTerminalSize) => {
    if (!sessionId || !terminalId) return;
    try {
      await resizeTerminal(sessionId, terminalId, size.cols, size.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resize terminal');
    }
  }, [sessionId, terminalId]);

  const reconnect = useCallback(async () => {
    if (!sessionId || !terminalId) return;
    setTerminalState('connecting');
    setError(null);
    try {
      const snapshot = await reconnectTerminal(sessionId, terminalId);
      setOutput(snapshot.replayedOutput);
      setTerminalState('connected');
    } catch (e) {
      setTerminalState('error');
      setError(e instanceof Error ? e.message : 'Failed to reconnect terminal');
    }
  }, [sessionId, terminalId]);

  const close = useCallback(async () => {
    if (!sessionId || !terminalId) return;
    clearTimer();
    try {
      await closeTerminal(sessionId, terminalId);
    } catch {
      // Ignore close errors
    }
    setTerminalId(null);
    setTerminalState('disconnected');
    setOutput('');
    setError(null);
  }, [sessionId, terminalId, clearTimer]);

  useEffect(() => {
    return () => {
      clearTimer();
      if (sessionId && terminalId) {
        void closeTerminal(sessionId, terminalId);
      }
    };
  }, [sessionId, terminalId, clearTimer]);

  // Auto-open terminal on first mount when sessionId is available
  const hasAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (sessionId && !hasAutoOpenedRef.current && terminalState === 'disconnected') {
      hasAutoOpenedRef.current = true;
      void open();
    }
  }, [sessionId, terminalState, open]);

  return { terminalState, terminalId, error, output, open, sendInput, resize, reconnect, close };
}
