/**
 * pages/PipelineDetailPage.tsx — Pipeline detail with session step table.
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPipeline } from '../api/client';
import type { PipelineInfo } from '../api/client';
import type { UIState } from '../types';
import { useStore } from '../store/useStore';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';
import StatusDot from '../components/overview/StatusDot';

const BASE_POLL_INTERVAL_MS = 3_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_INTERVAL_MS = 60_000;

const VALID_UI_STATES: ReadonlySet<string> = new Set([
  'idle', 'working', 'compacting', 'context_warning',
  'waiting_for_input', 'permission_prompt', 'plan_mode',
  'ask_question', 'bash_approval', 'settings', 'error', 'unknown',
] as const);

/**
 * Maps an arbitrary status string to a valid UIState.
 * Returns the status if valid, otherwise defaults to 'unknown'.
 */
function toUIState(status: string): UIState {
  return VALID_UI_STATES.has(status) ? (status as UIState) : 'unknown';
}

export default function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [pipeline, setPipeline] = useState<PipelineInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const sseConnected = useStore((s) => s.sseConnected);
  const addToast = useToastStore((t) => t.addToast);

  const fetchPipeline = useCallback(async (): Promise<boolean> => {
    if (!id) return false;
    try {
      const data = await getPipeline(id);
      setPipeline(data);
      setNotFound(false);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && 'statusCode' in e && (e as Error & { statusCode: number }).statusCode === 404) {
        setNotFound(true);
      } else {
        addToast('error', 'Failed to fetch pipeline', e instanceof Error ? e.message : undefined);
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let consecutiveErrors = 0;

    const scheduleNextPoll = async () => {
      if (cancelled) return;

      const isSuccessful = await fetchPipeline();
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
  }, [fetchPipeline, sseConnected]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-gray-500 text-sm">
        <div className="animate-pulse">Loading pipeline…</div>
      </div>
    );
  }

  if (notFound || !pipeline) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-gray-500">
        <div className="text-6xl mb-4">404</div>
        <div className="text-lg mb-6 text-gray-200">Pipeline not found</div>
        <Link to="/pipelines" className="text-sm text-[var(--color-accent-cyan)] hover:underline">
          ← Back to Pipelines
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <nav className="text-xs text-gray-500 flex items-center gap-1">
        <Link to="/pipelines" className="hover:text-[var(--color-accent-cyan)] transition-colors">
          Pipelines
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-200 truncate max-w-xs">
          {pipeline.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pipeline.name}</h2>
          <PipelineStatusBadge status={pipeline.status} />
        </div>
        <div className="text-xs text-gray-500">
          Created {formatTimeAgo(pipeline.createdAt)}
        </div>
      </div>

      {/* Steps Table */}
      <div className="rounded-lg border border-void-lighter bg-[var(--color-surface)]">
        <div className="px-4 py-3 border-b border-void-lighter">
          <h3 className="text-sm font-semibold text-gray-200">
            Steps ({pipeline.stages.length})
          </h3>
        </div>
        {pipeline.stages.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No steps yet
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-void-lighter text-gray-600">
                <th className="px-4 py-3 font-medium w-16">#</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Session</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.stages.map((stage, i) => (
                <tr
                  key={stage.name}
                  className="border-b border-void-lighter/50 transition-colors hover:border-l-2 hover:border-l-cyan"
                >
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    #{i + 1}
                  </td>
                  <td className="px-4 py-3">
                    <StatusDot status={toUIState(stage.status)} />
                  </td>
                  <td className="px-4 py-3">
                    {stage.sessionId ? (
                      <Link
                        to={`/sessions/${encodeURIComponent(stage.sessionId)}`}
                        className="font-medium text-gray-200 hover:text-cyan transition-colors"
                      >
                        {stage.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-gray-200">{stage.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">
                    {stage.sessionId ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
