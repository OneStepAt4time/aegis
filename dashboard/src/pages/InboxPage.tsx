/**
 * InboxPage.tsx — Structured notification feed for agent activity.
 */

import { useEffect, useCallback } from 'react';
import {
  Inbox,
  CheckCheck,
  Archive,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  AtSign,
  Moon,
  Loader2,
} from 'lucide-react';
import { useInboxStore } from '../store/useInboxStore';
import { useT } from '../i18n/context';
import type { InboxItemType } from '../types/inbox';
import { useNavigate } from 'react-router-dom';

const TYPE_CONFIG: Record<InboxItemType, { icon: typeof CheckCircle2; accentVar: string }> = {
  task_completed: { icon: CheckCircle2, accentVar: 'var(--color-success)' },
  task_failed: { icon: XCircle, accentVar: 'var(--color-danger)' },
  blocker: { icon: AlertTriangle, accentVar: 'var(--color-warning)' },
  mention: { icon: AtSign, accentVar: 'var(--color-cta-bg)' },
  session_idle: { icon: Moon, accentVar: 'var(--color-text-muted)' },
};

function formatTimeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function InboxPage() {
  const t = useT();
  const navigate = useNavigate();
  const {
    items, filter, isLoading, error, unreadCount,
    markRead, markAllRead, archiveItem, archiveAllRead,
    setFilter, setLoading, setError,
  } = useInboxStore();

  const loadInbox = useCallback(() => {
    setError(null);
    setLoading(false);
  }, [setLoading, setError]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const handleMarkRead = useCallback(async (id: string) => {
    markRead(id);
  }, [markRead]);

  const handleMarkAllRead = useCallback(async () => {
    markAllRead();
  }, [markAllRead]);

  const handleArchive = useCallback(async (id: string) => {
    archiveItem(id);
  }, [archiveItem]);

  const handleArchiveAllRead = useCallback(async () => {
    archiveAllRead();
  }, [archiveAllRead]);

  const handleItemClick = useCallback((item: typeof items[number]) => {
    if (!item.readAt) void handleMarkRead(item.id);
    if (item.referenceType === 'session' && item.referenceId) {
      navigate(`/sessions/${item.referenceId}`);
    }
  }, [handleMarkRead, navigate]);

  const filteredItems = items.filter((item) => {
    if (filter === 'unread') return !item.readAt;
    if (filter === 'archived') return !!item.archivedAt;
    return !item.archivedAt;
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="h-6 w-6 text-[var(--color-cta-bg)]" aria-hidden="true" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            {t('inbox.title')}
          </h1>
          {unreadCount > 0 && (
            <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--color-cta-bg)] px-2 text-xs font-bold text-[var(--color-void)]">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label={t('inbox.markAllRead')}
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('inbox.markAllRead')}</span>
            </button>
          )}
{items.some((i) => i.readAt && !i.archivedAt) && (
            <button
              type="button"
              onClick={() => void handleArchiveAllRead()}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              aria-label={t('inbox.archiveAllRead')}
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('inbox.archiveAllRead')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--color-surface)] p-1" role="tablist" aria-label={t('inbox.filters')}>
        {(['all', 'unread', 'archived'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-[var(--color-cta-bg)] text-[var(--color-void)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t(`inbox.filter.${f}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20" role="status">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" aria-hidden="true" />
          <span className="ml-3 text-[var(--color-text-muted)]">{t('inbox.loading')}</span>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5 px-4 py-6 text-center text-[var(--color-danger)]" role="alert">
          {error}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="py-20 text-center text-[var(--color-text-muted)]">
          <Inbox className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
          <p>{filter === 'all' ? t('inbox.empty') : t(`inbox.empty.${filter}`)}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1" role="list" aria-label={t('inbox.itemList')}>
          {filteredItems.map((item) => {
            const config = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.session_idle;
            const Icon = config.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleItemClick(item)}
                  className={`group flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
                    !item.readAt ? 'bg-[var(--color-surface)]' : ''
                  }`}
                  aria-label={`${item.title}${!item.readAt ? ' (unread)' : ''}`}
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${config.accentVar}15` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: config.accentVar }} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm font-medium ${!item.readAt ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                        {item.title}
                      </p>
                      <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        {formatTimeAgo(item.createdAt)}
                      </span>
                    </div>
                    {item.body && (
                      <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                        {item.body}
                      </p>
                    )}
                  </div>
                  {!item.readAt && (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--color-cta-bg)]" aria-hidden="true" />
                  )}
                </button>
                <div className="flex justify-end gap-1 px-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">
                  {!item.readAt && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleMarkRead(item.id); }}
                      className="rounded p-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                      aria-label={t('inbox.markRead')}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleArchive(item.id); }}
                    className="rounded p-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    aria-label={t('inbox.archive')}
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default InboxPage;
