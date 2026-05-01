/**
 * pages/LoginPage.tsx — Full-screen login form for API token authentication.
 */

import { type FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Shield, Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore.js';
import { useT } from '../i18n/context';

export default function LoginPage() {
  const t = useT();
  const login = useAuthStore((s) => s.login);
  const loginWithOidc = useAuthStore((s) => s.loginWithOidc);
  const init = useAuthStore((s) => s.init);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isVerifying = useAuthStore((s) => s.isVerifying);
  const oidcAvailable = useAuthStore((s) => s.oidcAvailable);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const fromLocation = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
  const from = fromLocation
    ? `${fromLocation.pathname ?? '/'}${fromLocation.search ?? ''}${fromLocation.hash ?? ''}`
    : '/';

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (oidcAvailable) {
      setToken('');
    }
  }, [oidcAvailable]);

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setError('');
    setLoading(true);
    const success = await login(trimmed);
    setLoading(false);

    if (!success) {
      setError(t('login.invalidToken'));
    }
    // On success, the auth store sets isAuthenticated and ProtectedRoute redirects
  }

  function handleOidcLogin(): void {
    setError('');
    loginWithOidc();
  }

  const checkingAuthMode = oidcAvailable === null && isVerifying;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-void)]">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        {/* Logo / Title */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <Shield className="h-10 w-10 text-blue-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Aegis</h1>
          <p className="text-sm text-gray-400">
            {oidcAvailable ? 'Sign in with your identity provider to continue' : 'Enter your API token to continue'}
          </p>
        </div>

        {checkingAuthMode ? (
          <div className="flex justify-center py-2" aria-label="Checking authentication">
            <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-500" />
          </div>
        ) : oidcAvailable ? (
          <button
            type="button"
            onClick={handleOidcLogin}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            <LogIn className="h-4 w-4" />
            <span>Sign in with SSO</span>
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="relative">
              <label htmlFor="token" className="sr-only">API token</label>
              <input
                id="token"
                name="token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="API token"
                autoFocus
                autoComplete="current-password"
                className="min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 pr-12 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none touch-action-manipulation"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-gray-200"
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="min-h-[44px] rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t('login.verifying') : t('login.signInButton')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
