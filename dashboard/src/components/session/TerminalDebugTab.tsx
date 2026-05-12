/**
 * components/session/TerminalDebugTab.tsx — ACP terminal debug tab.
 *
 * Diagnostic terminal surface per epic §11.4:
 * - Raw terminal output via xterm.js placeholder
 * - Terminal input for authorized drivers
 * - Read-only mode for observers
 * - Terminal resize support
 * - Clear indication this is diagnostic, not the primary control model
 *
 * Uses CSS design tokens (var(--color-*)).
 *
 * TODO: Integrate xterm.js when ACP terminal extension supports raw output.
 * TODO: Wire to WebSocket for real terminal data.
 */

import { useState, useRef, useCallback } from 'react';
import { useT } from '../../i18n/context';
import {
  Terminal as TerminalIcon,
  Lock,
  Unlock,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import type {
  AcpTerminalConfig,
  AcpTerminalMode,
  AcpTerminalState,
  AcpTerminalSize,
} from '../../types/acp-terminal';
import {
  DEFAULT_TERMINAL_CONFIG,
  DEFAULT_TERMINAL_THEME,
} from '../../types/acp-terminal';

export interface TerminalDebugTabProps {
  sessionId: string;
  /** Terminal configuration. */
  config?: Partial<AcpTerminalConfig>;
  /** Whether the user is the driver. */
  isDriver?: boolean;
  /** Terminal connection state. */
  terminalState?: AcpTerminalState;
  /** Callback to send input to the terminal. */
  onInput?: (data: string) => void;
  /** Callback to resize the terminal. */
  onResize?: (size: AcpTerminalSize) => void;
  /** Callback to reconnect the terminal. */
  onReconnect?: () => void;
  /** Error message if connection failed. */
  error?: string | null;
}

export function TerminalDebugTab({
  sessionId,
  config,

  terminalState = 'disconnected',
  onInput,
  onResize,
  onReconnect,
  error = null,
}: TerminalDebugTabProps) {
    const t = useT();

  const fullConfig = { ...DEFAULT_TERMINAL_CONFIG, ...config };
  const mode: AcpTerminalMode = fullConfig.mode;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [terminalSize, setTerminalSize] = useState<AcpTerminalSize>(fullConfig.initialSize);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isConnected = terminalState === 'connected';
  const isConnecting = terminalState === 'connecting';
  const hasError = terminalState === 'error';

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;

    setTerminalOutput((prev) => [...prev, `$ ${text}`, '']);
    if (onInput) onInput(text);
    setInputValue('');

    // Terminal not connected to backend yet
    if (text === 'clear') {
      setTerminalOutput([]);
    } else if (text === 'resize') {
      const newSize = terminalSize.cols === 80
        ? { cols: 120, rows: 36 }
        : { cols: 80, rows: 24 };
      setTerminalSize(newSize);
      onResize?.(newSize);
    } else {
      setTerminalOutput((prev) => [
        ...prev,
        'Terminal not connected — waiting for ACP backend.',
        '',
      ]);
    }

    inputRef.current?.focus();
  }, [inputValue, onInput, terminalSize, onResize]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div
      className={`flex flex-col bg-[var(--color-void)] ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'}`}
      data-session-id={sessionId}
      role="region"
      aria-label={t("aria.terminalDebug")}
    >
      {/* Diagnostic warning bar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-3 py-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
        <span className="text-xs text-[var(--color-warning)]">
          Diagnostic surface — this terminal is for debugging only, not the primary control model
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <TerminalIcon className="h-4 w-4 text-[var(--color-text-muted)]" />
        <span className="text-xs font-mono text-[var(--color-text-muted)]">
          {terminalSize.cols}×{terminalSize.rows}
        </span>

        {/* Mode indicator */}
        <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
          mode === 'driver'
            ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]'
            : 'bg-[var(--color-text-muted)]/10 text-[var(--color-text-muted)]'
        }`}>
          {mode === 'driver' ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {mode === 'driver' ? 'Driver' : 'Read-only'}
        </span>

        {/* Connection state */}
        <span className={`flex items-center gap-1 text-[10px] ${
          isConnected ? 'text-[var(--color-success)]'
          : isConnecting ? 'text-[var(--color-warning)]'
          : hasError ? 'text-[var(--color-error)]'
          : 'text-[var(--color-text-muted)]'
        }`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${
            isConnected ? 'bg-[var(--color-success)]'
            : isConnecting ? 'bg-[var(--color-warning)] animate-pulse'
            : hasError ? 'bg-[var(--color-error)]'
            : 'bg-[var(--color-text-muted)]'
          }`} />
          {terminalState}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {/* Reconnect */}
          {hasError && onReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
              aria-label={t("aria.reconnectTerminal")}
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </button>
          )}

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="border-b border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-3 py-2 text-xs text-[var(--color-error)]" role="alert">
          {error}
        </div>
      )}

      {/* Terminal output area */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-auto p-3 font-mono text-xs leading-5"
        style={{
          fontSize: fullConfig.fontSize,
          fontFamily: fullConfig.fontFamily,
          color: DEFAULT_TERMINAL_THEME.foreground,
          backgroundColor: DEFAULT_TERMINAL_THEME.background,
        }}
        role="log"
        aria-label={t("aria.terminalOutput")}
        aria-live="polite"
      >
        {terminalOutput.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all min-h-[1.25rem]">
            {line || '\u00A0'}
          </div>
        ))}
        {isConnecting && (
          <div className="flex items-center gap-2 text-[var(--color-warning)]">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-text-muted)] border-t-[var(--color-warning)]" />
            Connecting to terminal...
          </div>
        )}
      </div>

      {/* Input area — only for drivers in connected state */}
      {mode === 'driver' && isConnected && (
        <div className="border-t border-[var(--color-border)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[var(--color-success)]">$</span>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command..."
              className="flex-1 bg-transparent font-mono text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none"
              disabled={!isConnected}
              autoFocus
              aria-label={t("aria.terminalInput")}
            />
          </div>
        </div>
      )}

      {/* Read-only notice for observers */}
      {mode === 'read-only' && isConnected && (
        <div className="border-t border-[var(--color-border)] px-3 py-2 text-center text-[10px] text-[var(--color-text-muted)]">
          Observer mode — terminal is read-only
        </div>
      )}
    </div>
  );
}
