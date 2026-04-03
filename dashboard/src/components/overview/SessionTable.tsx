/**
 * components/overview/SessionTable.tsx — Live session table with filtering, search, and bulk actions.
 */

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Play,
  Search,
  XCircle,
} from 'lucide-react';
import {
  approve,
  getAllSessionsHealth,
  getSessionStatusCounts,
  getSessions,
  interrupt,
  killSession,
} from '../../api/client';
import { useToastStore } from '../../store/useToastStore';
import { useStore } from '../../store/useStore';
import type { RowHealth, SessionInfo, SessionStatusCounts, SessionStatusFilter } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import StatusDot from './StatusDot';

const POLL_INTERVAL_MS = 5_000;
const PAGE_SIZE = 20;
const SEARCH_SCAN_LIMIT = 100;
const EMPTY_COUNTS: SessionStatusCounts = {
  all: 0,
  idle: 0,
  working: 0,
  compacting: 0,
  context_warning: 0,
  waiting_for_input: 0,
  permission_prompt: 0,
  plan_mode: 0,
  ask_question: 0,
  bash_approval: 0,
  settings: 0,
  error: 0,
  unknown: 0,
};
const STATUS_FILTERS: SessionStatusFilter[] = [
  'all',
  'idle',
  'working',
  'compacting',
  'context_warning',
  'waiting_for_input',
  'permission_prompt',
  'plan_mode',
  'ask_question',
  'bash_approval',
  'settings',
  'error',
  'unknown',
];

interface SessionRowProps {
  session: SessionInfo;
  isAlive: boolean;
  selected: boolean;
  currentAction: string | null;
  onToggleSelect: (id: string, checked: boolean) => void;
  onApprove: (e: MouseEvent, id: string) => void;
  onInterrupt: (e: MouseEvent, id: string) => void;
  onKill: (e: MouseEvent, id: string) => void;
}

interface SessionsPaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface SessionRowViewModel {
  session: SessionInfo;
  isAlive: boolean;
  selected: boolean;
  currentAction: string | null;
}

const needsApproval = (session: SessionInfo): boolean =>
  session.status === 'permission_prompt' || session.status === 'bash_approval';

const truncateDir = (dir: string, max = 40): string =>
  dir.length > max ? `…${dir.slice(dir.length - max + 1)}` : dir;

function formatStatusLabel(status: SessionStatusFilter): string {
  if (status === 'all') return 'All';

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function matchesSearch(session: SessionInfo, query: string): boolean {
  if (!query) return true;

  const haystack = `${session.windowName} ${session.id} ${session.workDir}`.toLowerCase();
  return haystack.includes(query);
}

function isDisplayedSessionEqual(a: SessionInfo, b: SessionInfo): boolean {
  return a.id === b.id
    && a.windowName === b.windowName
    && a.workDir === b.workDir
    && a.status === b.status
    && a.createdAt === b.createdAt
    && a.lastActivity === b.lastActivity
    && a.permissionMode === b.permissionMode;
}

function areSessionRowPropsEqual(prev: SessionRowProps, next: SessionRowProps): boolean {
  return isDisplayedSessionEqual(prev.session, next.session)
    && prev.isAlive === next.isAlive
    && prev.selected === next.selected
    && prev.currentAction === next.currentAction;
}

const SessionMobileCard = memo(function SessionMobileCard({
  session,
  isAlive,
  selected,
  currentAction,
  onToggleSelect,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <div className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 transition-colors active:bg-[#1a1a2e]/50">
      <div className="mb-2 flex items-start justify-between gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-3 text-sm text-gray-200">
          <input
            type="checkbox"
            aria-label={`Select session ${session.windowName || session.id}`}
            checked={selected}
            onChange={(e) => onToggleSelect(session.id, e.target.checked)}
            className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot status={session.status} />
              <Link
                to={`/sessions/${encodeURIComponent(session.id)}`}
                className="truncate font-medium text-gray-200 transition-colors hover:text-cyan"
              >
                {session.windowName || session.id}
              </Link>
              {!isAlive && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
            </div>
            <div className="mt-1 truncate font-mono text-xs text-gray-500">
              {truncateDir(session.workDir, 50)}
            </div>
          </div>
        </label>

        <div className="flex shrink-0 items-center gap-1.5">
          {needsApproval(session) && (
            <button
              onClick={(e) => onApprove(e, session.id)}
              disabled={currentAction === 'approve'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 p-2 text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 p-2 text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-red-900/30 p-2 text-red-400 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Kill"
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>Age: {formatTimeAgo(session.createdAt)}</span>
        <span>Active: {formatTimeAgo(session.lastActivity)}</span>
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-green-400">
            <CheckCircle2 className="h-3 w-3" /> {session.permissionMode}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-void-lighter px-2 py-0.5 text-gray-500">
            default
          </span>
        )}
      </div>
    </div>
  );
}, areSessionRowPropsEqual);

const SessionDesktopRow = memo(function SessionDesktopRow({
  session,
  isAlive,
  selected,
  currentAction,
  onToggleSelect,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <tr className="border-b border-void-lighter/50 transition-colors hover:border-l-2 hover:border-l-cyan">
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={`Select session ${session.windowName || session.id}`}
          checked={selected}
          onChange={(e) => onToggleSelect(session.id, e.target.checked)}
          className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
        />
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <StatusDot status={session.status} />
          {!isAlive && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        </div>
      </td>

      <td className="px-4 py-3">
        <Link
          to={`/sessions/${encodeURIComponent(session.id)}`}
          className="font-medium text-gray-200 transition-colors hover:text-cyan"
        >
          {session.windowName || session.id}
        </Link>
      </td>

      <td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-gray-400" title={session.workDir}>
        {truncateDir(session.workDir)}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-gray-400">
        {formatTimeAgo(session.createdAt)}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-gray-400">
        {formatTimeAgo(session.lastActivity)}
      </td>

      <td className="px-4 py-3">
        {session.permissionMode && session.permissionMode !== 'default' ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            {session.permissionMode}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-void-lighter px-2 py-0.5 text-xs text-gray-500">
            default
          </span>
        )}
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {needsApproval(session) && (
            <button
              onClick={(e) => onApprove(e, session.id)}
              disabled={currentAction === 'approve'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 text-xs font-medium text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-red-900/30 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Kill"
          >
            <XCircle className="h-3 w-3" />
          </button>
        </div>
      </td>
    </tr>
  );
}, areSessionRowPropsEqual);

export default function SessionTable() {
  const sessions = useStore((s) => s.sessions);
  const healthMap = useStore((s) => s.healthMap);
  const sseConnected = useStore((s) => s.sseConnected);
  const setSessionsAndHealth = useStore((s) => s.setSessionsAndHealth);
  const addToast = useToastStore((t) => t.addToast);

  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'interrupt' | 'kill' | null>(null);
  const [statusFilter, setStatusFilter] = useState<SessionStatusFilter>('all');
  const [statusCounts, setStatusCounts] = useState<SessionStatusCounts>(EMPTY_COUNTS);
  const [searchInput, setSearchInput] = useState('');
  const deferredSearch = useDeferredValue(searchInput.trim().toLowerCase());
  const [pagination, setPagination] = useState<SessionsPaginationState>({
    page: 1,
    limit: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  });
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [searchCapped, setSearchCapped] = useState(false);

  const fetchSessions = useCallback(async () => {
    setIsLoading(true);

    try {
      const isSearching = deferredSearch.length > 0;
      const listPromise = getSessions({
        page: isSearching ? 1 : page,
        limit: isSearching ? SEARCH_SCAN_LIMIT : PAGE_SIZE,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });

      const [list, counts] = await Promise.all([listPromise, getSessionStatusCounts()]);
      const filteredSessions = isSearching
        ? list.sessions.filter((session) => matchesSearch(session, deferredSearch))
        : list.sessions;

      let nextHealthMap: Record<string, RowHealth> = {};
      try {
        const healthResults = await getAllSessionsHealth();
        const liveIds = new Set(filteredSessions.map((session) => session.id));
        for (const [id, health] of Object.entries(healthResults)) {
          if (liveIds.has(id)) {
            nextHealthMap[id] = { alive: health.alive, loading: false };
          }
        }
      } catch {
        // Health fetch failed — show sessions without health indicators.
      }

      setSessionsAndHealth(filteredSessions, nextHealthMap);
      setStatusCounts(counts);
      setSearchCapped(isSearching && list.pagination.total > list.sessions.length);
      setPagination(
        isSearching
          ? {
              page: 1,
              limit: filteredSessions.length,
              total: filteredSessions.length,
              totalPages: filteredSessions.length > 0 ? 1 : 0,
            }
          : list.pagination,
      );
    } catch (e: unknown) {
      addToast('error', 'Failed to fetch sessions', e instanceof Error ? e.message : undefined);
    } finally {
      setIsLoading(false);
    }
  }, [addToast, deferredSearch, page, setSessionsAndHealth, statusFilter]);

  useEffect(() => {
    fetchSessions();

    if (sseConnected) {
      return;
    }

    const interval = setInterval(fetchSessions, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchSessions, sseConnected]);

  useEffect(() => {
    const visibleIds = new Set(sessions.map((session) => session.id));
    setSelectedIds((prev) => prev.filter((id) => visibleIds.has(id)));
  }, [sessions]);

  const withLoading = useCallback(async (id: string, action: string, fn: () => Promise<void>) => {
    setActionLoading((prev) => ({ ...prev, [id]: action }));
    try {
      await fn();
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: null }));
    }
  }, []);

  const handleApprove = useCallback(async (e: MouseEvent, id: string) => {
    e.preventDefault();
    await withLoading(id, 'approve', async () => {
      try {
        await approve(id);
        await fetchSessions();
      } catch (err: unknown) {
        addToast('error', 'Approve failed', err instanceof Error ? err.message : undefined);
      }
    });
  }, [addToast, fetchSessions, withLoading]);

  const handleInterrupt = useCallback(async (e: MouseEvent, id: string) => {
    e.preventDefault();
    await withLoading(id, 'interrupt', async () => {
      try {
        await interrupt(id);
        await fetchSessions();
      } catch (err: unknown) {
        addToast('error', 'Interrupt failed', err instanceof Error ? err.message : undefined);
      }
    });
  }, [addToast, fetchSessions, withLoading]);

  const handleKill = useCallback(async (e: MouseEvent, id: string) => {
    e.preventDefault();
    if (!confirm('Kill this session?')) {
      return;
    }

    await withLoading(id, 'kill', async () => {
      try {
        await killSession(id);
        await fetchSessions();
      } catch (err: unknown) {
        addToast('error', 'Failed to kill session', err instanceof Error ? err.message : undefined);
      }
    });
  }, [addToast, fetchSessions, withLoading]);

  const handleToggleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((candidate) => candidate !== id);
    });
  }, []);

  const handleToggleSelectAll = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(sessions.map((session) => session.id));
  }, [sessions]);

  const runBulkAction = useCallback(async (action: 'interrupt' | 'kill') => {
    if (selectedIds.length === 0) {
      return;
    }
    if (action === 'kill' && !confirm(`Kill ${selectedIds.length} selected session${selectedIds.length === 1 ? '' : 's'}?`)) {
      return;
    }

    setBulkAction(action);
    setActionLoading((prev) => {
      const next = { ...prev };
      for (const id of selectedIds) {
        next[id] = action;
      }
      return next;
    });

    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => (action === 'interrupt' ? interrupt(id) : killSession(id))),
      );
      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      if (successCount > 0) {
        addToast(
          'success',
          action === 'interrupt' ? 'Bulk interrupt complete' : 'Bulk kill complete',
          `${successCount} session${successCount === 1 ? '' : 's'} updated.`,
        );
      }
      if (failureCount > 0) {
        addToast(
          'warning',
          `Some sessions failed to ${action}`,
          `${failureCount} session${failureCount === 1 ? '' : 's'} could not be updated.`,
        );
      }

      setSelectedIds([]);
      await fetchSessions();
    } finally {
      setBulkAction(null);
      setActionLoading((prev) => {
        const next = { ...prev };
        for (const id of selectedIds) {
          next[id] = null;
        }
        return next;
      });
    }
  }, [addToast, fetchSessions, selectedIds]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const rowViewModels = useMemo<SessionRowViewModel[]>(() => {
    return sessions.map((session) => {
      const health = healthMap[session.id];
      return {
        session,
        isAlive: health ? health.alive : true,
        selected: selectedIdSet.has(session.id),
        currentAction: actionLoading[session.id] ?? null,
      };
    });
  }, [actionLoading, healthMap, selectedIdSet, sessions]);

  const allVisibleSelected = sessions.length > 0 && sessions.every((session) => selectedIdSet.has(session.id));
  const hasActiveFilters = statusFilter !== 'all' || deferredSearch.length > 0;

  if (isLoading && sessions.length === 0) {
    return (
      <div className="rounded-lg border border-void-lighter bg-[#111118] p-12 text-center">
        <p className="text-gray-500">Loading sessions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-void-lighter bg-[#111118] p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex-1 space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-void-lighter bg-void px-3 py-2 text-sm text-gray-300 focus-within:border-cyan">
                <Search className="h-4 w-4 text-gray-500" />
                <input
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by session name or work directory"
                  className="w-full bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
                  aria-label="Search sessions"
                />
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-400">
                <span>Status</span>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as SessionStatusFilter);
                    setPage(1);
                  }}
                  aria-label="Filter by status"
                  className="rounded-md border border-void-lighter bg-void px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan"
                >
                  {STATUS_FILTERS.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)} ({statusCounts[status] ?? 0})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.filter((status) => status === 'all' || (statusCounts[status] ?? 0) > 0).map((status) => {
                const isActive = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setStatusFilter(status);
                      setPage(1);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${isActive
                      ? 'border-cyan bg-cyan/10 text-cyan'
                      : 'border-void-lighter bg-void text-gray-400 hover:border-cyan/40 hover:text-gray-200'}`}
                  >
                    {formatStatusLabel(status)} <span className="text-gray-500">{statusCounts[status] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-right text-xs text-gray-500">
            <div>
              Showing <span className="text-gray-300">{sessions.length}</span>
              {deferredSearch.length > 0
                ? ` matching session${sessions.length === 1 ? '' : 's'}`
                : ` of ${pagination.total} session${pagination.total === 1 ? '' : 's'}`}
            </div>
            {searchCapped && (
              <div className="mt-1 text-amber-400">
                Search scans the first {SEARCH_SCAN_LIMIT} sessions in the selected status.
              </div>
            )}
          </div>
        </div>

        {selectedIds.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-cyan/20 bg-cyan/5 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-gray-300">
              {selectedIds.length} session{selectedIds.length === 1 ? '' : 's'} selected
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => runBulkAction('interrupt')}
                disabled={bulkAction !== null}
                className="rounded-md bg-yellow-900/30 px-3 py-2 text-sm font-medium text-yellow-300 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
              >
                Interrupt Selected
              </button>
              <button
                type="button"
                onClick={() => runBulkAction('kill')}
                disabled={bulkAction !== null}
                className="rounded-md bg-red-900/30 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
              >
                Kill Selected
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                disabled={bulkAction !== null}
                className="rounded-md border border-void-lighter px-3 py-2 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-void-lighter bg-[#111118] p-12 text-center">
          <p className="text-gray-400">
            {hasActiveFilters ? 'No sessions match the current filter.' : 'No active sessions'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            <div className="flex items-center justify-between rounded-md border border-void-lighter bg-[#111118] px-4 py-3 text-sm text-gray-400">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Select all visible sessions"
                  checked={allVisibleSelected}
                  onChange={(e) => handleToggleSelectAll(e.target.checked)}
                  className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
                />
                Select visible
              </label>
              <span>{sessions.length} visible</span>
            </div>

            {rowViewModels.map((row) => {
              return (
                <SessionMobileCard
                  key={row.session.id}
                  session={row.session}
                  isAlive={row.isAlive}
                  selected={row.selected}
                  currentAction={row.currentAction}
                  onToggleSelect={handleToggleSelect}
                  onApprove={handleApprove}
                  onInterrupt={handleInterrupt}
                  onKill={handleKill}
                />
              );
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-void-lighter bg-[#111118] md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-void-lighter text-[#666]">
                  <th className="px-4 py-3 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all visible sessions"
                      checked={allVisibleSelected}
                      onChange={(e) => handleToggleSelectAll(e.target.checked)}
                      className="h-4 w-4 rounded border border-void-lighter bg-void text-cyan focus:ring-1 focus:ring-cyan"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">WorkDir</th>
                  <th className="px-4 py-3 font-medium">Age</th>
                  <th className="px-4 py-3 font-medium">Last Activity</th>
                  <th className="px-4 py-3 font-medium">Permission</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rowViewModels.map((row) => {
                  return (
                    <SessionDesktopRow
                      key={row.session.id}
                      session={row.session}
                      isAlive={row.isAlive}
                      selected={row.selected}
                      currentAction={row.currentAction}
                      onToggleSelect={handleToggleSelect}
                      onApprove={handleApprove}
                      onInterrupt={handleInterrupt}
                      onKill={handleKill}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {deferredSearch.length === 0 && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between rounded-lg border border-void-lighter bg-[#111118] px-4 py-3 text-sm text-gray-400">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={pagination.page <= 1}
                  className="flex items-center gap-1 rounded-md border border-void-lighter px-3 py-2 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="flex items-center gap-1 rounded-md border border-void-lighter px-3 py-2 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
