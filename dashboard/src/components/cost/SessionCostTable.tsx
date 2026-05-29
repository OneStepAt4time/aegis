/**
 * components/cost/SessionCostTable.tsx
 *
 * Per-session cost breakdown table showing session name, model,
 * tokens, estimated cost, and duration. Fetches cost data on-demand
 * from /v1/sessions/:id/cost.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, ArrowUpDown } from 'lucide-react';
import type { SessionInfo } from '../../types';
import type { SessionCostEntry } from '../../types';
import { getSessionCost } from '../../api/client';
import { useT } from '../../i18n/context';

type SortKey = 'cost' | 'tokens' | 'duration' | 'name' | 'date';

interface SessionCostRow {
  session: SessionInfo;
  cost: SessionCostEntry | null;
  loading: boolean;
}

interface SessionCostTableProps {
  sessions: SessionInfo[];
  /** Maximum concurrent cost fetch requests */
  concurrency?: number;
}

function formatUsd(n: number): string {
  if (n < 0.01) return '$0.00';
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function SessionCostTable({ sessions, concurrency = 5 }: SessionCostTableProps) {
  const t = useT();
  const [rows, setRows] = useState<SessionCostRow[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('cost');
  const [sortAsc, setSortAsc] = useState(false);

  // Build initial rows with loading state
  useEffect(() => {
    setRows(sessions.map((session) => ({ session, cost: null, loading: true })));
  }, [sessions]);

  // Derive a stable session ID list to prevent unnecessary refetches
  const sessionIds = sessions.map(s => s.id).join(",");
  // Fetch costs for all sessions with concurrency limit
  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const results = new Map<string, SessionCostEntry | null>();

      // Process in batches
      for (let i = 0; i < sessions.length; i += concurrency) {
        if (cancelled) return;
        const batch = sessions.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
          batch.map(async (s) => {
            const cost = await getSessionCost(s.id);
            return { id: s.id, cost };
          })
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.set(result.value.id, result.value.cost);
          }
        }

        // Update rows with fetched data
        setRows((prev) =>
          prev.map((row) => {
            const cost = results.get(row.session.id);
            if (cost !== undefined) {
              return { ...row, cost, loading: false };
            }
            return row;
          })
        );
      }
    }

    void fetchAll();
    return () => { cancelled = true; };
  }, [sessionIds, concurrency]);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }, [sortKey]);

  const sorted = [...rows].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case 'cost':
        return dir * ((a.cost?.estimatedCostUsd ?? 0) - (b.cost?.estimatedCostUsd ?? 0));
      case 'tokens': {
        const aTokens = (a.cost?.totalInputTokens ?? 0) + (a.cost?.totalOutputTokens ?? 0);
        const bTokens = (b.cost?.totalInputTokens ?? 0) + (b.cost?.totalOutputTokens ?? 0);
        return dir * (aTokens - bTokens);
      }
      case 'duration':
        return dir * ((a.cost?.durationMinutes ?? 0) - (b.cost?.durationMinutes ?? 0));
      case 'name':
        return dir * a.session.displayName.localeCompare(b.session.displayName);
      case 'date':
        return dir * (a.session.lastActivity - b.session.lastActivity);
      default:
        return 0;
    }
  });

  // Aggregate stats
  const totalCost = rows.reduce((s, r) => s + (r.cost?.estimatedCostUsd ?? 0), 0);
  const totalSessions = sessions.length;
  const loadedCount = rows.filter((r) => !r.loading).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header with stats */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Session Cost Breakdown
        </h3>
        <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <span>{totalSessions} sessions</span>
          <span>Total: {formatUsd(totalCost)}</span>
          {loadedCount < totalSessions && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading costs...
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-void)]/50"
        role="table"
        aria-label={t('aria.sessionCostBreakdownTable')}
        tabIndex={0}
      >
        {/* Header row */}
        <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-void-lighter)]" role="row">
          <div className="flex-1 min-w-[120px]" role="columnheader">
            <button type="button" onClick={() => handleSort('name')} className="flex items-center gap-1 hover:text-[var(--color-text-primary)] transition-colors" aria-label={t('aria.sortBySessionName')}>
              Session <ArrowUpDown className="h-3 w-3" />
            </button>
          </div>
          <div className="w-20 hidden sm:block" role="columnheader">{t('costTable.model')}</div>
          <div className="w-24 hidden md:block text-right" role="columnheader">
            <button type="button" onClick={() => handleSort('tokens')} className="inline-flex items-center gap-1 ml-auto hover:text-[var(--color-text-primary)] transition-colors" aria-label={t('aria.sortByTotalTokens')}>
              Tokens <ArrowUpDown className="h-3 w-3" />
            </button>
          </div>
          <div className="w-20 text-right" role="columnheader">
            <button type="button" onClick={() => handleSort('cost')} className="inline-flex items-center gap-1 ml-auto hover:text-[var(--color-text-primary)] transition-colors" aria-label={t('aria.sortByCost')}>
              Cost <ArrowUpDown className="h-3 w-3" />
            </button>
          </div>
          <div className="w-20 hidden md:block text-right" role="columnheader">
            <button type="button" onClick={() => handleSort('duration')} className="inline-flex items-center gap-1 ml-auto hover:text-[var(--color-text-primary)] transition-colors" aria-label={t('aria.sortByDuration')}>
              Duration <ArrowUpDown className="h-3 w-3" />
            </button>
          </div>
          <div className="w-20 hidden lg:block text-right" role="columnheader">{t('costTable.cacheHit')}</div>
        </div>

        {/* Rows */}
        {sorted.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
            No sessions found
          </div>
        )}

        {sorted.map((row) => (
          <div
            key={row.session.id}
            className="flex items-center gap-2 px-3 py-2 text-xs border-b border-[var(--color-void-lighter)]/50 last:border-b-0 hover:bg-[var(--color-surface-hover)] transition-colors"
            role="row"
          >
            {/* Session name */}
            <div className="flex-1 min-w-[120px] truncate text-[var(--color-text-primary)] font-mono" role="cell" title={row.session.displayName}>
              {row.session.displayName}
            </div>

            {/* Model */}
            <div className="w-20 hidden sm:block text-[var(--color-text-muted)] truncate" role="cell" title={row.cost?.model ?? row.session.model ?? '—'}>
              {row.loading ? '—' : (row.cost?.model ?? row.session.model ?? '—')}
            </div>

            {/* Tokens */}
            <div className="w-24 hidden md:block text-right font-mono text-[var(--color-text-muted)]" role="cell">
              {row.loading ? '—' : formatTokens(
                (row.cost?.totalInputTokens ?? 0) + (row.cost?.totalOutputTokens ?? 0)
              )}
            </div>

            {/* Cost */}
            <div className="w-20 text-right font-mono font-medium text-[var(--color-text-primary)]" role="cell">
              {row.loading ? (
                <Loader2 className="h-3 w-3 animate-spin inline-block" />
              ) : (
                formatUsd(row.cost?.estimatedCostUsd ?? 0)
              )}
            </div>

            {/* Duration */}
            <div className="w-20 hidden md:block text-right text-[var(--color-text-muted)]" role="cell">
              {row.loading ? '—' : formatDuration(row.cost?.durationMinutes ?? null)}
            </div>

            {/* Cache hit */}
            <div className="w-20 hidden lg:block text-right text-[var(--color-text-muted)]" role="cell">
              {row.loading ? '—' : (
                row.cost ? `${(row.cost.cacheHitRate * 100).toFixed(0)}%` : '—'
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
