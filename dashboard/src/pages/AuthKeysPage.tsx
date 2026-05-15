/**
 * pages/AuthKeysPage.tsx — API key management with create, reveal, and revoke.
 */

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
import { SkeletonTable } from '../components/shared/Skeleton';
import EmptyState from '../components/shared/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { useT } from '../i18n/context';

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

function PermissionBadges({ permissions, noPermissionsLabel }: { permissions?: readonly string[]; noPermissionsLabel: string }) {
  if (!permissions || permissions.length === 0) {
    return <p className="mt-2 text-xs text-[var(--color-text-muted)]">{noPermissionsLabel}</p>;
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
  const t = useT();
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
      const statusCode = (err as Error & { statusCode?: number }).statusCode;
      if (statusCode === 403) {
        setKeys([]);
        setError(null);
        return;
      }
      const rawMessage = err instanceof Error ? err.message : '';
      const isValidationError = rawMessage.includes('validation failed');
      const userMessage = isValidationError
        ? t('authKeys.validationError')
        : t('authKeys.loadError');
      setError(userMessage);
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [addToast, t]);

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
      addToast('success', t('authKeys.createdToast'), t('authKeys.createdToastDescription'));
      await fetchKeys(true);
    } catch (err) {
      addToast(
        'error',
        t('authKeys.createFailed'),
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
      addToast('success', t('authKeys.copied'));
    } catch (err) {
      addToast('warning', t('authKeys.copyFailed'), err instanceof Error ? err.message : undefined);
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
      addToast('success', t('authKeys.revokedToast'));
    } catch (err) {
      addToast('error', t('authKeys.revokeFailed'), err instanceof Error ? err.message : undefined);
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
          className="flex items-start justify-between gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-strong)] p-4 text-sm text-[var(--color-text-primary)]"
        >
          <p className="leading-relaxed">
            {t('authKeys.usersBannerText')}
          </p>
          <button
            type="button"
            onClick={dismissUsersBanner}
            aria-label={t('authKeys.authDismissBanner')}
            className="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('authKeys.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {t('authKeys.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchKeys(true)}
          aria-label={t('authKeys.refresh')}
          disabled={refreshing}
          className="flex min-h-[44px] items-center justify-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {t('authKeys.refresh')}
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <section className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
            <Plus className="h-4 w-4 text-[var(--color-accent-cyan)]" />
            {t('authKeys.createKey')}
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {t('authKeys.newSecretsDescription')}
          </p>

          <form className="mt-4 space-y-4" onSubmit={handleCreate}>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-muted)]" htmlFor="auth-key-name">
                {t('authKeys.keyName')}
              </label>
              <input
                id="auth-key-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ops-primary"
                className="min-h-[44px] w-full rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent-cyan)] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={creating || !name.trim()}
              aria-label={t('authKeys.createAuthKey')}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-sm font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" />
              {creating ? t('authKeys.creating') : t('authKeys.createAuthKey')}
            </button>
          </form>

          {createdKey ? (
            <div className="mt-5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4" role="status">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-emerald-300">{t('authKeys.storeKeyNow')}</h3>
                  <p className="mt-1 text-xs text-emerald-200/80">
                    {t('authKeys.secretShownOnce')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreatedKey(null);
                    setSecretVisible(false);
                  }}
                  className="text-xs font-medium text-emerald-200/80 transition-colors hover:text-emerald-200"
                  aria-label={t('authKeys.dismiss')}
                >
                  {t('authKeys.dismiss')}
                </button>
              </div>

              <dl className="mt-4 space-y-3 text-sm text-[var(--color-text-primary)]">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('authKeys.nameLabel')}</dt>
                  <dd className="mt-1 font-medium text-[var(--color-text-primary)]">{createdKey.name}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('authKeys.secretLabel')}</dt>
                  <dd className="mt-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 font-mono text-xs text-[var(--color-accent-cyan)]">
                    {secretVisible ? createdKey.key : maskKey(createdKey.key)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('authKeys.permissionsLabel')}</dt>
                  <dd>
                    <PermissionBadges permissions={createdKey.permissions} noPermissionsLabel={t('authKeys.noPermissions')} />
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSecretVisible((current) => !current)}
                  className="flex min-h-[40px] items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
                  aria-label={t('authKeys.authToggleSecret')}
                >
                  {secretVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  {secretVisible ? t('authKeys.hideSecret') : t('authKeys.revealSecret')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopySecret()}
                  className="flex min-h-[40px] items-center gap-2 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void)] px-3 py-2 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent-cyan)]/30 hover:text-[var(--color-accent-cyan)]"
                  aria-label={t('authKeys.authCopySecret')}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('authKeys.copySecret')}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-5">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-void-lighter)] pb-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{t('authKeys.existingKeys')}</h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {t('authKeys.keysConfigured', { count: keys.length })}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-4">
              <SkeletonTable rows={3} />
            </div>
          ) : error ? (
            <ErrorState variant="server-5xx" message={error} onRetry={() => void fetchKeys()} />
          ) : keys.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="h-8 w-8" />}
              title={t('authKeys.noAuthKeysYet')}
              description={t('authKeys.noAuthKeysDescription')}
            />
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
                         <span className="truncate font-medium text-[var(--color-text-primary)]">{key.name}</span>
                         <span className="flex items-center gap-1 rounded-full border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)]">
                           {key.id}
                           <CopyButton value={key.id} label="key ID" size={16} />
                         </span>
                       </div>
                       <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                         {t('authKeys.created')} <span title={formatCreatedAt(key.createdAt)}>{formatTimeAgo(key.createdAt)}</span>
                       </p>
                       <div className="mt-3">
                         <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{t('authKeys.permissionsLabel')}</p>
                         <PermissionBadges permissions={key.permissions} noPermissionsLabel={t('authKeys.noPermissions')} />
                       </div>
                     </div>

                    <button
                      type="button"
                      onClick={() => void handleRevoke(key.id, key.name)}
                      disabled={revokingId === key.id}
                      aria-label={`Revoke auth key ${key.name}`}
                       className="flex min-h-[40px] items-center justify-center gap-2 rounded border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/05 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300 transition-colors hover:bg-[var(--color-danger)]/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {revokingId === key.id ? t('authKeys.revoking') : t('authKeys.revoke')}
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
        title={t('authKeys.revokeDialogTitle')}
        message={revokeConfirm ? t('authKeys.revokeDialogMessage', { name: revokeConfirm.name }) : ''}
        confirmLabel={t('authKeys.revoke')}
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
