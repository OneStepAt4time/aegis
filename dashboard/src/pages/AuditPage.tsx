/**
 * pages/AuditPage.tsx — Audit trail with paginated table, filters, and search.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  SearchX,
  AlertCircle,
} from 'lucide-react';
import { fetchAuditLogs, type FetchAuditLogsParams } from '../api/client';
import type { AuditRecord } from '../types';

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'create' },
  { value: 'kill', label: 'kill' },
  { value: 'send', label: 'send' },
  { value: 'approve', label: 'approve' },
  { value: 'reject', label: 'reject' },
] as const;

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-zinc-800">
          <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-28 animate-pulse rounded bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-40 animate-pulse rounded bg-zinc-800" /></td>
        </tr>
      ))}
    </>
  );
}

function AuditRow({ record }: { record: AuditRecord }) {
  const actionColor: Record<string, string> = {
    create: 'text-emerald-400 bg-emerald-400/10',
    kill: 'text-red-400 bg-red-400/10',
    send: 'text-blue-400 bg-blue-400/10',
    approve: 'text-green-400 bg-green-400/10',
    reject: 'text-amber-400 bg-amber-400/10',
  };

  const colorClass = actionColor[record.action] ?? 'text-zinc-300 bg-zinc-700/50';

  return (
    <tr className="border-b border-zinc-800 hover:bg-zinc-800/40 transition-colors">
      <td className="px-4 py-3 text-sm text-zinc-400 whitespace-nowrap">
        {formatTimestamp(record.ts)}
      </td>
      <td className="px-4 py-3 text-sm text-zinc-200 font-mono">
        {record.actor}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}>
          {record.action}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-zinc-300 font-mono">
        {record.sessionId ?? '—'}
      </td>
      <td className="px-4 py-3 text-sm text-zinc-400 max-w-xs truncate">
        {record.detail ?? '—'}
      </td>
    </tr>
  );
}

export default function AuditPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);

  const [filterActor, setFilterActor] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterSessionId, setFilterSessionId] = useState('');

  const [appliedActor, setAppliedActor] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedSessionId, setAppliedSessionId] = useState('');

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setEndpointMissing(false);

    const params: FetchAuditLogsParams = {
      page,
      pageSize,
    };
    if (appliedActor) params.actor = appliedActor;
    if (appliedAction) params.action = appliedAction;
    if (appliedSessionId) params.sessionId = appliedSessionId;

    try {
      const data = await fetchAuditLogs({ ...params, signal: signal as AbortSignal });
      setRecords(data.records);
      setTotal(data.total);
    } catch (e: unknown) {
      const err = e as Error & { statusCode?: number };
      // Ignore aborts caused by navigating away — not a real error
      if ((err as DOMException).name === 'AbortError') return;
      if (err.statusCode === 404) {
        setEndpointMissing(true);
        setRecords([]);
        setTotal(0);
      } else {
        setError(err.message ?? 'Failed to fetch audit logs');
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, appliedActor, appliedAction, appliedSessionId]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchData(ac.signal);
    return () => ac.abort();
  }, [fetchData]);

  const applyFilters = () => {
    setPage(1);
    setAppliedActor(filterActor);
    setAppliedAction(filterAction);
    setAppliedSessionId(filterSessionId);
  };

  const clearFilters = () => {
    setFilterActor('');
    setFilterAction('');
    setFilterSessionId('');
    setPage(1);
    setAppliedActor('');
    setAppliedAction('');
    setAppliedSessionId('');
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-100">Audit Trail</h2>
          <p className="mt-1 text-sm text-gray-500">
            Review system actions and API key activity
          </p>
        </div>
        <button
          onClick={() => { void fetchData(); }}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-300">Filters</span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-actor" className="text-xs text-zinc-500">Actor (Key ID)</label>
            <input
              id="filter-actor"
              type="text"
              placeholder="e.g. key-abc123"
              value={filterActor}
              onChange={(e) => setFilterActor(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#00e5ff]/50 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-action" className="text-xs text-zinc-500">Action</label>
            <select
              id="filter-action"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 focus:border-[#00e5ff]/50 focus:outline-none"
            >
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="filter-session" className="text-xs text-zinc-500">Session ID</label>
            <input
              id="filter-session"
              type="text"
              placeholder="e.g. sess-xyz"
              value={filterSessionId}
              onChange={(e) => setFilterSessionId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-[#00e5ff]/50 focus:outline-none"
            />
          </div>
          <button
            onClick={applyFilters}
            className="rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 px-3 py-1.5 text-xs font-medium text-[#00e5ff] border border-[#00e5ff]/30 transition-colors"
          >
            Apply
          </button>
          <button
            onClick={clearFilters}
            className="rounded bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 border border-zinc-700 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Content */}
      {endpointMissing ? (
        <div className="rounded-lg border border-zinc-800 bg-[#111118] p-12 text-center">
          <Shield className="mx-auto h-10 w-10 text-zinc-600 mb-3" />
          <p className="text-zinc-400 font-medium">Audit endpoint not available yet</p>
          <p className="mt-1 text-xs text-zinc-600">
            The /v1/audit endpoint has not been implemented on the server.
          </p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-12 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-red-500 mb-3" />
          <p className="text-red-400 font-medium">Failed to load audit logs</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
          <button
            onClick={() => { void fetchData(); }}
            className="mt-4 rounded bg-red-500/10 hover:bg-red-500/20 px-4 py-2 text-xs font-medium text-red-400 border border-red-500/30 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Timestamp</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Actor</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Action</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Session ID</th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Detail</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRows count={pageSize} />
            </tbody>
          </table>
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-[#111118] p-12 text-center">
          <SearchX className="mx-auto h-10 w-10 text-zinc-600 mb-3" />
          <p className="text-zinc-400 font-medium">No audit records found</p>
          <p className="mt-1 text-xs text-zinc-600">
            {(appliedActor || appliedAction || appliedSessionId)
              ? 'Try adjusting your filters.'
              : 'Audit records will appear here once actions are performed.'}
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Timestamp</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Actor</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Action</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Session ID</th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">Detail</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <AuditRow key={record.id} record={record} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <span>{total} record{total !== 1 ? 's' : ''}</span>
              <span className="text-zinc-700">|</span>
              <label htmlFor="page-size" className="sr-only">Page size</label>
              <select
                id="page-size"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 focus:border-[#00e5ff]/50 focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
