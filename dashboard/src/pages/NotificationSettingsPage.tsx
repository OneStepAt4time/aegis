/**
 * pages/NotificationSettingsPage.tsx — Telegram notification integration settings.
 *
 * Allows users to connect a Telegram bot for one-tap session approval.
 * Part of the one-tap Telegram approval feature (backend stubs until wired).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Send,
  Unplug,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  MessageCircle,
  Eye,
  EyeOff,
  ExternalLink,
} from 'lucide-react';
import { useToastStore } from '../store/useToastStore';
import { useT } from '../i18n/context';
import { ConfirmDestructive } from '../components/shared/ConfirmDestructive';
import type {
  TelegramConnectionState,
  TelegramConnectionConfig,
} from '../types';

// Use mock implementations until backend is ready
// Swap to real imports when Hep ships the endpoints:
// import { getTelegramConnection, saveTelegramConnection, ... } from '../api/telegram-client';
import {
  mockGetTelegramConnection as getTelegramConnection,
  mockSaveTelegramConnection as saveTelegramConnection,
  mockSendTelegramTestNotification as sendTestNotification,
  mockDisconnectTelegram as disconnectTelegram,
} from '../api/telegram-client';

type ConnectionStatus = TelegramConnectionState['status'];

const STATUS_CONFIG: Record<ConnectionStatus, { color: string; icon: typeof CheckCircle2; label: string }> = {
  connected: { color: 'text-[var(--color-success)]', icon: CheckCircle2, label: 'Connected' },
  disconnected: { color: 'text-[var(--color-text-muted)]', icon: Unplug, label: 'Disconnected' },
  error: { color: 'text-[var(--color-danger)]', icon: XCircle, label: 'Error' },
  testing: { color: 'text-[var(--color-warning)]', icon: Loader2, label: 'Testing…' },
};

export default function NotificationSettingsPage() {
  const addToast = useToastStore((s) => s.addToast);
  const t = useT();

  // ── State ────────────────────────────────────────────
  const [connection, setConnection] = useState<TelegramConnectionState>({ status: 'disconnected' });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // ── Load connection state ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getTelegramConnection();
        if (!cancelled) {
          setConnection(state);
          if (state.status === 'connected') {
            // Pre-fill with placeholder when connected (token is not returned)
            setBotToken('••••••••••••••••••');
            setChatId(state.chatTitle ?? '');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setConnection({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load' });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Cleanup ref
  useEffect(() => () => { mountedRef.current = false; }, []);

  // ── Handlers ─────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const config: TelegramConnectionConfig = { botToken, chatId };
      const state = await saveTelegramConnection(config);
      if (mountedRef.current) {
        setConnection(state);
        if (state.status === 'connected') {
          setBotToken('••••••••••••••••••');
          addToast('success', 'Telegram connected', state.botUsername ?? 'Bot connected successfully');
        } else {
          setSaveError(state.error ?? 'Connection failed');
          addToast('error', 'Connection failed', state.error ?? 'Unknown error');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save';
      if (mountedRef.current) {
        setSaveError(msg);
        addToast('error', 'Connection failed', msg);
      }
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [botToken, chatId, addToast]);

  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setConnection((prev) => ({ ...prev, status: 'testing' }));
    try {
      const result = await sendTestNotification();
      if (mountedRef.current) {
        if (result.ok) {
          addToast('success', 'Test sent', result.message);
          setConnection((prev) => ({ ...prev, status: 'connected' }));
        } else {
          addToast('error', 'Test failed', result.message);
          setConnection((prev) => ({ ...prev, status: 'error', error: result.message }));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed';
      if (mountedRef.current) {
        addToast('error', 'Test failed', msg);
        setConnection((prev) => ({ ...prev, status: 'error', error: msg }));
      }
    } finally {
      if (mountedRef.current) setIsTesting(false);
    }
  }, [addToast]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectTelegram();
      if (mountedRef.current) {
        setConnection({ status: 'disconnected' });
        setBotToken('');
        setChatId('');
        setSaveError(null);
        addToast('info', 'Telegram disconnected', 'Integration removed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Disconnect failed';
      if (mountedRef.current) {
        addToast('error', 'Disconnect failed', msg);
      }
    }
  }, [addToast]);

  // ── Helpers ──────────────────────────────────────────
  const isConnected = connection.status === 'connected';
  const isFormReady = botToken.length > 0 && chatId.length > 0 && botToken !== '••••••••••••••••••';
  const statusCfg = STATUS_CONFIG[connection.status];
  const StatusIcon = statusCfg.icon;

  // ── Render ───────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <MessageCircle className="h-6 w-6 text-[var(--color-accent-cyan)]" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Connect Telegram to approve sessions from your phone.
          </p>
        </div>
      </div>

      {isLoading ? (
        /* Loading skeleton */
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5 space-y-4">
          <div className="h-5 w-32 animate-shimmer rounded bg-[var(--color-surface-hover)]" />
          <div className="h-10 w-full animate-shimmer rounded bg-[var(--color-surface-hover)]" />
          <div className="h-10 w-full animate-shimmer rounded bg-[var(--color-surface-hover)]" />
          <div className="h-10 w-32 animate-shimmer rounded bg-[var(--color-surface-hover)]" />
        </div>
      ) : (
        <>
          {/* Connection Status Card */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
                Connection Status
              </h3>
              <div className="flex items-center gap-2">
                <StatusIcon
                  className={`h-4 w-4 ${statusCfg.color} ${
                    connection.status === 'testing' ? 'animate-spin' : ''
                  }`}
                />
                <span className={`text-sm font-medium ${statusCfg.color}`}>
                  {statusCfg.label}
                </span>
              </div>
            </div>

            {isConnected && connection.botUsername && (
              <div className="mb-4 flex flex-col gap-1 rounded-md bg-[var(--color-surface)] p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--color-text-muted)]">Bot</span>
                  <span className="font-mono text-[var(--color-text-primary)]">@{connection.botUsername}</span>
                </div>
                {connection.chatTitle && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Chat</span>
                    <span className="text-[var(--color-text-primary)]">{connection.chatTitle}</span>
                  </div>
                )}
                {connection.connectedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--color-text-muted)]">Connected</span>
                    <span className="text-[var(--color-text-primary)]">
                      {new Date(connection.connectedAt).toLocaleDateString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>
            )}

            {connection.status === 'error' && connection.error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-[var(--color-danger)]/20 bg-[var(--color-error-bg)]/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--color-danger)]" />
                <p className="text-[var(--color-danger)]">{connection.error}</p>
              </div>
            )}
          </section>

          {/* Configuration Form */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
            <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-4">
              {isConnected ? 'Configuration' : 'Setup'}
            </h3>

            <div className="space-y-4">
              {/* Bot Token */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="telegram-bot-token" className="text-sm font-medium text-[var(--color-text-primary)]">
                  Bot Token
                </label>
                <p className="text-xs text-[var(--color-text-muted)]">
                  From{' '}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent-cyan)] hover:underline inline-flex items-center gap-0.5"
                  >
                    @BotFather <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </p>
                <div className="relative">
                  <input
                    id="telegram-bot-token"
                    type={showToken ? 'text' : 'password'}
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    disabled={isConnected}
                    autoComplete="off"
                    aria-label="Telegram bot token"
                    className="min-h-[44px] w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 pr-10 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent-cyan)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    disabled={isConnected}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Chat ID */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="telegram-chat-id" className="text-sm font-medium text-[var(--color-text-primary)]">
                  Chat ID
                </label>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Your Telegram chat ID for notifications. Use{' '}
                  <a
                    href="https://t.me/userinfobot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent-cyan)] hover:underline inline-flex items-center gap-0.5"
                  >
                    @userinfobot <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                  {' '}to find it.
                </p>
                <input
                  id="telegram-chat-id"
                  type="text"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="-1001234567890"
                  disabled={isConnected}
                  autoComplete="off"
                  aria-label="Telegram chat ID"
                  className="min-h-[44px] w-full rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] transition-colors focus:border-[var(--color-accent-cyan)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              {/* Save error */}
              {saveError && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-[var(--color-danger)]/20 bg-[var(--color-error-bg)]/10 p-3 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[var(--color-danger)]" />
                  <p className="text-[var(--color-danger)]">{saveError}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 pt-2">
                {!isConnected ? (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!isFormReady || isSaving}
                    className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-[var(--color-cta-bg)] px-4 py-2 text-sm font-medium text-[var(--color-cta-text)] transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-cta-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Connecting…
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" aria-hidden="true" />
                        Connect
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={isTesting}
                      className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" aria-hidden="true" />
                          Send Test
                        </>
                      )}
                    </button>

                    <ConfirmDestructive
                      mode="hold"
                      label={t("notifications.disconnect")}
                      onConfirm={handleDisconnect}
                    />
                  </>
                )}
              </div>
            </div>
          </section>

          {/* How it works — info card */}
          <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-5">
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
              How it works
            </h3>
            <ol className="list-decimal list-inside space-y-2 text-sm text-[var(--color-text-muted)]">
              <li>
                Create a bot via{' '}
                <a
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent-cyan)] hover:underline"
                >
                  @BotFather
                </a>{' '}
                and copy the token.
              </li>
              <li>
                Find your Chat ID using{' '}
                <a
                  href="https://t.me/userinfobot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--color-accent-cyan)] hover:underline"
                >
                  @userinfobot
                </a>
                .
              </li>
              <li>Enter both above and hit <strong className="text-[var(--color-text-primary)]">Connect</strong>.</li>
              <li>
                When a session needs approval, you'll get a Telegram message with{' '}
                <strong className="text-[var(--color-success)]">Approve</strong> /{' '}
                <strong className="text-[var(--color-danger)]">Reject</strong> buttons.
              </li>
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
