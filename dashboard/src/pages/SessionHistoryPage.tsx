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
} from 'lucide-react';
import {
  fetchSessionHistory,
  type FetchSessionHistoryParams,
  type SessionHistoryRecord,
} from '../api/client';
import { formatTimeAgo } from '../utils/format';

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
  }, [page, pageSize, filterOwner, filterStatus]);

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
          className="flex items-center gap-1.5 rounded border border-[#00e5ff]/30 bg-[#00e5ff]/10 px-3 py-2 text-xs font-medium text-[#00e5ff] transition-colors hover:bg-[#00e5ff]/20 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
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
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#00e5ff]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="status-filter" className="text-xs text-zinc-500">Status</label>
            <select
              id="status-filter"
              value={filterStatusInput}
              onChange={(e) => setFilterStatusInput(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[#00e5ff]/50 focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <button
            onClick={applyFilters}
            className="rounded border border-[#00e5ff]/30 bg-[#00e5ff]/10 px-3 py-1.5 text-xs font-medium text-[#00e5ff] transition-colors hover:bg-[#00e5ff]/20"
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
        <div className="rounded-lg border border-zinc-800 bg-[#111118] p-12 text-center">
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
                      <SearchX className="mx-auto mb-2 h-5 w-5 text-zinc-600" />
                      No session history records found.
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
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 focus:border-[#00e5ff]/50 focus:outline-none"
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
