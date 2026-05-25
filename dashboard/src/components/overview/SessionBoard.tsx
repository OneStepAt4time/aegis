/**
 * components/overview/SessionBoard.tsx
 *
 * Kanban board view for sessions. Displays sessions in columns
 * by status, inspired by Multica's board view but using
 * Aegis session data.
 *
 * Columns: Running | Waiting | Idle | Other
 * Each card shows: session name, model, status, last activity.
 * Pagination: "Load X more" button when sessions exceed page size.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { getSessions } from '../../api/client';
import type { SessionInfo, UIState } from '../../types';
import StatusDot from './StatusDot';
import { useStore } from '../../store/useStore';
import { useSseAwarePolling } from '../../hooks/useSseAwarePolling';
import { Loader2, Columns3, ChevronDown } from 'lucide-react';
import { useT } from '../../i18n/context';

const PAGE_SIZE = 100;

const FALLBACK_POLL_INTERVAL_MS = 5_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;

/** Status groupings for board columns */
type BoardColumn = {
  id: string;
  title: string;
  statuses: string[];
  color: string;
};

const BOARD_COLUMNS: BoardColumn[] = [
  {
    id: 'running',
    title: 'colRunning',
    statuses: ['working', 'compacting', 'plan_mode', 'settings'],
    color: 'text-[var(--color-success)]',
  },
  {
    id: 'waiting',
    title: 'colWaiting',
    statuses: ['permission_prompt', 'ask_question', 'bash_approval', 'context_warning', 'waiting_for_input', 'awaiting_approval', 'pending'],
    color: 'text-[var(--color-warning)]',
  },
  {
    id: 'idle',
    title: 'colIdle',
    statuses: ['idle'],
    color: 'text-[var(--color-text-muted)]',
  },
  {
    id: 'errors',
    title: 'colErrors',
    statuses: ['error', 'rate_limit', 'crashed'],
    color: 'text-[var(--color-danger)]',
  },
  {
    id: 'completed',
    title: 'colCompleted',
    statuses: ['completed', 'killed'],
    color: 'text-[var(--color-text-muted)]/70',
  },
];

function getStatusGroup(status: string): string {
  for (const col of BOARD_COLUMNS) {
    if (col.statuses.includes(status)) return col.id;
  }
  return 'other';
}

function formatTimeAgo(timestamp: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('sessions.board.justNow');
  if (mins < 60) return t('sessions.board.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sessions.board.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('sessions.board.daysAgo', { count: days });
}

function formatDuration(start: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diff = Date.now() - start;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t('sessions.board.durationMinutes', { count: mins });
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  return t('sessions.board.durationHours', { count: hours, rest: m });
}

function SessionCard({ session, t }: { session: SessionInfo; t: (key: string, params?: Record<string, string | number>) => string }) {
  const age = formatDuration(session.createdAt, t);
  const lastActive = formatTimeAgo(session.lastActivity, t);
  const statusGroup = getStatusGroup(session.status);

  return (
    <div
      className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)]/80 p-3 hover:bg-[var(--color-surface-hover)] transition-colors cursor-default outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-cyan)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface)]"
      role="article"
      tabIndex={0}
      aria-label={`Session ${session.displayName}, status ${session.status}`}
    >
      {/* Header: status + name */}
      <div className="flex items-start gap-2">
        <StatusDot status={session.status as UIState} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate" title={session.displayName}>
            {session.displayName}
          </p>
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
        {session.model && (
          <span className="rounded-full bg-[var(--color-void-lighter)]/50 px-2 py-0.5 font-mono" title={session.model}>
            {session.model.replace('claude-', '').replace(/-\d{8}$/, '')}
          </span>
        )}
        <span title={`Started ${age} ago`}>⏱ {age}</span>
        <span title={`Last active ${lastActive}`}>💬 {lastActive}</span>
      </div>

      {/* Status indicator for waiting sessions */}
      {statusGroup === 'waiting' && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--color-warning)]">
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] animate-pulse" />
          <span>{t('sessions.board.needsAttention')}</span>
        </div>
      )}
    </div>
  );
}

function BoardColumnView({
  column,
  sessions,
  t,
}: {
  column: BoardColumn;
  sessions: SessionInfo[];
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const colTitle = t(`sessions.board.${column.title}`);
  return (
    <div className="w-full sm:w-[280px] shrink-0 flex flex-col gap-2" role="region" aria-label={`${colTitle} sessions`}>
      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${
            column.id === 'running' ? 'bg-[var(--color-success)]' :
            column.id === 'errors' ? 'bg-[var(--color-danger)]' :
            column.id === 'completed' ? 'bg-[var(--color-text-muted)]/70' :
            column.id === 'waiting' ? 'bg-[var(--color-warning)]' :
            'bg-[var(--color-text-muted)]'
          }`} />
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${column.color}`}>
            {colTitle}
          </h3>
          <span className="rounded-full bg-[var(--color-void-lighter)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
            {sessions.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto rounded-lg p-1" role="list" aria-label={`${colTitle} session list`}>
        {sessions.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]/50">
            {t('sessions.board.columnEmpty')}
          </div>
        )}
        {sessions.map((session) => (
          <div key={session.id} role="listitem">
            <SessionCard session={session} t={t} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionBoard() {
  const t = useT();
  const sseConnected = useStore((s) => s.sseConnected);
  const latestActivity = useStore((s) => s.activities[0] ?? null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  // Issue #4012: AbortController to cancel in-flight loadMore when poll fires
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight loadMore on unmount
  useEffect(() => {
    return () => {
      loadMoreAbortRef.current?.abort();
    };
  }, []);

  const fetchSessions = useCallback(async () => {
    // Issue #4012: Cancel in-flight loadMore to prevent race condition
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;

    try {
      setError(null);
      const result = await getSessions({ limit: PAGE_SIZE, page: 1 });
      setTotalCount(result.pagination.total);
      setSessions((prev) => {
        // Issue #4009: Merge-by-ID refresh instead of wipe.
        // On poll, fetch page 1 and merge into the existing list:
        // - Update existing sessions in-place (status changes, etc.)
        // - Prepend new sessions not yet in the list
        // - Keep sessions from pages 2+ intact even if not in page 1
        const freshMap = new Map(result.sessions.map((s) => [s.id, s]));
        const existingMap = new Map(prev.map((s) => [s.id, s]));
        const updated = prev.map((s) => freshMap.get(s.id) ?? s);
        const newFromPage1 = result.sessions.filter((s) => !existingMap.has(s.id));
        return [...newFromPage1, ...updated];
      });
      // Do NOT reset currentPage — preserve loaded pages on refresh
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sessions.board.loadError'));
      setLoading(false);
    }
  }, []);

  useSseAwarePolling({
    refresh: fetchSessions,
    sseConnected,
    eventTrigger: latestActivity,
    fallbackPollIntervalMs: FALLBACK_POLL_INTERVAL_MS,
    healthyPollIntervalMs: SSE_HEALTHY_POLL_INTERVAL_MS,
  });

  const loadMore = useCallback(async () => {
    const nextPage = currentPage + 1;
    // Issue #4012: Abort any previous in-flight loadMore
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;

    try {
      setLoadingMore(true);
      const result = await getSessions({ limit: PAGE_SIZE, page: nextPage });
      if (controller.signal.aborted) return;
      // Issue #4012: Dedup by session ID to prevent duplicates from race conditions
      setSessions((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const newSessions = result.sessions.filter((s) => !existingIds.has(s.id));
        return [...prev, ...newSessions];
      });
      setTotalCount(result.pagination.total);
      setCurrentPage(nextPage);
    } catch {
      // Silently fail — user can retry
    } finally {
      if (!controller.signal.aborted) {
        setLoadingMore(false);
      }
    }
  }, [currentPage]);

  const hasMore = sessions.length < totalCount;
  const remaining = totalCount - sessions.length;

  const columns = useMemo(() => {
    const grouped = new Map<string, SessionInfo[]>();
    for (const col of BOARD_COLUMNS) {
      grouped.set(col.id, []);
    }
    grouped.set('other', []);

    for (const session of sessions) {
      const groupId = getStatusGroup(session.status);
      if (!grouped.has(groupId)) grouped.set(groupId, []);
      grouped.get(groupId)!.push(session);
    }

    // Sort within each column: primary by most recent activity, secondary by createdAt
    // Issue #4010: Secondary sort key prevents jitter when sessions share lastActivity
    for (const [, colSessions] of grouped) {
      colSessions.sort((a, b) => {
        const activityDiff = b.lastActivity - a.lastActivity;
        if (activityDiff !== 0) return activityDiff;
        return a.id.localeCompare(b.id);
      });
    }

    return { grouped, hasOther: (grouped.get('other')?.length ?? 0) > 0 };
  }, [sessions]);

  const loadedSessions = sessions.length;
  const runningCount = sessions.filter(s => BOARD_COLUMNS[0].statuses.includes(s.status)).length;
  const waitingCount = sessions.filter(s => BOARD_COLUMNS[1].statuses.includes(s.status)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-busy="true" aria-label="Loading session board">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
        <span className="ml-2 text-sm text-[var(--color-text-muted)]">{t('sessions.board.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16" role="alert">
        <p className="text-sm text-[var(--color-danger)]">{t('sessions.board.loadError')}: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Board header with stats */}
      <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <Columns3 className="h-4 w-4" />
        <span>{t('sessions.board.totalSessions', { count: totalCount })}{hasMore ? ` ${t('sessions.board.loadedCount', { count: loadedSessions })}` : ''}</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
          {t('sessions.board.runningCount', { count: runningCount })}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
          {t('sessions.board.waitingCount', { count: waitingCount })}
        </span>
      </div>

      {/* Board */}
      <div
        className="flex flex-col sm:flex-row sm:gap-4 sm:overflow-x-auto pb-4"
        role="region"
        aria-label="Session board"
        tabIndex={0}
      >
        {BOARD_COLUMNS.map((col) => (
          <BoardColumnView
            key={col.id}
            column={col}
            sessions={columns.grouped.get(col.id) ?? []}
            t={t}
          />
        ))}

        {/* Other column (only if there are sessions in it) */}
        {columns.hasOther && (
          <div className="w-full sm:w-[280px] shrink-0 flex flex-col gap-2" role="region" aria-label="Other sessions">
            <div className="flex items-center gap-2 px-1">
              <div className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]/50" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                {t('sessions.board.colOther')}
              </h3>
              <span className="rounded-full bg-[var(--color-void-lighter)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                {columns.grouped.get('other')?.length ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto rounded-lg p-1" role="list">
              {(columns.grouped.get('other') ?? []).map((session) => (
                <div key={session.id} role="listitem">
                  <SessionCard session={session} t={t} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={t('sessions.board.loadMore', { count: remaining })}
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('sessions.board.loadingMore')}
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" />
                {t('sessions.board.loadMore', { count: remaining })}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
