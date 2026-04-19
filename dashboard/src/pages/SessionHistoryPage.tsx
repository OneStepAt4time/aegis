/**
 * pages/SessionHistoryPage.tsx — Session history view with filters and pagination.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
  SearchX,
  Download,
  ArrowUp,
  ArrowDown,
  Trash2,
  Copy,
  Share2,
  X,
} from 'lucide-react';
import {
  fetchSessionHistory,
  killSession,
  type FetchSessionHistoryParams,
  type SessionHistoryRecord,
} from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import EmptyState from '../components/shared/EmptyState';
import { generateSessionHistoryCSV, downloadCSV } from '../utils/csv-export';
import { Icon } from '../components/Icon';

type DateRange = '1h' | 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'active' },
  { value: 'killed', label: 'killed' },
  { value: 'unknown', label: 'unknown' },
] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '1h', label: 'Last hour' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

function formatTimestamp(ts?: number): string {
  if (ts === undefined) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function statusClass(status: SessionHistoryRecord['finalStatus']): string {
  if (status === 'active') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25';
  if (status === 'killed') return 'text-rose-300 bg-rose-500/10 border-rose-500/25';
  return 'text-gray-600 dark:text-zinc-300 bg-gray-200/60 dark:bg-zinc-700/40 border-gray-300 dark:border-zinc-700';
}

function sourceClass(source: SessionHistoryRecord['source']): string {
  if (source === 'audit+live') return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25';
  if (source === 'live') return 'text-sky-300 bg-sky-500/10 border-sky-500/25';
  return 'text-gray-600 dark:text-zinc-300 bg-gray-200/60 dark:bg-zinc-700/40 border-gray-300 dark:border-zinc-700';
}

/** Shorten a long ID to `abc12345…ef789` format; short IDs are returned as-is. */
function shortId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-gray-200 dark:border-zinc-800">
          <td className="px-4 py-3"><div className="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-14 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
        </tr>
      ))}
    </>
  );
}

export default function SessionHistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [records, setRecords] = useState<SessionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const addToast = useToastStore((t) => t.addToast);

  const [page, setPage] = useState(() => Number(searchParams.get('page') ?? 1));
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const [filterOwnerInput, setFilterOwnerInput] = useState(searchParams.get('owner') ?? '');
  const [filterStatusInput, setFilterStatusInput] = useState(searchParams.get('status') ?? '');
  const [filterOwner, setFilterOwner] = useState(searchParams.get('owner') ?? '');
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') ?? '');
  const [filterSearch, setFilterSearch] = useState(searchParams.get('q') ?? '');
  const [filterDateRange, setFilterDateRange] = useState<DateRange>(
    (searchParams.get('since') as DateRange | null) ?? '7d'
  );
  const [filterSort, setFilterSort] = useState<'newest' | 'oldest' | 'status'>('newest');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const handleBulkDelete = useCallback(async () => {
    setDeleting(true);
    const ids = [...selectedIds];
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await killSession(id);
        success++;
      } catch {
        failed++;
      }
    }
    setDeleting(false);
    setSelectedIds(new Set());
    setConfirmDeleteOpen(false);
    if (failed === 0) {
      addToast('success', 'Sessions killed', `${success} session${success !== 1 ? 's' : ''} removed`);
    } else {
      addToast('error', 'Partial kill', `${success} killed, ${failed} failed`);
    }
    void fetchData();
  }, [selectedIds, addToast]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === records.length ? new Set() : new Set(records.map((r) => r.id))
    );
  }, [records]);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setEndpointMissing(false);

    const params: FetchSessionHistoryParams = {
      page,
      limit: pageSize,
    };
    if (filterOwner) params.ownerKeyId = filterOwner;
    if (filterStatus) params.status = filterStatus as FetchSessionHistoryParams['status'];
    if (filterSearch) params.nameSearch = filterSearch;
    const now = Date.now();
    if (filterDateRange === '1h') {
      params.createdAfter = Math.floor((now - 60 * 60 * 1000) / 1000);
    } else if (filterDateRange === 'today') {
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      params.createdAfter = Math.floor(startOfDay.getTime() / 1000);
    } else if (filterDateRange === 'yesterday') {
      const startOfYesterday = new Date(); startOfYesterday.setHours(0, 0, 0, 0); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      const endOfYesterday = new Date(startOfYesterday); endOfYesterday.setHours(23, 59, 59, 999);
      params.createdAfter = Math.floor(startOfYesterday.getTime() / 1000);
      params.createdBefore = Math.floor(endOfYesterday.getTime() / 1000);
    } else if (filterDateRange === '7d') {
      params.createdAfter = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000);
    } else if (filterDateRange === '30d') {
      params.createdAfter = Math.floor((now - 30 * 24 * 60 * 60 * 1000) / 1000);
    } else if (filterDateRange === 'month') {
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      params.createdAfter = Math.floor(startOfMonth.getTime() / 1000);
    } else if (filterDateRange === 'custom' && customDateFrom) {
      params.createdAfter = Math.floor(new Date(customDateFrom).getTime() / 1000);
      if (customDateTo) params.createdBefore = Math.floor(new Date(customDateTo).getTime() / 1000) + 86400;
    }
    if (filterSort === 'newest') { params.sortBy = 'createdAt'; params.sortOrder = 'desc'; }
    else if (filterSort === 'oldest') { params.sortBy = 'createdAt'; params.sortOrder = 'asc'; }
    else if (filterSort === 'status') { params.sortBy = 'status'; params.sortOrder = 'asc'; }

    try {
      const data = await fetchSessionHistory({ ...params, signal });
      setRecords(data.records);
      setTotal(data.pagination.total);
    } catch (e: unknown) {
      const err = e as Error & { statusCode?: number };
      if ((err as DOMException).name === 'AbortError') return;
      if (err.statusCode === 404) {
        setEndpointMissing(true);
        setRecords([]);
        setTotal(0);
      } else {
        setError(err.message ?? 'Failed to load session history');
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterOwner, filterStatus, filterSearch, filterDateRange, customDateFrom, customDateTo, filterSort]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchData(ac.signal);
    return () => ac.abort();
  }, [fetchData]);

  const applyFilters = () => {
    setPage(1);
    setFilterOwner(filterOwnerInput.trim());
    setFilterStatus(filterStatusInput);
    const next = new URLSearchParams();
    if (filterOwnerInput.trim()) next.set('owner', filterOwnerInput.trim());
    if (filterStatusInput) next.set('status', filterStatusInput);
    if (filterSearch) next.set('q', filterSearch);
    if (filterDateRange !== '7d') next.set('since', filterDateRange);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    setPage(1);
    setFilterOwnerInput('');
    setFilterStatusInput('');
    setFilterOwner('');
    setFilterStatus('');
    setFilterSearch('');
    setFilterDateRange('7d');
    setCustomDateFrom('');
    setCustomDateTo('');
    setFilterSort('newest');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const handleExport = () => {
    const toExport = selectedIds.size > 0
      ? sortedRecords.filter((r) => selectedIds.has(r.id))
      : records;
    const csv = generateSessionHistoryCSV(toExport);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `aegis-sessions-${date}.csv`);
  };

  const handleShareLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(
      () => addToast('success', 'Link copied', 'Shareable URL copied to clipboard'),
      () => addToast('error', 'Copy failed', 'Could not copy URL to clipboard'),
    );
  };

  const copySessionId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id).then(
      () => addToast('success', 'Copied', 'Session ID copied to clipboard'),
      () => {},
    );
  };

  const handleRowClick = (id: string, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-no-nav]')) return;
    navigate(`/sessions/${id}`);
  };

  const handleRowKeyDown = (e: React.KeyboardEvent, id: string, index: number) => {
    if (e.key === 'Enter') {
      navigate(`/sessions/${id}`);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowRefs.current[index + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rowRefs.current[index - 1]?.focus();
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortableHeader = (label: string, column: string) => {
    const isActive = sortColumn === column;
    const toggle = () => {
      if (isActive) {
        if (sortDirection === 'asc') { setSortColumn(null); }
        else { setSortDirection('asc'); }
      } else {
        setSortColumn(column);
        setSortDirection('desc');
      }
    };
    return (
      <th
        className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500 cursor-pointer select-none hover:text-zinc-300 transition-colors"
        onClick={toggle}
        aria-sort={isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {isActive && (
            sortDirection === 'asc' ? <ArrowUp className="h-3 w-3 text-[var(--color-accent-cyan)]" /> : <ArrowDown className="h-3 w-3 text-[var(--color-accent-cyan)]" />
          )}
        </span>
      </th>
    );
  };

  const sortedRecords = sortColumn
    ? [...records].sort((a, b) => {
        let va: string | number = '';
        let vb: string | number = '';
        if (sortColumn === 'id') { va = a.id; vb = b.id; }
        else if (sortColumn === 'owner') { va = a.ownerKeyId ?? ''; vb = b.ownerKeyId ?? ''; }
        else if (sortColumn === 'status') { va = a.finalStatus; vb = b.finalStatus; }
        else if (sortColumn === 'source') { va = a.source; vb = b.source; }
        else if (sortColumn === 'createdAt') { va = a.createdAt ?? 0; vb = b.createdAt ?? 0; }
        else if (sortColumn === 'lastSeenAt') { va = a.lastSeenAt; vb = b.lastSeenAt; }
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDirection === 'asc' ? cmp : -cmp;
      })
    : records;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Session History</h2>
          <p className="mt-1 text-sm text-gray-500">Merged audit and live session lifecycle records</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void fetchData(); }}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {records.length > 0 && (
            <button
              onClick={() => handleExport()}
              className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-medium text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
              aria-label="Export session history as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="search-filter" className="text-xs text-zinc-500">Search</label>
            <input
              id="search-filter"
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="Search name or prompt…"
              className="w-48 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="owner-filter" className="text-xs text-zinc-500">Owner key ID</label>
            <input
              id="owner-filter"
              type="text"
              value={filterOwnerInput}
              onChange={(e) => setFilterOwnerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="e.g. admin-main"
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="status-filter" className="text-xs text-zinc-500">Status</label>
            <select
              id="status-filter"
              value={filterStatusInput}
              onChange={(e) => setFilterStatusInput(e.target.value)}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="date-filter" className="text-xs text-zinc-500">Date range</label>
            <select
              id="date-filter"
              value={filterDateRange}
              onChange={(e) => setFilterDateRange(e.target.value as DateRange)}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              {DATE_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {filterDateRange === 'custom' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="date-from" className="text-xs text-zinc-500">From</label>
              <input
                id="date-from"
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              />
            </div>
          )}

          {filterDateRange === 'custom' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="date-to" className="text-xs text-zinc-500">To</label>
              <input
                id="date-to"
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="sort-filter" className="text-xs text-zinc-500">Sort by</label>
            <select
              id="sort-filter"
              value={filterSort}
              onChange={(e) => { setFilterSort(e.target.value as typeof filterSort); }}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="status">By status</option>
            </select>
          </div>

          <button
            onClick={applyFilters}
            className="rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
          >
            Apply
          </button>

          <button
            onClick={clearFilters}
            className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
          >
            Clear
          </button>
        </div>
      </div>

      {endpointMissing ? (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-[var(--color-surface)] p-12 text-center">
          <History className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
          <p className="font-medium text-zinc-400">Session history endpoint not available yet</p>
          <p className="mt-1 text-xs text-zinc-600">The /v1/sessions/history endpoint has not been implemented on the server.</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="font-medium text-red-400">Failed to load session history</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50">

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 border-b border-[var(--color-accent-cyan)]/20 bg-[var(--color-accent-cyan)]/5 px-4 py-2.5">
              <span className="text-sm font-medium text-[var(--color-accent-cyan)]">{selectedIds.size} selected</span>
              <button
                onClick={() => handleExport()}
                className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
              >
                <Icon name="Download" size={12} />
                Export
              </button>
              <button
                onClick={() => setConfirmDeleteOpen(true)}
                className="flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
              >
                <Trash2 className="h-3 w-3" />
                Kill
              </button>
              <button
                onClick={handleShareLink}
                className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
              >
                <Share2 className="h-3 w-3" />
                Share link
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-900/80">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={sortedRecords.length > 0 && selectedIds.size === sortedRecords.length}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-cyan-500 focus:ring-cyan-500/30"
                    />
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Name</th>
                  {sortableHeader("Session ID", "id")}
                  {sortableHeader("Owner", "owner")}
                  {sortableHeader("Status", "status")}
                  {sortableHeader("Source", "source")}
                  {sortableHeader("Created", "createdAt")}
                  {sortableHeader("Last seen", "lastSeenAt")}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows count={pageSize} />
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center text-zinc-500">
                      <EmptyState
                        icon={<SearchX className="h-8 w-8" />}
                        title="No session history records found"
                        description="Try adjusting your filters or date range."
                      />
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((record, index) => (
                    <tr
                      key={`${record.id}-${record.lastSeenAt}`}
                      ref={(el) => { rowRefs.current[index] = el; }}
                      tabIndex={0}
                      className="border-b border-gray-200 dark:border-zinc-800 cursor-pointer transition-colors hover:bg-[var(--color-surface-hover,theme(colors.zinc.800/40))] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-accent-cyan)]/40"
                      onClick={(e) => handleRowClick(record.id, e)}
                      onKeyDown={(e) => handleRowKeyDown(e, record.id, index)}
                    >
                      <td className="px-4 py-3" data-no-nav>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-cyan-500 focus:ring-cyan-500/30"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-zinc-500">—</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 group/id">
                          <span
                            className="font-mono text-sm text-gray-700 dark:text-zinc-200"
                            title={record.id}
                          >
                            {shortId(record.id)}
                          </span>
                          <button
                            data-no-nav
                            onClick={(e) => copySessionId(record.id, e)}
                            className="opacity-0 group-hover/id:opacity-100 rounded p-0.5 text-zinc-500 hover:text-zinc-300 transition-opacity"
                            aria-label="Copy session ID"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-zinc-400">{record.ownerKeyId ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${statusClass(record.finalStatus)}`}>
                          {record.finalStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-medium ${sourceClass(record.source)}`}>
                          {record.source}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-zinc-400" title={formatTimestamp(record.createdAt)}>
                        {record.createdAt !== undefined ? formatTimeAgo(record.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-zinc-400" title={formatTimestamp(record.lastSeenAt)}>
                        {formatTimeAgo(record.lastSeenAt)}
                      </td>
                      <td className="px-3 py-3 text-zinc-500">
                        <Icon name="ChevronRight" size={16} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 dark:border-zinc-800 px-4 py-3">
            <div className="text-xs text-zinc-500">
              Showing page {page} of {totalPages} ({total} records)
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="history-page-size" className="text-xs text-zinc-500">Rows</label>
              <select
                id="history-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>

              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-700 dark:text-zinc-200 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-700 dark:text-zinc-200 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-gray-300 dark:border-zinc-700 bg-[var(--color-surface)] p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Kill {selectedIds.size} session{selectedIds.size !== 1 ? 's' : ''}?
            </h3>
            <p className="mt-2 text-sm text-gray-400">
              This will kill the selected sessions. This action cannot be undone.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="flex-1 rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? 'Killing…' : `Kill ${selectedIds.size}`}
              </button>
              <button
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
                className="flex-1 rounded border border-gray-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
