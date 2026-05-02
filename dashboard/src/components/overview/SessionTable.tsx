/**
 * components/overview/SessionTable.tsx — Live session table with filtering, search, and bulk actions.
 */

import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Play,
  Search,
  XCircle,
  Sparkles,
} from 'lucide-react';
import {
  approve,
  getAllSessionsHealth,
  getSessionStatusCounts,
  getSessions,
  interrupt,
  killSession,
} from '../../api/client';
import { useSseAwarePolling } from '../../hooks/useSseAwarePolling';
import { useToastStore } from '../../store/useToastStore';
import { useStore } from '../../store/useStore';
import type { RowHealth, SessionInfo, SessionStatusCounts, SessionStatusFilter } from '../../types';
import { formatTimeAgo } from '../../utils/format';
import { ConfirmDialog } from '../ConfirmDialog';
import RealtimeBadge from './RealtimeBadge';
import { SessionPreviewCard } from '../session/SessionPreviewCard';
import StatusDot from './StatusDot';
import { VirtualizedSessionList } from './VirtualizedSessionList';
import type { VirtualizedRowData } from './VirtualizedSessionList';

const FALLBACK_POLL_INTERVAL_MS = 5_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;
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
  rate_limit: 0,
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
  'rate_limit',
  'unknown',
];

const DEMO_SESSIONS_KEY = 'aegis:demo-sessions';
const DEMO_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Mock demo sessions
const DEMO_SESSIONS: SessionInfo[] = [
  {
    id: 'demo-backend-api',
    windowId: 'demo-win-1',
    windowName: 'backend-api-dev',
    workDir: '/tmp/demo/backend',
    status: 'working',
    createdAt: Date.now() - 3600000,
    lastActivity: Date.now() - 300000,
    byteOffset: 0,
    monitorOffset: 0,
    stallThresholdMs: 60000,
    permissionMode: 'default',
  },
  {
    id: 'demo-frontend-ui',
    windowId: 'demo-win-2',
    windowName: 'frontend-ui-build',
    workDir: '/tmp/demo/frontend',
    status: 'idle',
    createdAt: Date.now() - 7200000,
    lastActivity: Date.now() - 600000,
    byteOffset: 0,
    monitorOffset: 0,
    stallThresholdMs: 60000,
    permissionMode: 'default',
  },
  {
    id: 'demo-security-scan',
    windowId: 'demo-win-3',
    windowName: 'security-audit',
    workDir: '/tmp/demo/security',
    status: 'permission_prompt',
    createdAt: Date.now() - 1800000,
    lastActivity: Date.now() - 120000,
    byteOffset: 0,
    monitorOffset: 0,
    stallThresholdMs: 60000,
    permissionMode: 'default',
  },
];

function getDemoSessions(): SessionInfo[] {
  try {
    const stored = localStorage.getItem(DEMO_SESSIONS_KEY);
    if (!stored) return [];
    
    const { timestamp } = JSON.parse(stored);
    const age = Date.now() - timestamp;
    
    if (age > DEMO_EXPIRY_MS) {
      localStorage.removeItem(DEMO_SESSIONS_KEY);
      return [];
    }
    
    return DEMO_SESSIONS;
  } catch {
    return [];
  }
}

function setDemoSessions(): void {
  try {
    localStorage.setItem(DEMO_SESSIONS_KEY, JSON.stringify({ timestamp: Date.now() }));
    console.info('[aegis] Demo sessions created (auto-expire in 24h)');
  } catch {
    // Ignore storage errors
  }
}

interface SessionRowProps {
  session: SessionInfo;
  isAlive: boolean;
  health: import('../../types').SessionHealthState | null;
  selected: boolean;
  currentAction: string | null;
  estimatedCostUsd?: number;
  isFocused: boolean;
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
  health: import('../../types').SessionHealthState | null;
  selected: boolean;
  currentAction: string | null;
  estimatedCostUsd?: number;
  isFocused: boolean;
}

const needsApproval = (session: SessionInfo): boolean =>
  session.status === 'permission_prompt' || session.status === 'bash_approval';

const truncateDir = (dir: string, max = 40): string => {
  const normalized = dir.replace(/\\/g, '/');
  const abbreviated = normalized
    .replace(/^\/home\/[^/]+\//, '~/')
    .replace(/^[A-Z]:\/Users\/[^/]+\//i, (m) => `${m[0]}:/…/`);
  if (abbreviated.length <= max) return abbreviated;
  const segments = abbreviated.split('/');
  let result = segments[segments.length - 1] || abbreviated;
  for (let i = segments.length - 2; i >= 0; i--) {
    const candidate = segments.slice(i).join('/');
    if (candidate.length > max) break;
    result = candidate;
  }
  if (result.length > max) result = result.slice(-(max - 1));
  return result.length < abbreviated.length ? `…${result}` : `…${abbreviated.slice(-(max - 1))}`;
};

const extractDirKey = (workDir: string): string => {
  const normalized = workDir.replace(/\\/g, '/');
  const segments = normalized.replace(/[\\/]+$/, '').split('/');
  return segments[segments.length - 1] || workDir;
};

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
    && prev.health === next.health
    && prev.selected === next.selected
    && prev.currentAction === next.currentAction;
}

const SessionMobileCard = memo(function SessionMobileCard({
  session,
  isAlive,
  health,
  selected,
  currentAction,
  estimatedCostUsd,
  isFocused,
  onToggleSelect,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <div className={`card-glass p-5 animate-bento-reveal transition-all ${isFocused ? 'border-cyan-500 ring-1 ring-cyan-500/30' : ''}`}>
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
              <StatusDot status={session.status} health={health} />
              <Link
                to={`/sessions/${encodeURIComponent(session.id)}`}
                className="inline-flex min-h-[44px] items-center truncate font-medium text-gray-200 transition-colors hover:text-cyan"
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
              aria-label={`Approve session ${session.windowName || session.id}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 p-2 text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            aria-label={`Interrupt session ${session.windowName || session.id}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 p-2 text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            aria-label={`Kill session ${session.windowName || session.id}`}
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
        {estimatedCostUsd != null && estimatedCostUsd > 0 && (
          <span className="font-mono tabular-nums text-[var(--color-accent-cyan)]">
            {`$${estimatedCostUsd < 0.01 ? estimatedCostUsd.toFixed(4) : estimatedCostUsd < 1 ? estimatedCostUsd.toFixed(3) : estimatedCostUsd.toFixed(2)}`}
          </span>
        )}
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

export const SessionDesktopRow = memo(function SessionDesktopRow({
  session,
  isAlive,
  health,
  selected,
  currentAction,
  estimatedCostUsd,
  isFocused,
  onToggleSelect,
  onApprove,
  onInterrupt,
  onKill,
}: SessionRowProps) {
  return (
    <tr className={`border-b border-white/5 transition-all duration-300 ease-out animate-bento-reveal ${isFocused ? 'bg-cyan-950/30 ring-1 ring-inset ring-[var(--color-accent-cyan)]/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]' : 'hover:bg-white/5 hover:scale-[1.002] cursor-pointer'}`}>
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
          <StatusDot status={session.status} health={health} />
          {!isAlive && <XCircle className="h-3.5 w-3.5 text-red-400" />}
        </div>
      </td>

      <td className="hidden md:table-cell whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-400">
        {session.ownerKeyId ? `${session.ownerKeyId.slice(0, 8)}${session.ownerKeyId.length > 8 ? '…' : ''}` : '\u2014'}
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

      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums text-[var(--color-accent-cyan)]">
        {estimatedCostUsd != null && estimatedCostUsd > 0
          ? `$${estimatedCostUsd < 0.01 ? estimatedCostUsd.toFixed(4) : estimatedCostUsd < 1 ? estimatedCostUsd.toFixed(3) : estimatedCostUsd.toFixed(2)}`
          : '\u2014'}
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          {needsApproval(session) && (
            <button
              onClick={(e) => onApprove(e, session.id)}
              disabled={currentAction === 'approve'}
              aria-label={`Approve session ${session.windowName || session.id}`}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-green-900/30 text-xs font-medium text-green-400 transition-colors hover:bg-green-900/50 disabled:pointer-events-none disabled:opacity-40"
              title="Approve"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={(e) => onInterrupt(e, session.id)}
            disabled={currentAction === 'interrupt' || currentAction === 'kill'}
            aria-label={`Interrupt session ${session.windowName || session.id}`}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-yellow-900/30 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
            title="Interrupt"
          >
            <Ban className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => onKill(e, session.id)}
            disabled={currentAction === 'kill'}
            aria-label={`Kill session ${session.windowName || session.id}`}
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

interface SessionTableProps {
  maxRows?: number;
}

export default function SessionTable({ maxRows }: SessionTableProps = {}) {
  const sessions = useStore((s) => s.sessions);
  const healthMap = useStore((s) => s.healthMap);
  const sseConnected = useStore((s) => s.sseConnected);
  const latestActivity = useStore((s) => s.activities[0] ?? null);
  const sseError = useStore((s) => s.sseError);
  const setSessionsAndHealth = useStore((s) => s.setSessionsAndHealth);
  const addToast = useToastStore((t) => t.addToast);
  const navigate = useNavigate();
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [groupByDir, setGroupByDir] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Keyboard shortcuts: arrows navigate, Enter opens, Delete kills
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isInput) return;

      const list = sessions;
      if (list.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev < list.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case 'Enter':
          if (e.ctrlKey || e.metaKey) return;
          if (focusedIndex >= 0 && focusedIndex < list.length) {
            e.preventDefault();
            navigate(`/sessions/${encodeURIComponent(list[focusedIndex].id)}`);
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (focusedIndex >= 0 && focusedIndex < list.length) {
            const id = list[focusedIndex].id;
            if (window.confirm(`Kill session ${id}?`)) {
              killSession(id)
                .then(() => addToast('success', 'Session killed', id))
                .catch(() => addToast('error', 'Kill failed', id));
            }
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [sessions, focusedIndex, navigate, addToast]);

  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<'interrupt' | 'kill' | null>(null);
  const [confirmKill, setConfirmKill] = useState<{ type: 'single'; id: string } | { type: 'bulk'; count: number } | null>(null);
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const hoveredRowRef = useRef<HTMLElement | null>(null);
  const hoveredSession = sessions.find((s) => s.id === hoveredSessionId) ?? null;

  // Demo sessions state
  const demoSessions = useMemo(() => getDemoSessions(), [sessions.length]);
  const allSessions = useMemo(() => [...sessions, ...demoSessions], [sessions, demoSessions]);

  function handleSurpriseMe() {
    setDemoSessions();
    // Trigger re-render by updating a dummy state
    setPage((p) => p);
    addToast('success', 'Demo sessions created', 'Three example sessions added (auto-expire in 24h)');
  }

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
      setLoadError(null);
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
      setLoadError(
        e instanceof Error && e.message
          ? `Unable to load sessions: ${e.message}`
          : 'Unable to load sessions.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [deferredSearch, page, setSessionsAndHealth, statusFilter]);

  useSseAwarePolling({
    refresh: fetchSessions,
    sseConnected,
    eventTrigger: latestActivity,
    fallbackPollIntervalMs: FALLBACK_POLL_INTERVAL_MS,
    healthyPollIntervalMs: SSE_HEALTHY_POLL_INTERVAL_MS,
  });

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

  const handleKill = useCallback((e: MouseEvent, id: string) => {
    e.preventDefault();
    setConfirmKill({ type: 'single', id });
  }, []);

  const executeKill = useCallback(async (id: string) => {
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

  const executeBulkAction = useCallback(async (action: 'interrupt' | 'kill') => {

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

  const runBulkAction = useCallback((action: 'interrupt' | 'kill') => {
    if (selectedIds.length === 0) {
      return;
    }
    if (action === 'kill') {
      setConfirmKill({ type: 'bulk', count: selectedIds.length });
      return;
    }
    void executeBulkAction(action);
  }, [selectedIds, executeBulkAction]);

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const handleConfirmKill = useCallback(() => {
    if (!confirmKill) return;
    if (confirmKill.type === 'single') {
      void executeKill(confirmKill.id);
    } else {
      void executeBulkAction('kill');
    }
    setConfirmKill(null);
  }, [confirmKill, executeKill, executeBulkAction]);

  const confirmKillMessage = confirmKill
    ? confirmKill.type === 'single'
      ? 'Kill this session? This action cannot be undone.'
      : `Kill ${confirmKill.count} selected session${confirmKill.count === 1 ? '' : 's'}? This action cannot be undone.`
    : '';

  const rowViewModels = useMemo<SessionRowViewModel[]>(() => {
    const baseSessions = maxRows ? allSessions.slice(0, maxRows) : allSessions;
    return baseSessions.map((session, idx) => {
      const health = healthMap[session.id];
      const isDemo = session.id.startsWith('demo-');
      return {
        session,
        isAlive: health ? health.alive : !isDemo, // Demo sessions show as alive
        health: health?.health ?? null,
        selected: selectedIdSet.has(session.id),
        currentAction: actionLoading[session.id] ?? null,
        isFocused: idx === focusedIndex,
      };
    });
  }, [actionLoading, healthMap, selectedIdSet, allSessions, focusedIndex, maxRows]);

  const groupedRowModels = useMemo(() => {
    if (!groupByDir) return null;
    const groups = new Map<string, SessionRowViewModel[]>();
    for (const vm of rowViewModels) {
      const key = extractDirKey(vm.session.workDir);
      const list = groups.get(key) ?? [];
      list.push(vm);
      groups.set(key, list);
    }
    return groups;
  }, [rowViewModels, groupByDir]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const allVisibleSelected = allSessions.length > 0 && allSessions.every((session) => selectedIdSet.has(session.id));
  const hasActiveFilters = statusFilter !== 'all' || deferredSearch.length > 0;

  if (isLoading && sessions.length === 0 && demoSessions.length === 0 && !loadError) {
    return (
      <div className="card-glass p-16 text-center animate-bento-reveal flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-16 h-16 rounded-full border-2 border-[var(--color-accent-cyan)]/20 border-t-[var(--color-accent-cyan)] animate-spin mb-6 shadow-[0_0_15px_rgba(6,182,212,0.5)]" />
        <h3 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white drop-shadow-md">Waking Agents</h3>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Establishing neural link with active sessions...</p>
      </div>
    );
  }

  if (loadError && sessions.length === 0) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-amber-200">{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setIsLoading(true);
              setLoadError(null);
              void fetchSessions();
            }}
            aria-label="Retry loading sessions"
            className="rounded-md border border-amber-400/40 px-3 py-2 text-sm text-amber-700 dark:text-amber-100 transition-colors hover:border-amber-300 hover:text-amber-900 dark:hover:text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const showStatusRow = Boolean(loadError) || Boolean(!sseConnected && sseError);

  return (
    <div className="space-y-6 relative">
      <div className="card-glass w-full animate-bento-reveal shadow-[0_8px_30px_rgb(0,0,0,0.4)]">
        <div className="flex flex-col gap-4 border-b border-white/5 bg-white/5 p-4 backdrop-blur-md xl:flex-row xl:items-start xl:justify-between">
          <div className="flex-1 space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-[var(--color-void)] px-3 py-3 min-h-[44px] text-sm text-gray-300 focus-within:border-[var(--color-accent-cyan)] focus-within:ring-1 focus-within:ring-[var(--color-accent-cyan)]/30 transition-all shadow-inner">
                <Search className="h-4 w-4 text-gray-500" />
                <input
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by session name or work directory"
                   className="min-h-[44px] w-full bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
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
                  className="min-h-[44px] rounded-md border border-void-lighter bg-void px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan"
                >
                  {STATUS_FILTERS.map((status) => (
                    <option key={status} value={status}>
                      {formatStatusLabel(status)} ({statusCounts[status] ?? 0})
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => setGroupByDir((prev) => !prev)}
                aria-label={groupByDir ? 'Show ungrouped session list' : 'Group sessions by directory'}
                aria-pressed={groupByDir}
                className={`flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${groupByDir
                  ? 'border-cyan bg-cyan/10 text-cyan'
                  : 'border-void-lighter bg-void text-gray-400 hover:border-cyan/40 hover:text-gray-200'}`}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {groupByDir ? 'Ungroup' : 'By Directory'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter sessions by status">
              {STATUS_FILTERS.filter((status) => status === 'all' || (statusCounts[status] ?? 0) > 0).map((status) => {
                const isActive = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={isActive}
                    aria-label={`${formatStatusLabel(status)}, ${statusCounts[status] ?? 0} sessions`}
                    onClick={() => {
                      setStatusFilter(status);
                      setPage(1);
                    }}
                    className={`min-h-[44px] rounded-full border px-3 py-1.5 text-xs transition-colors ${isActive
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

        {showStatusRow && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-void-lighter bg-void px-3 py-2"
          >
            <div className="text-xs text-gray-400">{loadError ?? 'Session data is using polling fallback while real-time updates recover.'}</div>
            {!sseConnected && sseError && <RealtimeBadge mode="polling" message={sseError} />}
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-cyan/20 bg-cyan/5 p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-gray-300">
              {selectedIds.length} session{selectedIds.length === 1 ? '' : 's'} selected
            </div>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Bulk actions">
              <button
                type="button"
                onClick={() => runBulkAction('interrupt')}
                disabled={bulkAction !== null}
                aria-label={`Interrupt ${selectedIds.length} selected session${selectedIds.length === 1 ? '' : 's'}`}
                className="min-h-[44px] rounded-md bg-yellow-900/30 px-3 py-2 text-sm font-medium text-yellow-300 transition-colors hover:bg-yellow-900/50 disabled:pointer-events-none disabled:opacity-40"
              >
                Interrupt Selected
              </button>
              <button
                type="button"
                onClick={() => runBulkAction('kill')}
                disabled={bulkAction !== null}
                aria-label={`Kill ${selectedIds.length} selected session${selectedIds.length === 1 ? '' : 's'}`}
                className="min-h-[44px] rounded-md bg-red-900/30 px-3 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/50 disabled:pointer-events-none disabled:opacity-40"
              >
                Kill Selected
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                disabled={bulkAction !== null}
                aria-label="Clear selection"
                className="min-h-[44px] rounded-md border border-void-lighter px-3 py-2 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {isLoading && sessions.length === 0 ? (
        /* Bento-style Loading Skeleton */
        <div className="card-glass relative overflow-hidden p-12 flex flex-col items-center justify-center min-h-[420px] border border-white/5 animate-pulse">
           <div className="w-16 h-16 rounded-2xl bg-white/5 mb-6" />
           <div className="w-48 h-4 bg-white/10 rounded-full mb-3" />
           <div className="w-64 h-3 bg-white/5 rounded-full" />
        </div>
      ) : sessions.length === 0 && demoSessions.length === 0 ? (
        <div className="card-glass relative overflow-hidden p-12 text-center flex flex-col items-center justify-center min-h-[420px] border border-white/5 animate-bento-reveal shadow-[inset_0_0_60px_rgba(0,0,0,0.5)]">
          {/* Ambient glow */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.06),transparent_60%)] pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

          {/* Icon diamond */}
          <div className="relative z-10 w-20 h-20 mb-6 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-[0_0_30px_rgba(6,182,212,0.12)] transform rotate-45">
            <span className="text-2xl transform -rotate-45 block text-slate-400">⌘</span>
          </div>

          <h3 className="relative z-10 text-xl font-bold tracking-tight text-gray-900 dark:text-white drop-shadow-md mb-2">
            {hasActiveFilters ? 'No Matching Directives' : 'Agent Standby Mode'}
          </h3>
          <p className="relative z-10 max-w-sm text-sm text-gray-500 dark:text-slate-400 leading-relaxed mb-6">
            {hasActiveFilters
              ? 'No sessions match your current filter. Try broadening the search scope.'
              : 'The orchestrator is online. No agents are currently deployed.'}
          </p>

          {!hasActiveFilters && (
            <div className="relative z-10 flex flex-col items-center gap-3">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('aegis:create-session'))}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.35)] transition-all hover:bg-cyan-400 hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] active:scale-95"
              >
                <span className="text-base leading-none">⊕</span>
                Deploy New Agent
              </button>
              <div className="flex items-center gap-2 text-slate-600">
                <div className="h-px w-12 bg-white/10" />
                <span className="text-[10px] uppercase tracking-widest">or</span>
                <div className="h-px w-12 bg-white/10" />
              </div>
              <button
                type="button"
                onClick={handleSurpriseMe}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-4 py-2 text-sm font-medium text-cyan-300 transition-all hover:bg-cyan-500/10 active:scale-95"
              >
                <Sparkles className="h-4 w-4" />
                Surprise me
              </button>
              <code className="mt-2 px-4 py-2 font-mono text-xs text-cyan-300/70 bg-cyan-950/20 border border-cyan-900/40 rounded-lg">
                $ ag create "brief"
              </code>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:hidden">
            <div className="flex items-center justify-between rounded-md border border-void-lighter bg-[var(--color-surface)] px-4 py-3 text-sm text-gray-400">
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
              <span>{allSessions.length} visible</span>
            </div>

            {groupedRowModels
              ? Array.from(groupedRowModels.entries()).map(([dirKey, groupRows]) => {
                  const isCollapsed = collapsedGroups.has(dirKey);
                  return (
                    <Fragment key={`group-${dirKey}`}>
                      <button
                        type="button"
                        className="flex min-h-[44px] items-center gap-2 w-full rounded-md border border-void-lighter bg-[var(--color-void)] px-4 py-2 text-sm text-slate-400 transition-colors hover:border-cyan/40 hover:text-slate-300"
                        onClick={() => toggleGroup(dirKey)}
                        aria-expanded={!isCollapsed}
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span className="font-medium font-mono text-xs">{dirKey}</span>
                        <span className="text-[10px] text-slate-500 tabular-nums">{groupRows.length}</span>
                      </button>
                      {!isCollapsed && groupRows.map((row) => (
                        <SessionMobileCard
                          key={row.session.id}
                          session={row.session}
                          isAlive={row.isAlive}
                          health={row.health}
                          selected={row.selected}
                          currentAction={row.currentAction}
                          estimatedCostUsd={row.estimatedCostUsd}
                          isFocused={row.isFocused}
                          onToggleSelect={handleToggleSelect}
                          onApprove={handleApprove}
                          onInterrupt={handleInterrupt}
                          onKill={handleKill}
                        />
                      ))}
                    </Fragment>
                  );
                })
              : rowViewModels.map((row) => (
                  <SessionMobileCard
                    key={row.session.id}
                    session={row.session}
                    isAlive={row.isAlive}
                    health={row.health}
                    selected={row.selected}
                    currentAction={row.currentAction}
                    estimatedCostUsd={row.estimatedCostUsd}
                    isFocused={row.isFocused}
                    onToggleSelect={handleToggleSelect}
                    onApprove={handleApprove}
                    onInterrupt={handleInterrupt}
                    onKill={handleKill}
                  />
                ))
            }
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-void-lighter bg-[var(--color-surface)] md:block" tabIndex={0} aria-label="Sessions table scroll region">
            <table className="w-full text-left text-sm" aria-label="Sessions table">
              <thead>
                <tr className="border-b border-void-lighter text-[var(--color-text-muted)]">
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
                  <th className="hidden md:table-cell px-4 py-3 font-medium">Created by</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">WorkDir</th>
                  <th className="px-4 py-3 font-medium">Age</th>
                  <th className="px-4 py-3 font-medium">Last Activity</th>
                  <th className="px-4 py-3 font-medium">Permission</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="sr-only">
                {/* Kept for accessibility: screen readers associate headers with the table */}
                <tr><td colSpan={10}>Virtualized session list rendered below via react-window</td></tr>
              </tbody>
            </table>
            <VirtualizedSessionList
              rowViewModels={rowViewModels as VirtualizedRowData[]}
              groupedRowModels={groupedRowModels as Map<string, VirtualizedRowData[]> | null}
              collapsedGroups={collapsedGroups}
              allVisibleSelected={allVisibleSelected}
              onToggleGroup={toggleGroup}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onApprove={handleApprove}
              onInterrupt={handleInterrupt}
              onKill={handleKill}
              showHeader={false}
            />
          </div>

          {deferredSearch.length === 0 && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between rounded-lg border border-void-lighter bg-[var(--color-surface)] px-4 py-3 text-sm text-gray-400">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={pagination.page <= 1}
                  aria-label="Go to previous page"
                  className="flex min-h-[44px] items-center gap-1 rounded-md border border-void-lighter px-3 py-2 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  aria-label="Go to next page"
                  className="flex min-h-[44px] items-center gap-1 rounded-md border border-void-lighter px-3 py-2 transition-colors hover:border-gray-500 hover:text-gray-200 disabled:pointer-events-none disabled:opacity-40"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmKill !== null}
        title="Kill Sessions"
        message={confirmKillMessage}
        confirmLabel="Kill"
        variant="danger"
        onConfirm={handleConfirmKill}
        onCancel={() => setConfirmKill(null)}
      />

      {hoveredSession && (
        <SessionPreviewCard
          session={hoveredSession}
          anchorRef={hoveredRowRef}
          onClose={() => setHoveredSessionId(null)}
        />
      )}
    </div>
  );
}
