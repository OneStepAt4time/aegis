/**
 * pages/SessionHistoryPage.tsx — Session history view with filters and pagination.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
  SearchX,
  Download,
} from 'lucide-react';
import {
  fetchSessionHistory,
  type FetchSessionHistoryParams,
  type SessionHistoryRecord,
} from '../api/client';
import { formatTimeAgo } from '../utils/format';
import EmptyState from '../components/shared/EmptyState';
import { generateSessionHistoryCSV, downloadCSV } from '../utils/csv-export';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'active' },
  { value: 'killed', label: 'killed' },
  { value: 'unknown', label: 'unknown' },
] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

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
  return 'text-zinc-300 bg-zinc-700/40 border-zinc-700';
}

function sourceClass(source: SessionHistoryRecord['source']): string {
  if (source === 'audit+live') return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25';
  if (source === 'live') return 'text-sky-300 bg-sky-500/10 border-sky-500/25';
  return 'text-zinc-300 bg-zinc-700/40 border-zinc-700';
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-zinc-800">
          <td className="px-4 py-3"><div className="h-4 w-44 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-28 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-14 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-zinc-800" /></td>
        </tr>
      ))}
    </>
  );
}

export default function SessionHistoryPage() {
  const [records, setRecords] = useState<SessionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const [filterOwnerInput, setFilterOwnerInput] = useState('');
  const [filterStatusInput, setFilterStatusInput] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterName, setFilterName] = useState('');
  const [filterDateRange, setFilterDateRange] = useState<'today'|'7d'|'30d'|'custom'>('7d');
  const [filterSort, setFilterSort] = useState<'newest'|'oldest'|'status'>('newest');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

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
    if (filterName) params.nameSearch = filterName;
    const now = Date.now();
    if (filterDateRange === 'today') {
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      params.createdAfter = Math.floor(startOfDay.getTime() / 1000);
    } else if (filterDateRange === '7d') {
      params.createdAfter = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000);
    } else if (filterDateRange === '30d') {
      params.createdAfter = Math.floor((now - 30 * 24 * 60 * 60 * 1000) / 1000);
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
  }, [page, pageSize, filterOwner, filterStatus, filterName, filterDateRange, customDateFrom, customDateTo, filterSort]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchData(ac.signal);
    return () => ac.abort();
  }, [fetchData]);

  const applyFilters = () => {
    setPage(1);
    setFilterOwner(filterOwnerInput.trim());
    setFilterStatus(filterStatusInput);
  };

  const clearFilters = () => {
    setPage(1);
    setFilterOwnerInput('');
    setFilterStatusInput('');
    setFilterOwner('');
    setFilterStatus('');
    setFilterName('');
    setFilterDateRange('7d');
    setCustomDateFrom('');
    setCustomDateTo('');
    setFilterSort('newest');
  };

  const handleExport = () => {
    const csv = generateSessionHistoryCSV(records);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(csv, `aegis-sessions-${date}.csv`);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Session History</h2>
          <p className="mt-1 text-sm text-gray-500">Merged audit and live session lifecycle records</p>
        </div>
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
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            aria-label="Export session history as CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="owner-filter" className="text-xs text-zinc-500">Owner key ID</label>
            <input
              id="owner-filter"
              type="text"
              value={filterOwnerInput}
              onChange={(e) => setFilterOwnerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="e.g. admin-main"
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="status-filter" className="text-xs text-zinc-500">Status</label>
            <select
              id="status-filter"
              value={filterStatusInput}
              onChange={(e) => setFilterStatusInput(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className='flex flex-col gap-1'>
            <label htmlFor='name-filter' className='text-xs text-zinc-500'>Session ID</label>
            <input
              id='name-filter'
              type='text'
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder='Search by ID...'
              className='rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none'
            />
          </div>

          <div className='flex flex-col gap-1'>
            <label htmlFor='date-filter' className='text-xs text-zinc-500'>Date range</label>
            <select
              id='date-filter'
              value={filterDateRange}
              onChange={(e) => setFilterDateRange(e.target.value as typeof filterDateRange)}
              className='rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none'
            >
              <option value='7d'>Last 7 days</option>
              <option value='30d'>Last 30 days</option>
              <option value='today'>Today</option>
              <option value='custom'>Custom range</option>
            </select>
          </div>

          {filterDateRange === 'custom' && (
            <div className='flex flex-col gap-1'>
              <label htmlFor='date-from' className='text-xs text-zinc-500'>From</label>
              <input
                id='date-from'
                type='date'
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className='rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none'
              />
            </div>
          )}

          {filterDateRange === 'custom' && (
            <div className='flex flex-col gap-1'>
              <label htmlFor='date-to' className='text-xs text-zinc-500'>To</label>
              <input
                id='date-to'
                type='date'
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className='rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none'
              />
            </div>
          )}

          <div className='flex flex-col gap-1'>
            <label htmlFor='sort-filter' className='text-xs text-zinc-500'>Sort by</label>
            <select
              id='sort-filter'
              value={filterSort}
              onChange={(e) => { setFilterSort(e.target.value as typeof filterSort); applyFilters(); }}
              className='rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none'
            >
              <option value='newest'>Newest first</option>
              <option value='oldest'>Oldest first</option>
              <option value='status'>By status</option>
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
            className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-700"
          >
            Clear
          </button>
        </div>
      </div>

      {endpointMissing ? (
        <div className="rounded-lg border border-zinc-800 bg-[var(--color-surface)] p-12 text-center">
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
        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="border-b border-zinc-800 bg-zinc-900/80">
                <tr>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Session ID</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Owner</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Status</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Source</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Created</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows count={pageSize} />
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-zinc-500">
                      <EmptyState
                        icon={<SearchX className="h-8 w-8" />}
                        title="No session history records found"
                        description="Try adjusting your filters or date range."
                      />
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={`${record.id}-${record.lastSeenAt}`} className="border-b border-zinc-800 transition-colors hover:bg-zinc-800/40">
                      <td className="px-4 py-3 font-mono text-sm text-zinc-200">{record.id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-400">{record.ownerKeyId ?? '—'}</td>
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
                      <td className="px-4 py-3 text-xs text-zinc-400" title={formatTimestamp(record.createdAt)}>
                        {record.createdAt !== undefined ? formatTimeAgo(record.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-400" title={formatTimestamp(record.lastSeenAt)}>
                        {formatTimeAgo(record.lastSeenAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
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
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>

              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
