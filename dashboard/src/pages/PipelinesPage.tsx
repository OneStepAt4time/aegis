/**
 * pages/PipelinesPage.tsx — Pipeline list with metrics and create action.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Plus, GitBranch, Sparkles } from 'lucide-react';
import EmptyState from '../components/shared/EmptyState';
import { getPipelines } from '../api/client';
import type { PipelineInfo } from '../api/client';
import { useStore } from '../store/useStore';
import { useT } from '../i18n/context';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import MetricCard from '../components/overview/MetricCard';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';
import CreatePipelineModal from '../components/CreatePipelineModal';
import { useIdleTips } from '../hooks/useIdleTips';
import { IdleTip } from '../components/shared/IdleTip';

const BASE_POLL_INTERVAL_MS = 10_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 60_000;
const DEMO_TAG_KEY = 'aegis:demo-pipelines';
const DEMO_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Mock demo pipelines
const DEMO_PIPELINES: PipelineInfo[] = [
  {
    id: 'demo-ci-cd',
    name: 'CI/CD Pipeline',
    status: 'completed',
    stages: [
      { name: 'Build', status: 'completed', sessionId: 'demo-s1' },
      { name: 'Test', status: 'completed', sessionId: 'demo-s2' },
      { name: 'Deploy', status: 'completed', sessionId: 'demo-s3' },
    ],
    createdAt: Date.now() - 3600000,
  },
  {
    id: 'demo-data-etl',
    name: 'Data ETL',
    status: 'running',
    stages: [
      { name: 'Extract', status: 'completed', sessionId: 'demo-s4' },
      { name: 'Transform', status: 'running', sessionId: 'demo-s5' },
    ],
    createdAt: Date.now() - 7200000,
  },
  {
    id: 'demo-security',
    name: 'Security Scan',
    status: 'pending',
    stages: [
      { name: 'Scan', status: 'pending' },
    ],
    createdAt: Date.now() - 1800000,
  },
];

function getDemoPipelines(): PipelineInfo[] {
  try {
    const stored = localStorage.getItem(DEMO_TAG_KEY);
    if (!stored) return [];
    
    const { timestamp } = JSON.parse(stored);
    const age = Date.now() - timestamp;
    
    if (age > DEMO_EXPIRY_MS) {
      localStorage.removeItem(DEMO_TAG_KEY);
      return [];
    }
    
    return DEMO_PIPELINES;
  } catch {
    return [];
  }
}

function setDemoPipelines(): void {
  try {
    localStorage.setItem(DEMO_TAG_KEY, JSON.stringify({ timestamp: Date.now() }));
    if (import.meta.env.DEV) console.info('[aegis] Demo pipelines created (auto-expire in 24h)');
  } catch {
    // Ignore storage errors
  }
}

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const t = useT();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name'|'createdAt'|'status'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const sseConnected = useStore((s) => s.sseConnected);
  const addToast = useToastStore((t) => t.addToast);

  // Demo pipelines state
  const demoPipelines = useMemo(() => getDemoPipelines(), [pipelines.length]);
  const allPipelines = useMemo(() => [...pipelines, ...demoPipelines], [pipelines, demoPipelines]);

  // Idle tips for empty state
  const { showTip, currentTip } = useIdleTips({
    tips: [
      'Run `ag create \'task\'` to start a session',
      'Press ⌘N to open the new session drawer',
      'Create a pipeline to automate multi-step workflows',
    ],
  });

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
    total: allPipelines.length,
    running: allPipelines.filter((p) => p.status === 'running').length,
    completed: allPipelines.filter((p) => p.status === 'completed').length,
    failed: allPipelines.filter((p) => p.status === 'failed').length,
  };

  const filteredPipelines = allPipelines
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

  function handleSurpriseMe() {
    setDemoPipelines();
    setPipelines([...pipelines]); // Trigger re-render
    addToast('success', 'Demo pipelines created', 'Three example pipelines added (auto-expire in 24h)');
  }

  const isEmpty = pipelines.length === 0 && demoPipelines.length === 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500 text-sm" role="status" aria-busy="true">
        <div className="animate-pulse">{t("pipelines.loading")}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("pipelines.title")}</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage and monitor session pipelines
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[var(--color-accent-cyan)]/10 hover:bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)] border border-[var(--color-accent-cyan)]/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Pipeline
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder={t("pipelines.searchPlaceholder")} aria-label="Search pipelines"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="min-h-[44px] flex-1 min-w-[200px] px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--color-accent-cyan)]"
        />
        <select aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="min-h-[44px] px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
        >
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <select aria-label="Sort by"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'name'|'createdAt'|'status')}
          className="min-h-[44px] px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 focus:outline-none focus:border-[var(--color-accent-cyan)]"
        >
          <option value="createdAt">Date</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
        </select>
        <button
          onClick={() => setSortAsc(!sortAsc)}
          className="min-h-[44px] min-w-[44px] px-3 py-2 text-sm rounded border border-[var(--color-void-lighter)] bg-[var(--color-surface)] text-gray-200 hover:border-[var(--color-accent-cyan)]/50 transition-colors"
          aria-label={sortAsc ? 'Sort ascending' : 'Sort descending'}
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
      {(allPipelines.length === 0 || filteredPipelines.length === 0) && (loadError || searchQuery || statusFilter !== 'all') ? (
        <EmptyState
          variant="empty-error"
          icon={<GitBranch className="h-8 w-8" />}
          title="Unable to load pipelines"
          description={loadError || 'Try adjusting your filters'}
        />
      ) : isEmpty ? (
        <div className="space-y-4">
          <EmptyState
            icon={<GitBranch className="h-8 w-8" />}
            title="No pipelines yet"
            description="Create a pipeline to automate session workflows."
            action={
              <button
                type="button"
                onClick={handleSurpriseMe}
                className="inline-flex min-h-[44px] items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 text-sm font-medium text-[var(--color-accent-cyan)] transition-colors hover:bg-[var(--color-accent-cyan)]/20"
              >
                <Sparkles className="h-4 w-4" />
                Surprise me
              </button>
            }
          />
          {showTip && (
            <div className="flex justify-center">
              <IdleTip show={showTip} tip={currentTip} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPipelines.map((pipeline) => (
            <Link
              key={pipeline.id}
              to={`/pipelines/${pipeline.id}`}
              className="block rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent-cyan)]/30 transition-colors"
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
