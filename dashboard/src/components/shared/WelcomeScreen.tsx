/**
 * components/shared/WelcomeScreen.tsx — First-run welcome screen.
 *
 * Full-page hero shown when the dashboard has zero sessions.
 * This is the first thing a user sees after `aegis init` opens the browser.
 *
 * Primary CTA: Connect Telegram (links to /settings/notifications)
 * Secondary: CLI quick-start hint
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Terminal, Copy, Check, ArrowRight, Zap } from 'lucide-react';
import { copyToClipboard } from '../../utils/clipboard';

const CLI_COMMAND = 'ag run "hello world"';

export default function WelcomeScreen() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(CLI_COMMAND);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-12">
      {/* Hero */}
      <div className="flex flex-col items-center gap-4 text-center">
        {/* Logo / Icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-accent-cyan)]/20 to-[var(--color-accent-cyan)]/5">
          <Zap className="h-8 w-8 text-[var(--color-accent-cyan)]" aria-hidden="true" />
        </div>

        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">
            Welcome to Aegis
          </h1>
          <p className="mt-2 max-w-md text-base text-[var(--color-text-muted)]">
            Your coding agents, managed. Approve sessions, track costs, and stay in control — from your browser or your phone.
          </p>
        </div>
      </div>

      {/* Primary CTA: Connect Telegram */}
      <div className="mt-10 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/settings/notifications')}
          className="min-h-[48px] inline-flex items-center gap-2.5 rounded-xl bg-[var(--color-accent-cyan)] px-8 py-3 text-base font-semibold text-[var(--color-void)] shadow-lg shadow-[var(--color-accent-cyan)]/20 transition-all hover:shadow-xl hover:shadow-[var(--color-accent-cyan)]/30 hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)]"
          aria-label="Connect Telegram to approve sessions from your phone"
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          Connect Telegram
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="text-xs text-[var(--color-text-muted)]">
          Approve sessions from your phone — one tap.
        </p>
      </div>

      {/* Divider */}
      <div className="mt-10 flex w-full max-w-sm items-center gap-3">
        <div className="h-px flex-1 bg-[var(--color-border-strong)]" />
        <span className="text-xs text-[var(--color-text-muted)]">or get started from the CLI</span>
        <div className="h-px flex-1 bg-[var(--color-border-strong)]" />
      </div>

      {/* Secondary: CLI hint */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] px-4 py-2.5">
          <Terminal className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          <code className="font-mono text-sm text-[var(--color-text-primary)]">
            {CLI_COMMAND}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
            aria-label={copied ? 'Copied' : 'Copy command'}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Run your first agent session from the terminal
        </p>
      </div>
    </div>
  );
}
