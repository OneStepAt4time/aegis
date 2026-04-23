/**
 * pages/AuditPage.tsx — Audit trail query, export, and chain-integrity UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Filter,
  Pause,
  Play,
  RefreshCw,
  SearchX,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react';
import EmptyState from '../components/shared/EmptyState';
import {
  exportAuditLogs,
  fetchAuditLogs,
  type AuditExportFormat,
  type AuditExportResult,
  type FetchAuditLogsParams,
} from '../api/client';
import type { AuditRecord, AuditChainMetadata, AuditIntegrityMetadata } from '../types';

const ACTION_SUGGESTIONS = [
  'key.create',
  'key.revoke',
  'session.create',
  'session.kill',
  'session.env.rejected',
  'session.action.allowed',
  'session.action.denied',
  'permission.approve',
  'permission.reject',
  'api.authenticated',
] as const;

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const INTEGRITY_POLL_MS = 60_000;
const LIVE_TAIL_POLL_MS = 10_000;

interface AuditFilterState {
  actor: string;
  action: string;
  sessionId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: AuditFilterState = {
  actor: '',
  action: '',
  sessionId: '',
  from: '',
  to: '',
};

function formatTimestamp(ts?: string | null): string {
  if (!ts) return '—';

  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return ts;

  return parsed.toLocaleString();
}

function toIsoTimestamp(value: string): string | undefined {
  if (!value) return undefined;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  return parsed.toISOString();
}

function trimFilters(filters: AuditFilterState): AuditFilterState {
  return {
    actor: filters.actor.trim(),
    action: filters.action.trim(),
    sessionId: filters.sessionId.trim(),
    from: filters.from,
    to: filters.to,
  };
}

function validateFilters(filters: AuditFilterState): string | null {
  const from = toIsoTimestamp(filters.from);
  const to = toIsoTimestamp(filters.to);

  if (filters.from && !from) return 'From must be a valid date and time.';
  if (filters.to && !to) return 'To must be a valid date and time.';
  if (from && to && Date.parse(from) > Date.parse(to)) {
    return 'From must be earlier than or equal to To.';
  }

  return null;
}

function buildAuditParams(filters: AuditFilterState): Omit<FetchAuditLogsParams, 'cursor' | 'limit' | 'signal'> {
  const actor = filters.actor.trim();
  const action = filters.action.trim();
  const sessionId = filters.sessionId.trim();
  const from = toIsoTimestamp(filters.from);
  const to = toIsoTimestamp(filters.to);

  return {
    ...(actor ? { actor } : {}),
    ...(action ? { action } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    reverse: true,
  };
}

function hasActiveFilters(filters: AuditFilterState): boolean {
  return Object.values(filters).some((value) => value !== '');
}

function actionBadgeClass(action: string): string {
  if (action.includes('deny') || action.includes('kill')) {
    return 'border border-rose-500/30 bg-rose-500/10 text-rose-300';
  }
  if (action.includes('reject')) {
    return 'border border-amber-500/30 bg-amber-500/10 text-amber-300';
  }
  if (action.includes('approve') || action.includes('allowed')) {
    return 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  }
  if (action.includes('create') || action.includes('authenticated')) {
    return 'border border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
  }
  return 'border border-gray-300 dark:border-zinc-700 bg-gray-200/60 dark:bg-zinc-700/40 text-gray-600 dark:text-zinc-300';
}

function truncateHash(hash: string, len = 8): string {
  if (hash.length <= len * 2 + 1) return hash;
  return `${hash.slice(0, len)}…${hash.slice(-len)}`;
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <tr key={index} className="border-b border-gray-200 dark:border-zinc-800">
          <td className="px-4 py-3"><div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-28 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
          <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" /></td>
        </tr>
      ))}
    </>
  );
}

function AuditRow({ record, index, onClick }: { record: AuditRecord; index: number; onClick: () => void }) {
  return (
    <motion.tr
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.2,
        delay: Math.min(index * 0.1, 1),
        ease: [0.2, 0, 0, 1],
      }}
      onClick={onClick}
      className="border-b border-gray-200 dark:border-zinc-800 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800/40 cursor-pointer"
    >
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-zinc-400">
        {formatTimestamp(record.ts)}
      </td>
      <td className="px-4 py-3 font-mono text-sm text-gray-700 dark:text-zinc-200">
        {record.actor}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${actionBadgeClass(record.action)}`}>
          {record.action}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-sm text-gray-600 dark:text-zinc-300">
        {record.sessionId ?? '—'}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-zinc-400" title={record.hash}>
        {truncateHash(record.hash)}
      </td>
    </motion.tr>
  );
}

function MetadataField({
  label,
  value,
  monospace = false,
}: {
  label: string;
  value: string;
  monospace?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-100/50 dark:bg-zinc-950/50 p-3">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-sm text-gray-700 dark:text-zinc-200 ${monospace ? 'break-all font-mono text-xs' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function ExportMetadataCard({ result }: { result: AuditExportResult }) {
  const integrityTone = result.integrity?.valid
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-rose-500/30 bg-rose-500/10 text-rose-300';
  const integrityLabel = result.integrity?.valid ? 'Integrity verified' : 'Integrity check failed';

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Latest export metadata</p>
          <p className="mt-1 text-xs text-zinc-500">
            {result.filename} · {result.format.toUpperCase()}
          </p>
        </div>
        {result.integrity ? (
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${integrityTone}`}>
            {integrityLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetadataField label="Records" value={String(result.chain.count)} />
        <MetadataField label="First record" value={formatTimestamp(result.chain.firstTs)} />
        <MetadataField label="Last record" value={formatTimestamp(result.chain.lastTs)} />
        <MetadataField
          label="Integrity file"
          value={result.integrity?.file ?? '—'}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <MetadataField label="Chain badge" value={result.chain.badgeHash ?? '—'} monospace />
        <MetadataField label="First hash" value={result.chain.firstHash ?? '—'} monospace />
        <MetadataField label="Last hash" value={result.chain.lastHash ?? '—'} monospace />
      </div>

      {result.integrity && result.integrity.brokenAt !== undefined ? (
        <p className="mt-3 text-xs text-rose-300">
          Chain verification failed at line {result.integrity.brokenAt}.
        </p>
      ) : null}
    </div>
  );
}

// ── Chain Integrity Badge ─────────────────────────────────────────

interface IntegrityState {
  loading: boolean;
  chain: AuditChainMetadata | null;
  integrity: AuditIntegrityMetadata | null;
  error: string | null;
}

function ChainIntegrityBadge({ state }: { state: IntegrityState }) {
  if (state.error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <span className="text-amber-300">Integrity check failed: {state.error}</span>
      </div>
    );
  }

  if (state.loading && !state.chain) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 px-3 py-2 text-xs text-zinc-500">
        <RefreshCw className="h-4 w-4 animate-spin" />
        <span>Verifying chain…</span>
      </div>
    );
  }

  if (state.integrity && !state.integrity.valid) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs">
        <ShieldAlert className="h-4 w-4 text-rose-400" />
        <span className="text-rose-300 font-medium">Chain broken</span>
        {state.integrity.brokenAt !== undefined && (
          <span className="text-rose-400">(at seq {state.integrity.brokenAt})</span>
        )}
      </div>
    );
  }

  if (state.chain) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <span className="text-emerald-300 font-medium">
          Chain verified ({state.chain.count} records)
        </span>
      </div>
    );
  }

  return null;
}

// ── Detail Drawer ─────────────────────────────────────────────────

function DetailDrawer({
  record,
  onClose,
}: {
  record: AuditRecord;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const fields: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: 'Timestamp', value: formatTimestamp(record.ts) },
    { label: 'Actor', value: record.actor, mono: true },
    { label: 'Action', value: record.action },
    { label: 'Session', value: record.sessionId ?? '—', mono: true },
    { label: 'Detail', value: record.detail || '—' },
  ];

  return (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          key="audit-drawer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[150] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        {/* Panel */}
        <motion.aside
          key="audit-drawer-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Audit record detail"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
          className="fixed right-0 top-0 bottom-0 z-[151] w-full md:w-[480px] overflow-y-auto border-l border-white/10 bg-white dark:bg-zinc-900 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-gray-200 dark:border-zinc-800 px-6 py-4">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-[var(--color-accent-cyan)]" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Record Detail</h3>
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 transition-colors"
              aria-label="Close detail drawer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-6 flex flex-col gap-4">
            {fields.map((field) => (
              <div key={field.label} className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/50 p-3">
                <p className="text-xs uppercase tracking-wide text-zinc-500">{field.label}</p>
                <p className={`mt-1 text-sm text-gray-700 dark:text-zinc-200 ${field.mono ? 'font-mono' : ''}`}>
                  {field.value}
                </p>
              </div>
            ))}

            {/* Hash fields with copy */}
            <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Hash</p>
                <button
                  onClick={() => { void handleCopy('hash', record.hash); }}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-[var(--color-accent-cyan)] hover:bg-[var(--color-accent-cyan)]/10 transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  {copied === 'hash' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-zinc-200">{record.hash}</p>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Previous Hash</p>
                <button
                  onClick={() => { void handleCopy('prevHash', record.prevHash); }}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-[var(--color-accent-cyan)] hover:bg-[var(--color-accent-cyan)]/10 transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  {copied === 'prevHash' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-gray-700 dark:text-zinc-200">{record.prevHash}</p>
            </div>

            {/* Full record JSON */}
            <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950/50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-wide text-zinc-500">Full Record (JSON)</p>
                <button
                  onClick={() => { void handleCopy('json', JSON.stringify(record, null, 2)); }}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-[var(--color-accent-cyan)] hover:bg-[var(--color-accent-cyan)]/10 transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  {copied === 'json' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-gray-600 dark:text-zinc-300">
                {JSON.stringify(record, null, 2)}
              </pre>
            </div>
          </div>
        </motion.aside>
      </>
    </AnimatePresence>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

const TABLE_HEADERS = ['Timestamp', 'Actor', 'Action', 'Session', 'Hash'] as const;

export default function AuditPage() {
  const cursorStackRef = useRef<Array<string | null>>([null]);

  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [endpointMissing, setEndpointMissing] = useState(false);
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilterState>(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<AuditExportFormat | null>(null);
  const [latestExport, setLatestExport] = useState<AuditExportResult | null>(null);

  // Chain integrity auto-verify
  const [integrityState, setIntegrityState] = useState<IntegrityState>({
    loading: false,
    chain: null,
    integrity: null,
    error: null,
  });

  // Detail drawer
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);

  // Live tail
  const [liveTail, setLiveTail] = useState(false);
  const latestHashRef = useRef<string | null>(null);

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setEndpointMissing(false);

    const params: FetchAuditLogsParams = {
      ...buildAuditParams(appliedFilters),
      limit: pageSize,
      cursor: page > 1 ? cursorStackRef.current[page - 1] ?? undefined : undefined,
    };

    try {
      const data = await fetchAuditLogs({ ...params, signal });
      setRecords(data.records);
      setTotal(data.total ?? data.count);
      setHasMore(data.pagination?.hasMore ?? false);

      if (data.records.length > 0) {
        latestHashRef.current = data.records[0].hash;
      }

      if (data.pagination?.nextCursor) {
        cursorStackRef.current[page] = data.pagination.nextCursor;
      } else {
        cursorStackRef.current = cursorStackRef.current.slice(0, page);
      }
    } catch (caught: unknown) {
      const err = caught as Error & { statusCode?: number };
      if ((err as DOMException).name === 'AbortError') return;

      if (err.statusCode === 404) {
        setEndpointMissing(true);
        setRecords([]);
        setTotal(0);
        setHasMore(false);
      } else {
        setError(err.message ?? 'Failed to fetch audit logs');
      }
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, page, pageSize]);

  // Fetch data when page/filters change
  useEffect(() => {
    const controller = new AbortController();
    void fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);

  // Chain integrity verification — on load + every 60s
  const verifyChain = useCallback(async () => {
    setIntegrityState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchAuditLogs({ limit: 1, verify: true });
      setIntegrityState({
        loading: false,
        chain: data.chain ?? null,
        integrity: data.integrity ?? null,
        error: null,
      });
    } catch (err) {
      setIntegrityState({
        loading: false,
        chain: null,
        integrity: null,
        error: (err as Error).message ?? 'Verification failed',
      });
    }
  }, []);

  useEffect(() => {
    void verifyChain();
    const interval = setInterval(() => { void verifyChain(); }, INTEGRITY_POLL_MS);
    return () => clearInterval(interval);
  }, [verifyChain]);

  // Live tail — poll every 10s and prepend new entries
  useEffect(() => {
    if (!liveTail || page !== 1) return;

    const interval = setInterval(async () => {
      try {
        const data = await fetchAuditLogs({
          ...buildAuditParams(appliedFilters),
          limit: pageSize,
          reverse: true,
        });
        if (data.records.length === 0) return;

        const topHash = data.records[0].hash;
        if (topHash === latestHashRef.current) return;

        // Find new records by comparing against current set
        const existingHashes = new Set(records.map((r) => r.hash));
        const newRecords = data.records.filter((r) => !existingHashes.has(r.hash));
        if (newRecords.length === 0) return;

        latestHashRef.current = topHash;
        setRecords((prev) => [...newRecords, ...prev]);
        setTotal((prev) => prev + newRecords.length);
      } catch {
        // Silent — live tail is best-effort
      }
    }, LIVE_TAIL_POLL_MS);

    return () => clearInterval(interval);
  }, [liveTail, page, pageSize, appliedFilters, records]);

  const applyFilters = () => {
    const nextFilters = trimFilters(filters);
    const validationError = validateFilters(nextFilters);

    if (validationError) {
      setFilterError(validationError);
      return;
    }

    cursorStackRef.current = [null];
    setFilterError(null);
    setExportError(null);
    setPage(1);
    setAppliedFilters(nextFilters);
  };

  const clearFilters = () => {
    cursorStackRef.current = [null];
    setFilters({ ...EMPTY_FILTERS });
    setAppliedFilters({ ...EMPTY_FILTERS });
    setFilterError(null);
    setExportError(null);
    setPage(1);
  };

  const handleExport = async (format: AuditExportFormat) => {
    setExportingFormat(format);
    setExportError(null);

    try {
      const result = await exportAuditLogs({
        ...buildAuditParams(appliedFilters),
        format,
        verify: true,
      });
      setLatestExport(result);
    } catch (caught: unknown) {
      const err = caught as Error;
      setExportError(err.message ?? `Failed to export audit log as ${format.toUpperCase()}`);
    } finally {
      setExportingFormat(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = hasActiveFilters(appliedFilters);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Audit Trail</h2>
          <p className="mt-1 text-sm text-gray-500">
            Query admin audit events, export CSV or NDJSON, and review chain-integrity metadata.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Live tail toggle */}
          <button
            onClick={() => setLiveTail((prev) => !prev)}
            disabled={page !== 1}
            className={`flex items-center gap-1.5 rounded border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              liveTail
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-700'
            }`}
            aria-label={liveTail ? 'Pause live tail' : 'Start live tail'}
            title={page !== 1 ? 'Live tail only works on page 1' : undefined}
          >
            {liveTail ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {liveTail ? 'LIVE' : 'Follow'}
          </button>
          <button
            onClick={() => { void fetchData(); }}
            disabled={loading}
            className="flex items-center gap-1.5 rounded border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-2 text-xs font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => { void handleExport('csv'); }}
            disabled={loading || exportingFormat !== null}
            className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-zinc-200 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-50"
            aria-label="Export CSV"
          >
            <Download className="h-3.5 w-3.5" />
            {exportingFormat === 'csv' ? 'Exporting CSV…' : 'Export CSV'}
          </button>
          <button
            onClick={() => { void handleExport('ndjson'); }}
            disabled={loading || exportingFormat !== null}
            className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-zinc-200 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-50"
            aria-label="Export NDJSON"
          >
            <Download className="h-3.5 w-3.5" />
            {exportingFormat === 'ndjson' ? 'Exporting NDJSON…' : 'Export NDJSON'}
          </button>
        </div>
      </div>

      {/* Chain integrity badge */}
      <ChainIntegrityBadge state={integrityState} />

      <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-4 w-4 text-gray-500 dark:text-zinc-400" />
          <span className="text-sm font-medium text-gray-600 dark:text-zinc-300">Filters</span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="flex flex-col gap-1">
            <label htmlFor="audit-filter-actor" className="text-xs text-zinc-500">Actor</label>
            <input
              id="audit-filter-actor"
              type="text"
              placeholder="e.g. admin-key"
              value={filters.actor}
              onChange={(event) => setFilters((current) => ({ ...current, actor: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="audit-filter-action" className="text-xs text-zinc-500">Action</label>
            <input
              id="audit-filter-action"
              type="text"
              list="audit-action-suggestions"
              placeholder="e.g. session.kill"
              value={filters.action}
              onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
            <datalist id="audit-action-suggestions">
              {ACTION_SUGGESTIONS.map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="audit-filter-session" className="text-xs text-zinc-500">Session ID</label>
            <input
              id="audit-filter-session"
              type="text"
              placeholder="e.g. 11111111-1111-1111-1111-111111111111"
              value={filters.sessionId}
              onChange={(event) => setFilters((current) => ({ ...current, sessionId: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-600 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="audit-filter-from" className="text-xs text-zinc-500">From</label>
            <input
              id="audit-filter-from"
              type="datetime-local"
              value={filters.from}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="audit-filter-to" className="text-xs text-zinc-500">To</label>
            <input
              id="audit-filter-to"
              type="datetime-local"
              value={filters.to}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
              className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm text-gray-900 dark:text-zinc-100 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
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
          <p className="text-xs text-zinc-500">
            CSV and NDJSON exports use the currently applied filters.
          </p>
        </div>

        {filterError ? (
          <p className="mt-3 text-xs text-rose-400">{filterError}</p>
        ) : null}
        {exportError ? (
          <p className="mt-3 text-xs text-rose-400">{exportError}</p>
        ) : null}
      </div>

      {latestExport ? <ExportMetadataCard result={latestExport} /> : null}

      {endpointMissing ? (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-[var(--color-surface)] p-12 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
          <p className="font-medium text-zinc-400">Audit endpoint not available yet</p>
          <p className="mt-1 text-xs text-zinc-600">
            The /v1/audit endpoint has not been implemented on the server.
          </p>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-500" />
          <p className="font-medium text-red-400">Failed to load audit logs</p>
          <p className="mt-1 text-xs text-zinc-500">{error}</p>
          <button
            onClick={() => { void fetchData(); }}
            className="mt-4 rounded border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-800">
                {TABLE_HEADERS.map((h) => (
                  <th scope="col" key={h} className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SkeletonRows count={Math.min(pageSize, 5)} />
            </tbody>
          </table>
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-800 bg-[var(--color-surface)] p-12 text-center">
          <EmptyState
            icon={<SearchX className="h-10 w-10" />}
            title="No audit records found"
            description="Audit logs will appear here when actions are performed."
          />
          <p className="mt-1 text-xs text-zinc-600">
            {hasFilters ? 'Try adjusting your filters.' : 'Audit records will appear here once actions are performed.'}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-800">
                  {TABLE_HEADERS.map((h) => (
                    <th scope="col" key={h} className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-zinc-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody aria-live="polite" aria-atomic="false">
                {records.map((record, index) => (
                  <AuditRow
                    key={record.hash}
                    record={record}
                    index={index}
                    onClick={() => setSelectedRecord(record)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <span>{total} record{total !== 1 ? 's' : ''}</span>
              <span className="text-zinc-700">|</span>
              <label htmlFor="audit-page-size" className="sr-only">Page size</label>
              <select
                id="audit-page-size"
                value={pageSize}
                onChange={(event) => {
                  cursorStackRef.current = [null];
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-600 dark:text-zinc-300 focus:border-[var(--color-accent-cyan)]/50 focus:outline-none"
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
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex items-center rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPage((current) => current + 1)}
                disabled={!hasMore || page >= totalPages}
                className="inline-flex items-center rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-xs text-gray-600 dark:text-zinc-300 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Detail drawer */}
      <AnimatePresence>
        {selectedRecord && (
          <DetailDrawer
            key="audit-detail-drawer"
            record={selectedRecord}
            onClose={() => setSelectedRecord(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
