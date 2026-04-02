/**
 * pages/PipelinesPage.tsx — Pipeline list with metrics and create action.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { getPipelines } from '../api/client';
import type { PipelineInfo } from '../api/client';
import { useToastStore } from '../store/useToastStore';
import { formatTimeAgo } from '../utils/format';
import MetricCard from '../components/overview/MetricCard';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';
import CreatePipelineModal from '../components/CreatePipelineModal';

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const addToast = useToastStore((t) => t.addToast);

  const fetchPipelines = useCallback(async () => {
    try {
      const data = await getPipelines();
      setPipelines(data);
    } catch (e: unknown) {
      addToast('error', 'Failed to fetch pipelines', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchPipelines();
    const interval = setInterval(fetchPipelines, 5_000);
    return () => clearInterval(interval);
  }, [fetchPipelines]);

  const counts = {
    total: pipelines.length,
    running: pipelines.filter((p) => p.status === 'running').length,
    completed: pipelines.filter((p) => p.status === 'completed').length,
    failed: pipelines.filter((p) => p.status === 'failed').length,
  };

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
          <h2 className="text-2xl font-bold text-gray-100">Pipelines</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage and monitor session pipelines
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Pipeline
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
      {pipelines.length === 0 ? (
        <div className="rounded-lg border border-void-lighter bg-[#111118] p-12 text-center">
          <p className="text-gray-500">No pipelines yet</p>
          <p className="mt-1 text-xs text-gray-600">Create a pipeline to run sessions in sequence</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <Link
              key={pipeline.id}
              to={`/pipelines/${pipeline.id}`}
              className="block rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 hover:border-[#00e5ff]/30 transition-colors"
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
