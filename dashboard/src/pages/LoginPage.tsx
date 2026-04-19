/**
 * pages/LoginPage.tsx — Full-screen login form for API token authentication.
 */

import { type FormEvent, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Shield, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore.js';

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const init = useAuthStore((s) => s.init);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
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
      setError('Invalid API token');
    }
    // On success, the auth store sets isAuthenticated and ProtectedRoute redirects
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-void)]]">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8">
        {/* Logo / Title */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <Shield className="h-10 w-10 text-blue-500" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Aegis</h1>
          <p className="text-sm text-gray-400">Enter your API token to continue</p>
        </div>

        {/* Form */}
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
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 pr-10 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none touch-action-manipulation"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
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
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
