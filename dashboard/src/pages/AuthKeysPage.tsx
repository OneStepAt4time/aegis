import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  createAuthKey,
  getAuthKeys,
  revokeAuthKey,
  type AuthKey,
  type CreatedAuthKey,
} from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatTimeAgo } from '../utils/format';
import { CopyButton } from '../components/shared/CopyButton';

const REFRESH_INTERVAL_MS = 15_000;
const SECRET_CLEAR_MS = 60_000;
const USERS_BANNER_DISMISSED_KEY = 'aegis:users-banner-dismissed';

function isUsersRedirectState(state: unknown): boolean {
  if (state === null || typeof state !== 'object') return false;
  const record = state as Record<string, unknown>;
  return record.usersRedirect === true;
}

function formatCreatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function maskKey(key: string): string {
  if (key.length <= 12) return '•'.repeat(key.length);
  return `${key.slice(0, 8)}${'•'.repeat(Math.max(8, key.length - 12))}${key.slice(-4)}`;
}

function PermissionBadges({ permissions }: { permissions?: readonly string[] }) {
  if (!permissions || permissions.length === 0) {
    return <p className="mt-2 text-xs text-gray-500">No action permissions</p>;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {permissions.map((permission) => (
        <span
          key={permission}
          className="rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[11px] text-[var(--color-accent-cyan)]"
        >
          {permission}
        </span>
      ))}
    </div>
  );
}

export default function AuthKeysPage() {
  const location = useLocation();
  const [keys, setKeys] = useState<AuthKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{ id: string; name: string } | null>(null);
  const [createdKey, setCreatedKey] = useState<CreatedAuthKey | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const addToast = useToastStore((store) => store.addToast);

  const [showUsersBanner, setShowUsersBanner] = useState<boolean>(() => {
    if (!isUsersRedirectState(location.state)) return false;
    try {
      return sessionStorage.getItem(USERS_BANNER_DISMISSED_KEY) !== '1';
    } catch {
      return true;
    }
  });

  function dismissUsersBanner(): void {
    setShowUsersBanner(false);
    try {
      sessionStorage.setItem(USERS_BANNER_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage failures — banner will simply reappear on next redirect.
    }
  }

  const fetchKeys = useCallback(async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const data = await getAuthKeys();
      setKeys(data.slice().sort((left, right) => right.createdAt - left.createdAt));
      setError(null);
    } catch (err) {
      // #1168: Suppress 403 noise - user simply lacks permission
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      if (statusCode === 403) {
        setKeys([]);
        setError(null);
        return;
      }
      // Sanitize raw validation errors — don't leak Zod schema details
      const rawMessage = err instanceof Error ? err.message : '';
      const isValidationError = rawMessage.includes('validation failed');
      const userMessage = isValidationError
        ? 'Could not load auth keys — data format mismatch. Try refreshing or contact your administrator.'
        : 'Failed to load auth keys';
      setError(userMessage);
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [addToast]);

  useEffect(() => {
    fetchKeys();
    const interval = setInterval(() => {
      void fetchKeys(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchKeys]);

  useEffect(() => {
    if (!createdKey) return;
    const timer = setTimeout(() => {
      setCreatedKey(null);
      setSecretVisible(false);
    }, SECRET_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [createdKey]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setCreating(true);
    try {
      const result = await createAuthKey(trimmedName);
      setCreatedKey(result);
      setSecretVisible(false);
      setName('');
      addToast('success', 'Auth key created', 'Store the secret now. It is only shown once.');
      await fetchKeys(true);
    } catch (err) {
      addToast(
        'error',
        'Failed to create auth key',
        err instanceof Error ? err.message : undefined,
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopySecret(): Promise<void> {
    if (!createdKey) return;
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser');
      }
      await navigator.clipboard.writeText(createdKey.key);
      addToast('success', 'Auth key copied');
    } catch (err) {
      addToast('warning', 'Failed to copy auth key', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleRevoke(id: string, keyName: string): Promise<void> {
    setRevokeConfirm({ id, name: keyName });
  }

  async function executeRevoke(id: string): Promise<void> {
    setRevokingId(id);
    try {
      await revokeAuthKey(id);
      setKeys((current) => current.filter((key) => key.id !== id));
      if (createdKey?.id === id) {
        setCreatedKey(null);
        setSecretVisible(false);
      }
      addToast('success', 'Auth key revoked');
    } catch (err) {
      addToast('error', 'Failed to revoke auth key', err instanceof Error ? err.message : undefined);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {showUsersBanner ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-800/30 px-4 py-3 text-sm text-slate-300"
        >
          <p className="leading-relaxed">
            Users are API keys in single-tenant mode. SSO-backed user identities arrive with Phase 3.
          </p>
          <button
            type="button"
            onClick={dismissUsersBanner}
            aria-label="Dismiss banner"
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-700/40 hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Auth Keys</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create, review, and revoke dashboard API keys without exposing stored secrets.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchKeys(true)}
          disabled={refreshing}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <Plus className="h-4 w-4 text-[var(--color-accent-cyan)]" />
            Create Key
          </div>
          <p className="mt-2 text-sm text-gray-500">
            New secrets are never persisted in the dashboard and are cleared from view after one minute.
          </p>

          <form className="mt-4 space-y-4" onSubmit={handleCreate}>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="auth-key-name">
                Key Name
              </label>
              <input
                id="auth-key-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ops-primary"
                className="min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:border-[var(--color-accent-cyan)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-sm font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" />
              {creating ? 'Creating…' : 'Create Auth Key'}
            </button>
          </form>

          {createdKey ? (
            <div className="mt-5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4" role="status">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-emerald-300">Store this key now</h3>
                  <p className="mt-1 text-xs text-emerald-200/80">
                    This secret is shown once and is hidden by default.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreatedKey(null);
                    setSecretVisible(false);
                  }}
                  className="text-xs font-medium text-emerald-200/80 transition-colors hover:text-emerald-200"
                >
                  Dismiss
                </button>
              </div>

              <dl className="mt-4 space-y-3 text-sm text-gray-200">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-500">Name</dt>
                  <dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">{createdKey.name}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-500">Secret</dt>
                  <dd className="mt-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 font-mono text-xs text-[var(--color-accent-cyan)]">
                    {secretVisible ? createdKey.key : maskKey(createdKey.key)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-500">Permissions</dt>
                  <dd>
                    <PermissionBadges permissions={createdKey.permissions} />
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSecretVisible((current) => !current)}
                  className="flex min-h-[40px] items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
                >
                  {secretVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {secretVisible ? 'Hide secret' : 'Reveal secret'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySecret()}
                  className="flex min-h-[40px] items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy secret
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-void-lighter)] pb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Existing Keys</h3>
              <p className="mt-1 text-xs text-gray-500">
                {keys.length} key{keys.length === 1 ? '' : 's'} configured
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-500">
              <div className="animate-pulse">Loading auth keys…</div>
            </div>
          ) : error ? (
            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">
              <p className="font-medium">Unable to load auth keys</p>
              <p className="mt-1 text-amber-200/80">{error}</p>
              <button
                type="button"
                onClick={() => void fetchKeys()}
                className="mt-4 rounded border border-amber-500/30 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/10"
              >
                Retry
              </button>
            </div>
          ) : keys.length === 0 ? (
            <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-void-lighter)] bg-[var(--color-void)] px-6 text-center">
              <KeyRound className="h-8 w-8 text-gray-600" />
              <p className="mt-4 text-sm font-medium text-gray-300">No auth keys yet</p>
              <p className="mt-1 max-w-md text-sm text-gray-500">
                Create a key to grant API access without sharing the dashboard bearer token.
              </p>
              <div className="mt-4 flex flex-col items-center gap-2">
                <p className="text-xs text-gray-500">
                  Feature gating details in{' '}
                  <a
                    href="https://github.com/OneStepAt4time/aegis/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-accent-cyan)] hover:underline"
                  >
                    GitHub issues
                  </a>
                </p>
                <div className="flex items-center gap-2 rounded bg-[var(--color-void-dark)] px-3 py-2 font-mono text-xs text-[var(--color-text-muted)]">
                  <code>ag doctor</code>
                  <CopyButton value="ag doctor" label="command" size={16} />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {keys.map((key) => (
                <article
                  key={key.id}
                  className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)] p-4"
                >
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                     <div className="min-w-0">
                       <div className="group flex items-center gap-2">
                         <span className="truncate font-medium text-gray-900 dark:text-gray-100">{key.name}</span>
                         <span className="flex items-center gap-1 rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[11px] text-gray-500">
                           {key.id}
                           <CopyButton value={key.id} label="key ID" size={16} />
                         </span>
                       </div>
                       <p className="mt-2 text-sm text-gray-400">
                         Created <span title={formatCreatedAt(key.createdAt)}>{formatTimeAgo(key.createdAt)}</span>
                       </p>
                       <div className="mt-3">
                         <p className="text-xs uppercase tracking-wide text-gray-500">Permissions</p>
                         <PermissionBadges permissions={key.permissions} />
                       </div>
                     </div>

                    <button
                      type="button"
                      onClick={() => void handleRevoke(key.id, key.name)}
                      disabled={revokingId === key.id}
                       className="flex min-h-[40px] items-center justify-center gap-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {revokingId === key.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={revokeConfirm !== null}
        title="Revoke Auth Key"
        message={revokeConfirm ? `Revoke auth key "${revokeConfirm.name}"? This cannot be undone.` : ''}
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={() => {
          if (revokeConfirm) {
            void executeRevoke(revokeConfirm.id);
            setRevokeConfirm(null);
          }
        }}
        onCancel={() => setRevokeConfirm(null)}
      />
    </div>
  );
}
