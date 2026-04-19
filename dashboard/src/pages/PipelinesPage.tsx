/**
 * pages/PipelinesPage.tsx — Pipeline list with metrics and create action.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, GitBranch } from 'lucide-react';
import EmptyState from '../components/shared/EmptyState';
import { getPipelines } from '../api/client';
import type { PipelineInfo } from '../api/client';
import { useStore } from '../store/useStore';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import MetricCard from '../components/overview/MetricCard';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';
import CreatePipelineModal from '../components/CreatePipelineModal';

const BASE_POLL_INTERVAL_MS = 10_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 60_000;

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name'|'createdAt'|'status'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const sseConnected = useStore((s) => s.sseConnected);
  const addToast = useToastStore((t) => t.addToast);

  const fetchPipelines = useCallback(async (): Promise<boolean> => {
    try {
      const data = await getPipelines();
      setPipelines(data);
      setLoadError(null);
      return true;
    } catch (e: unknown) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      const message = e instanceof Error ? e.message : undefined;
      const displayMessage = statusCode === 429
        ? 'Rate limit reached. Retrying automatically.'
        : (message ?? 'Unable to load pipelines');
      setLoadError(displayMessage);
      addToast('error', 'Failed to fetch pipelines', displayMessage);
      return false;
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let consecutiveErrors = 0;

    const scheduleNextPoll = async () => {
      if (cancelled) return;

      const isSuccessful = await fetchPipelines();
      if (cancelled) return;

      const baseDelayMs = sseConnected ? SSE_HEALTHY_POLL_INTERVAL_MS : BASE_POLL_INTERVAL_MS;
      let nextDelayMs = baseDelayMs;

      if (isSuccessful) {
        consecutiveErrors = 0;
      } else {
        consecutiveErrors += 1;
        const backoffFactor = 2 ** consecutiveErrors;
        nextDelayMs = Math.min(baseDelayMs * backoffFactor, MAX_POLL_INTERVAL_MS);
      }

      timeoutId = setTimeout(() => {
        void scheduleNextPoll();
      }, nextDelayMs);
    };

    void scheduleNextPoll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [fetchPipelines, sseConnected]);

  const counts = {
    total: pipelines.length,
    running: pipelines.filter((p) => p.status === 'running').length,
    completed: pipelines.filter((p) => p.status === 'completed').length,
    failed: pipelines.filter((p) => p.status === 'failed').length,
  };

  const filteredPipelines = pipelines
    .filter((p) => {
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'createdAt') cmp = a.createdAt - b.createdAt;
      else cmp = a.status.localeCompare(b.status);
      return sortAsc ? cmp : -cmp;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500 text-sm">
        <div className="animate-pulse">Loading pipelines…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-900 dark:text-gray-100">Pipelines</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage and monitor session pipelines
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[var(--color-accent-cyan)]]/10 hover:bg-[var(--color-accent-cyan)]]/20 text-[var(--color-accent-cyan)]] border border-[var(--color-accent-cyan)]]/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Pipeline
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search pipelines..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
        >
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'name'|'createdAt'|'status')}
          className="px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
        >
          <option value="createdAt">Date</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
        </select>
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 hover:border-[var(--color-accent-cyan)]/50 transition-colors"
          title={sortAsc ? 'Ascending' : 'Descending'}
        >
          {sortAsc ? '↑' : '↓'}
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total" value={counts.total} />
        <MetricCard label="Running" value={counts.running} />
        <MetricCard label="Completed" value={counts.completed} />
        <MetricCard label="Failed" value={counts.failed} />
      </div>

      {/* Pipeline List */}
      {(pipelines.length === 0 || filteredPipelines.length === 0) && (loadError || searchQuery || statusFilter !== 'all') ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-950/20 p-12 text-center">
          <p className="text-amber-200">Unable to load pipelines</p>
          <p className="mt-1 text-xs text-amber-300/90">{loadError}</p>
        </div>
      ) : pipelines.length === 0 ? (
        <div className="rounded-lg border border-void-lighter bg-[var(--color-surface)]] p-12 text-center">
          <EmptyState
            icon={<GitBranch className="h-8 w-8" />}
            title={searchQuery || statusFilter !== 'all' ? 'No matching pipelines' : 'No pipelines yet'}
            description={searchQuery || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Create a pipeline to automate session workflows.'}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPipelines.map((pipeline) => (
            <Link
              key={pipeline.id}
              to={`/pipelines/${pipeline.id}`}
              className="block rounded-lg border border-[var(--color-void-lighter)]] bg-[var(--color-surface)]] p-4 hover:border-[var(--color-accent-cyan)]]/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-gray-200 truncate">
                    {pipeline.name}
                  </span>
                  <PipelineStatusBadge status={pipeline.status} />
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0 ml-4">
                  <span>{pipeline.stages.length} step{pipeline.stages.length !== 1 ? 's' : ''}</span>
                  <span>{formatTimeAgo(pipeline.createdAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreatePipelineModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
