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
import { NLFilterBar, type FilterToken } from '../components/shared/NLFilterBar';
import { sanitizeErrorMessage } from '../utils/sanitizeErrorMessage';
import { useT } from '../i18n/context';

type DateRange = '1h' | 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';

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
  return 'text-[var(--color-text-muted)] dark:text-[var(--color-text-primary)] bg-[var(--color-void-lighter)]/40 border-[var(--color-void-lighter)]';
}

function sourceClass(source: SessionHistoryRecord['source']): string {
  if (source === 'audit+live') return 'text-cyan-300 bg-[var(--color-accent-cyan)]/10 border-[var(--color-accent-cyan)]/25';
  if (source === 'live') return 'text-sky-300 bg-sky-500/10 border-sky-500/25';
  return 'text-[var(--color-text-muted)] dark:text-[var(--color-text-primary)] bg-[var(--color-void-lighter)]/40 border-[var(--color-void-lighter)]';
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
        <tr key={i} className="border-b border-[var(--color-void-lighter)]">
          <td className="px-4 py-3"><div className="h-4 w-4 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-36 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-28 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-14 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-20 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
          <td className="px-4 py-3"><div className="h-4 w-4 animate-pulse rounded bg-[var(--color-void-light)]" /></td>
        </tr>
      ))}
    </>
  );
}

export default function SessionHistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const t = useT();

  const STATUS_OPTIONS = [
    { value: '', label: t('sessionHistory.allStatuses') },
    { value: 'active', label: 'active' },
    { value: 'killed', label: 'killed' },
    { value: 'unknown', label: 'unknown' },
  ] as const;

  const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
    { value: '1h', label: t('sessionHistory.lastHour') },
    { value: 'today', label: t('sessionHistory.today') },
    { value: 'yesterday', label: t('sessionHistory.yesterday') },
    { value: '7d', label: t('sessionHistory.last7d') },
    { value: '30d', label: t('sessionHistory.last30d') },
    { value: 'month', label: t('sessionHistory.thisMonth') },
    { value: 'custom', label: t('sessionHistory.customRange') },
  ];

  const [records, setRecords] = useState<SessionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const addToast = useToastStore((t_store) => t_store.addToast);

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

  const handleNLFilter = useCallback((tokens: FilterToken[], _raw: string) => {
    setPage(1);
    let status = '';
    let owner = '';
    let search = '';
    let dateAfter: Date | null = null;
    let dateBefore: Date | null = null;

    for (const token of tokens) {
      if (token.field === 'status') {
        status = token.value;
      } else if (token.field === 'owner') {
        owner = token.value;
      } else if (token.field === 'text') {
        search = token.value;
      } else if (token.field === 'date') {
        const d = new Date(token.value);
        if (token.op === 'gte') {
          if (!dateAfter || d > dateAfter) dateAfter = d;
        } else if (token.op === 'lte') {
          if (!dateBefore || d < dateBefore) dateBefore = d;
        }
      }
    }

    setFilterOwner(owner);
    setFilterOwnerInput(owner);
    setFilterStatus(status);
    setFilterStatusInput(status);
    setFilterSearch(search);

    if (dateAfter || dateBefore) {
      setFilterDateRange('custom');
      if (dateAfter) setCustomDateFrom(dateAfter.toISOString().split('T')[0]);
      if (dateBefore) setCustomDateTo(dateBefore.toISOString().split('T')[0]);
    }
  }, []);

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
      addToast('success', t('sessionHistory.sessionsKilled'), t('sessionHistory.sessionsKilledDescription', { count: success }));
    } else {
      addToast('error', t('sessionHistory.partialKill'), t('sessionHistory.partialKillDescription', { success, failed }));
    }
    void fetchData();
  }, [selectedIds, addToast, t]);

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
        setError(sanitizeErrorMessage(err, t('sessionHistory.failedLoad')));
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filterOwner, filterStatus, filterSearch, filterDateRange, customDateFrom, customDateTo, filterSort, t]);

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

  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;

    // If specific rows are selected, export just those
    if (selectedIds.size > 0) {
      const toExport = sortedRecords.filter((r) => selectedIds.has(r.id));
      const csv = generateSessionHistoryCSV(toExport);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `aegis-sessions-${date}.csv`);
      return;
    }

    // No selection — export all matching records (not just current page)
    setExporting(true);
    try {
      const params: FetchSessionHistoryParams = { limit: 9999 };
      if (filterOwner) params.ownerKeyId = filterOwner;
      if (filterStatus) params.status = filterStatus as FetchSessionHistoryParams['status'];
      if (filterSearch) params.nameSearch = filterSearch;
      if (filterSort === 'newest') { params.sortBy = 'createdAt'; params.sortOrder = 'desc'; }
      else if (filterSort === 'oldest') { params.sortBy = 'createdAt'; params.sortOrder = 'asc'; }
      else if (filterSort === 'status') { params.sortBy = 'status'; params.sortOrder = 'asc'; }
      // Apply same date filters as the page
      const now = Date.now();
      if (filterDateRange === '1h') params.createdAfter = Math.floor((now - 60 * 60 * 1000) / 1000);
      else if (filterDateRange === 'today') { const d = new Date(); d.setHours(0,0,0,0); params.createdAfter = Math.floor(d.getTime() / 1000); }
      else if (filterDateRange === '7d') params.createdAfter = Math.floor((now - 7*24*60*60*1000) / 1000);
      else if (filterDateRange === '30d') params.createdAfter = Math.floor((now - 30*24*60*60*1000) / 1000);

      const data = await fetchSessionHistory(params);
      const csv = generateSessionHistoryCSV(data.records);
      const date = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `aegis-sessions-${date}.csv`);
      addToast('success', t('sessionHistory.exportComplete'), t('sessionHistory.exportCompleteDescription', { count: data.records.length }));
    } catch (e) {
      addToast('error', t('sessionHistory.exportFailed'), e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  const handleShareLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(
      () => addToast('success', t('sessionHistory.linkCopied'), t('sessionHistory.linkCopiedDescription')),
      () => addToast('error', t('sessionHistory.copyFailed'), t('sessionHistory.copyFailedDescription')),
    );
  };

  const copySessionId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id).then(
      () => addToast('success', t('sessionHistory.copied'), t('sessionHistory.sessionIdCopied')),
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
        className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)] cursor-pointer select-none hover:text-[var(--color-text-primary)] transition-colors"
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
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('sessionHistory.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('sessionHistory.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => { void fetchData(); }}
            aria-label={t('sessionHistory.refresh')}
            disabled={loading}
            className="flex min-h-[44px] items-center gap-1.5 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {t('sessionHistory.refresh')}
          </button>
          {records.length > 0 && (
            <button type="button"
              onClick={() => void handleExport()}
              disabled={exporting}
              className="flex min-h-[44px] items-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-void-lighter)] disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label={t('sessionHistory.exportCsv')}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? t('sessionHistory.exporting') : t('sessionHistory.exportCsv')}
            </button>
          )}
        </div>
      </div>

      {/* NL Filter Bar */}
      <NLFilterBar
        onFilter={handleNLFilter}
        placeholder={t('sessionHistory.nlFilterPlaceholder')}
        className="mb-2"
      />

      {/* Filters */}
      <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="search-filter" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.search')}</label>
            <input
              id="search-filter"
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder={t('sessionHistory.searchPlaceholder')}
              className="min-h-[44px] w-48 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="owner-filter" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.ownerKeyId')}</label>
            <input
              id="owner-filter"
              type="text"
              value={filterOwnerInput}
              onChange={(e) => setFilterOwnerInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder={t('sessionHistory.ownerPlaceholder')}
              className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="status-filter" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.status')}</label>
            <select
              id="status-filter"
              value={filterStatusInput}
              onChange={(e) => setFilterStatusInput(e.target.value)}
              className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="date-filter" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.dateRange')}</label>
            <select
              id="date-filter"
              value={filterDateRange}
              onChange={(e) => setFilterDateRange(e.target.value as DateRange)}
              className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              {DATE_RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {filterDateRange === 'custom' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="date-from" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.from')}</label>
              <input
                id="date-from"
                type="date"
                value={customDateFrom}
                onChange={(e) => setCustomDateFrom(e.target.value)}
                className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              />
            </div>
          )}

          {filterDateRange === 'custom' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="date-to" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.to')}</label>
              <input
                id="date-to"
                type="date"
                value={customDateTo}
                onChange={(e) => setCustomDateTo(e.target.value)}
                className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="sort-filter" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.sortBy')}</label>
            <select
              id="sort-filter"
              value={filterSort}
              onChange={(e) => { setFilterSort(e.target.value as typeof filterSort); }}
              className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            >
              <option value="newest">{t('sessionHistory.newestFirst')}</option>
              <option value="oldest">{t('sessionHistory.oldestFirst')}</option>
              <option value="status">{t('sessionHistory.byStatus')}</option>
            </select>
          </div>

          <button type="button"
            onClick={applyFilters}
            className="min-h-[44px] rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
          >
            {t('sessionHistory.apply')}
          </button>

          <button type="button"
            onClick={clearFilters}
            className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-void-lighter)]"
          >
            {t('sessionHistory.clear')}
          </button>
        </div>
      </div>

      {endpointMissing ? (
        <div className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-12 text-center">
          <History className="mx-auto mb-3 h-10 w-10 text-[var(--color-text-muted)]" />
          <p className="font-medium text-[var(--color-text-muted)]">{t('sessionHistory.endpointMissing')}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('sessionHistory.endpointMissingDescription')}</p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-[var(--color-danger)]" />
          <p className="font-medium text-[var(--color-danger)]">{t('sessionHistory.failedLoad')}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{error}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50">

          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 border-b border-[var(--color-accent-cyan)]/20 bg-[var(--color-accent-cyan)]/5 px-4 py-2.5">
              <span className="text-sm font-medium text-[var(--color-accent-cyan)]">{t('sessionHistory.selected', { count: selectedIds.size })}</span>
              <button type="button"
                onClick={() => void handleExport()}
                disabled={exporting}
                className="flex min-h-[44px] items-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-void-lighter)] disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={t('sessionHistory.export')}
              >
                <Icon name="Download" size={12} />
                {exporting ? t('sessionHistory.exporting') : t('sessionHistory.export')}
              </button>
              <button type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="flex min-h-[44px] items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
                aria-label={t('sessionHistory.kill')}
              >
                <Trash2 className="h-3 w-3" />
                {t('sessionHistory.kill')}
              </button>
              <button type="button"
                onClick={handleShareLink}
                className="flex min-h-[44px] items-center gap-1.5 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-void-lighter)]"
                aria-label={t('sessionHistory.shareLink')}
              >
                <Share2 className="h-3 w-3" />
                {t('sessionHistory.shareLink')}
              </button>
              <button type="button"
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto flex min-h-[44px] items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                aria-label={t('sessionHistory.clear')}
              >
                <X className="h-3 w-3" />
                {t('sessionHistory.clear')}
              </button>
            </div>
          )}

          <div className="overflow-x-auto" tabIndex={0} aria-label={t('sessionHistory.title')}>
            <table className="min-w-full text-left">
              <thead className="border-b border-[var(--color-void-lighter)] bg-[var(--color-void)]/80">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    <span className="sr-only">{t('sessionHistory.selectRows')}</span>
                    <input
                      aria-label={t('sessionHistory.selectAllRows')}
                      type="checkbox"
                      checked={sortedRecords.length > 0 && selectedIds.size === sortedRecords.length}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-[var(--color-void-lighter)] bg-[var(--color-void-light)] text-[var(--color-accent-cyan)] focus:ring-cyan-500/30"
                    />
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{t('sessionHistory.nameColumn')}</th>
                  {sortableHeader(t('sessionHistory.sessionIdColumn'), "id")}
                  {sortableHeader(t('sessionHistory.ownerColumn'), "owner")}
                  {sortableHeader(t('sessionHistory.statusColumn'), "status")}
                  {sortableHeader(t('sessionHistory.sourceColumn'), "source")}
                  {sortableHeader(t('sessionHistory.createdColumn'), "createdAt")}
                  {sortableHeader(t('sessionHistory.lastSeenColumn'), "lastSeenAt")}
                  <th className="w-8" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows count={pageSize} />
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-16 text-center text-[var(--color-text-muted)]">
                      <EmptyState
                        icon={<SearchX className="h-8 w-8" />}
                        title={t('sessionHistory.noRecords')}
                        description={t('sessionHistory.noRecordsDescription')}
                        action={
                          <button type="button"
                            className="mt-4 px-4 py-2 text-sm rounded-lg bg-[var(--color-void-lighter)] hover:bg-[var(--color-void-lighter)] transition-colors"
                            onClick={() => {
                              setFilterSearch('');
                              setFilterStatus('all');
                              setFilterDateRange('7d');
                            }}
                          >
                            {t('sessionHistory.clearAllFilters')}
                          </button>
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  sortedRecords.map((record, index) => (
                    <tr
                      key={`${record.id}-${record.lastSeenAt}`}
                      ref={(el) => { rowRefs.current[index] = el; }}
                      tabIndex={0}
                      className="border-b border-[var(--color-void-lighter)] cursor-pointer transition-colors hover:bg-[var(--color-surface-hover,theme(colors.zinc.800/40))] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-accent-cyan)]/40"
                      onClick={(e) => handleRowClick(record.id, e)}
                      onKeyDown={(e) => handleRowKeyDown(e, record.id, index)}
                    >
                      <td className="px-4 py-3" data-no-nav>
                        <input
                          aria-label={`Select session ${record.id}`}
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-[var(--color-void-lighter)] bg-[var(--color-void-light)] text-[var(--color-accent-cyan)] focus:ring-cyan-500/30"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]" aria-hidden="true">—</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 group/id">
                          <span
                            className="font-mono text-sm text-[var(--color-text-primary)]"
                            title={record.id}
                          >
                            {shortId(record.id)}
                          </span>
                          <button type="button"
                            data-no-nav
                            onClick={(e) => copySessionId(record.id, e)}
                            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-[var(--color-text-muted)] opacity-0 transition-opacity hover:text-[var(--color-text-primary)] group-hover/id:opacity-100"
                            aria-label={t("aria.copySessionId")}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]">{record.ownerKeyId ?? '—'}</td>
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
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]" title={formatTimestamp(record.createdAt)}>
                        {record.createdAt !== undefined ? formatTimeAgo(record.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] dark:text-[var(--color-text-muted)]" title={formatTimestamp(record.lastSeenAt)}>
                        {formatTimeAgo(record.lastSeenAt)}
                      </td>
                      <td className="px-3 py-3 text-[var(--color-text-muted)]">
                        <Icon name="ChevronRight" size={16} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-void-lighter)] px-4 py-3">
            <div className="text-xs text-[var(--color-text-muted)]">
              {t('sessionHistory.showingPage', { page, totalPages, total })}
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="history-page-size" className="text-xs text-[var(--color-text-muted)]">{t('sessionHistory.rows')}</label>
              <select
                id="history-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="min-h-[44px] rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-2 py-1 text-xs text-[var(--color-text-primary)] focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>

              <button type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                aria-label={t('sessionHistory.prev')}
                className="inline-flex min-h-[44px] items-center gap-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-2 py-1 text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-void-lighter)] disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> {t('sessionHistory.prev')}
              </button>

              <button type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="inline-flex min-h-[44px] items-center gap-1 rounded border border-[var(--color-void-lighter)] bg-[var(--color-void-light)] px-2 py-1 text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-void-lighter)] disabled:opacity-40"
                aria-label={t('sessionHistory.next')}
              >
                {t('sessionHistory.next')} <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {t('sessionHistory.killDialogTitle', { count: selectedIds.size })}
            </h3>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              {t('sessionHistory.killDialogDescription')}
            </p>
            <div className="mt-5 flex gap-3">
              <button type="button"
                onClick={handleBulkDelete}
                disabled={deleting}
                className="flex-1 rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
              >
                {deleting ? t('sessionHistory.killing') : t('sessionHistory.killCount', { count: selectedIds.size })}
              </button>
              <button type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
                className="flex-1 rounded border border-[var(--color-void-lighter)] px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] dark:text-[var(--color-text-primary)] hover:bg-[var(--color-void-lighter)] disabled:opacity-50"
              >
                {t('modal.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
