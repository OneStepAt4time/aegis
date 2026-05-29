/**
 * components/shared/SessionExpiredModal.tsx — Re-auth modal when session cookie expires.
 *
 * Shows a modal dialog when the 1-hour session cookie expires.
 * User can re-enter their API key to continue without losing
 * their current page state.
 */

import { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useSessionExpiryGuard } from '../../hooks/useSessionExpiryGuard';
import { useT } from '../../i18n/context';

export function SessionExpiredModal() {
  const t = useT();
  const { isExpired } = useSessionExpiryGuard();
  const login = useAuthStore((s) => s.login);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isExpired) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const success = await login(token.trim());
      if (!success) {
        setError('Invalid API key. Please try again.');
      }
      // On success, the auth store updates isAuthenticated →
      // useSessionExpiryGuard subscription resets isExpired → modal unmounts
    } catch {
      setError('Authentication failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('aria.sessionExpired')}
    >
      <div className="mx-4 w-full max-w-sm rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-warning)]/15">
            <Lock className="h-5 w-5 text-[var(--color-warning)]" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Session Expired</h2>
            <p className="text-xs text-[var(--color-text-muted)]">Your session has timed out after 1 hour</p>
          </div>
        </div>

        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          Re-enter your API key to continue where you left off. Your current page state is preserved.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your API key"
              className="min-h-[44px] w-full rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 pr-12 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent-cyan)] focus-visible:outline-none"
              autoFocus
              autoComplete="off"
              disabled={isSubmitting}
              aria-label={t('aria.apiKey')}
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              aria-label={showToken ? 'Hide API key' : 'Show API key'}
            >
              {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {error && (
            <p className="text-xs text-[var(--color-danger)]" role="alert">{error}</p>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !token.trim()}
            className="min-h-[44px] w-full rounded-lg bg-[var(--color-cta-bg)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 transition-opacity"
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Re-authenticating…
              </span>
            ) : (
              'Re-authenticate'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
