/**
 * components/overview/MetricCards.tsx — Grid of metric cards with fallback polling.
 */

import { useCallback, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  GitBranch,
  Layers,
  Layers3,
  Send,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import { getHealth, getMetrics } from '../../api/client';
import { useSseAwarePolling } from '../../hooks/useSseAwarePolling';
import { useStore } from '../../store/useStore';
import type { HealthResponse } from '../../types';
import MetricCard from './MetricCard';
import RealtimeBadge from './RealtimeBadge';
import { RingGauge } from '../shared/RingGauge';

function getErrorMessage(prefix: string, error: unknown): string {
  return error instanceof Error && error.message
    ? `${prefix}: ${error.message}`
    : prefix;
}

const FALLBACK_POLL_INTERVAL_MS = 10_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;

export default function MetricCards() {
  const metrics = useStore((s) => s.metrics);
  const latestActivity = useStore((s) => s.activities[0] ?? null);
  const sseConnected = useStore((s) => s.sseConnected);
  const sseError = useStore((s) => s.sseError);
  const setMetrics = useStore((s) => s.setMetrics);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const [metricsResult, healthResult] = await Promise.allSettled([getMetrics(), getHealth()]);

    if (metricsResult.status === 'fulfilled') {
      setMetrics(metricsResult.value);
    }

    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
    }

    if (metricsResult.status === 'rejected' && healthResult.status === 'rejected') {
      setLoadError(getErrorMessage('Unable to load overview metrics', metricsResult.reason));
    } else if (metricsResult.status === 'rejected') {
      setLoadError(getErrorMessage('Detailed metrics unavailable. Showing health-based totals', metricsResult.reason));
    } else {
      setLoadError(null);
    }

    setIsLoading(false);
  }, [setMetrics]);

  useSseAwarePolling({
    refresh: fetchData,
    sseConnected,
    eventTrigger: latestActivity,
    fallbackPollIntervalMs: FALLBACK_POLL_INTERVAL_MS,
    healthyPollIntervalMs: SSE_HEALTHY_POLL_INTERVAL_MS,
  });

  if (isLoading && !metrics && !health) {
    return (
      <div className="rounded-lg border border-void-lighter bg-[var(--color-surface)] p-6 text-sm text-gray-400">
        Loading overview metrics...
      </div>
    );
  }

  if (loadError && !metrics && !health) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-200">
        {loadError}
      </div>
    );
  }

  const m = metrics;
  const completedSessions = m?.sessions.completed ?? 0;
  const failedSessions = m?.sessions.failed ?? 0;
  const deliveryRate = m?.prompt_delivery.success_rate;
  const deliveryRate_ = deliveryRate ?? null;
  const promptsDelivered = m?.prompt_delivery.delivered ?? 0;
  const promptsFailed = m?.prompt_delivery.failed ?? 0;
  const promptsSent = m?.prompt_delivery.sent ?? 0;
  const hookLatency = m?.latency?.hook_latency_ms.avg ?? null;
  const permissionLatency = m?.latency?.permission_response_ms.avg ?? null;
  const channelLatency = m?.latency?.channel_delivery_ms.avg ?? null;
  const webhooksSent = m?.webhooks_sent ?? 0;
  const webhooksFailed = m?.webhooks_failed ?? 0;
  const autoApprovals = m?.auto_approvals ?? 0;
  const pipelinesCreated = m?.pipelines_created ?? 0;
  const batchesCreated = m?.batches_created ?? 0;
  const screenshotsTaken = m?.screenshots_taken ?? 0;

  // Cost & token fields — read dynamically so we don't modify the GlobalMetrics type
  const raw = m as Record<string, unknown> | null;
  const totalEstimatedCostUsd = (raw?.['totalEstimatedCostUsd'] as number) ?? 0;
  const totalInputTokens = (raw?.['totalInputTokens'] as number) ?? 0;
  const totalOutputTokens = (raw?.['totalOutputTokens'] as number) ?? 0;
  const totalTokens = totalInputTokens + totalOutputTokens;

  const formatLatency = (value: number | null): string => (value === null ? '—' : `${Math.round(value)} ms`);

  const deliveryColor = deliveryRate_ === null ? 'blue' : deliveryRate_ >= 99 ? 'green' : deliveryRate_ >= 90 ? 'amber' : 'red';

  const showStatusRow = Boolean(loadError) || Boolean(!sseConnected && sseError);

  return (
    <div className="space-y-3">
      {showStatusRow && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-void-lighter bg-[var(--color-surface)] px-4 py-3"
        >
          <div className="text-xs text-gray-400">{loadError ?? 'Overview widgets are using the latest available data.'}</div>
          {!sseConnected && sseError && <RealtimeBadge mode="polling" message={sseError} />}
        </div>
      )}

      {/* ── Header ─────────────────────── */}
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1">Operational Metrics</h4>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* ── Operational Metrics ──────────────────────────────── */}
      {completedSessions > 0 && (
        <MetricCard
          label="Completed"
          value={completedSessions}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="green"
        />
      )}
      {failedSessions > 0 && (
        <div className="card-glass card-glass-interactive animate-bento-reveal p-5 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-slate-400 font-medium">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            Failed Sessions
          </div>
          <p className="font-mono text-2xl text-red-400 font-bold">{failedSessions}</p>
          <NavLink
            to="/audit"
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            View Error Logs
          </NavLink>
        </div>
      )}


      {/* ── Prompt Delivery ──────────────────────────────── */}
      <div className="col-span-2 lg:col-span-4 card-glass card-glass-interactive animate-bento-reveal p-5 flex flex-col">
        <div className="mb-1 flex items-center gap-2 text-sm text-slate-400 font-medium">
          <Zap className="h-4 w-4" />
          Delivery Rate
        </div>
        <div className="flex items-center gap-6 flex-1">
          <RingGauge
            value={deliveryRate_ !== null ? Math.round(deliveryRate_) : 0}
            size={110}
            label="Success"
            primaryColor={deliveryColor === 'green' ? 'var(--color-success)' : deliveryColor === 'red' ? 'var(--color-error)' : 'var(--color-warning)'}
          />
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-2xl font-mono font-bold text-white">
                {deliveryRate_ !== null ? `${deliveryRate_.toFixed(1)}%` : '—'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Trailing session average</p>
            </div>
            {(promptsDelivered > 0 || promptsFailed > 0) && (
              <div className="flex gap-4">
                {promptsDelivered > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-emerald-400">{promptsDelivered}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Delivered</p>
                  </div>
                )}
                {promptsFailed > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-red-400">{promptsFailed}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Failed</p>
                  </div>
                )}
                {promptsSent > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-300">{promptsSent}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">Total Sent</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {promptsDelivered > 0 && (
        <MetricCard
          label="Prompts Delivered"
          value={promptsDelivered}
          subLabel={promptsSent > 0 ? `${promptsSent} sent total` : undefined}
          icon={<Send className="h-4 w-4" />}
          color="green"
          className="col-span-1 lg:col-span-2"
        />
      )}
      {promptsFailed > 0 && (
        <MetricCard
          label="Prompts Failed"
          value={promptsFailed}
          icon={<XCircle className="h-4 w-4" />}
          color="red"
          className="col-span-1 lg:col-span-2"
        />
      )}

      {/* ── Webhooks ─────────────────────────────────────── */}
      {webhooksSent > 0 && (
        <MetricCard
          label="Webhooks Sent"
          value={webhooksSent}
          icon={<Send className="h-4 w-4" />}
          color="green"
          subLabel={webhooksFailed > 0 ? `${webhooksFailed} failed` : '0 failed'}
          className="col-span-2"
        />
      )}
      {webhooksFailed > 0 && webhooksSent === 0 && (
        <MetricCard
          label="Webhooks Failed"
          value={webhooksFailed}
          icon={<XCircle className="h-4 w-4" />}
          color="red"
        />
      )}

      {/* ── Auto-Approvals ───────────────────────────────── */}
      {autoApprovals > 0 && (
        <MetricCard
          label="Auto-Approvals"
          value={autoApprovals}
          icon={<ShieldCheck className="h-4 w-4" />}
          color="purple"
        />
      )}

      {/* ── Pipelines & Batches ──────────────────────────── */}
      {pipelinesCreated > 0 && (
        <MetricCard
          label="Pipelines Created"
          value={pipelinesCreated}
          icon={<GitBranch className="h-4 w-4" />}
          color="purple"
        />
      )}
      {batchesCreated > 0 && (
        <MetricCard
          label="Batches Created"
          value={batchesCreated}
          icon={<Layers3 className="h-4 w-4" />}
          color="purple"
        />
      )}

      {/* ── Screenshots ──────────────────────────────────── */}
      {screenshotsTaken > 0 && (
        <MetricCard
          label="Screenshots"
          value={screenshotsTaken}
          icon={<Camera className="h-4 w-4" />}
        />
      )}

      {/* ── Latency ──────────────────────────────────────── */}
      <MetricCard
        label="Avg Hook Latency"
        value={formatLatency(hookLatency)}
        icon={<Clock className="h-4 w-4" />}
        className="col-span-1 lg:col-span-2"
      />
      <MetricCard
        label="Avg Permission Latency"
        value={formatLatency(permissionLatency)}
        icon={<Clock className="h-4 w-4" />}
        className="col-span-1 lg:col-span-2"
      />
      <MetricCard
        label="Avg Channel Latency"
        value={formatLatency(channelLatency)}
        icon={<Clock className="h-4 w-4" />}
        className="col-span-2 lg:col-span-2"  />

      {/* ── Removed Uptime ───────────────────────────────── */}      {/* ── Cost & Tokens (shown when API provides them) ── */}
      {totalEstimatedCostUsd > 0 && (
        <MetricCard
          label="Total Est. Cost"
          value={`$${totalEstimatedCostUsd < 1 ? totalEstimatedCostUsd.toFixed(3) : totalEstimatedCostUsd.toFixed(2)}`}
          icon={<DollarSign className="h-4 w-4" />}
          color="amber"
          className="col-span-2 lg:col-span-3"
        />
      )}
      {totalTokens > 0 && (
        <MetricCard
          label="Total Tokens"
          value={totalTokens >= 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(2)}M` : totalTokens >= 1_000 ? `${(totalTokens / 1_000).toFixed(1)}k` : totalTokens.toString()}
          icon={<Layers className="h-4 w-4" />}
          color="purple"
          subLabel={`in: ${totalInputTokens >= 1_000_000 ? `${(totalInputTokens / 1_000_000).toFixed(1)}M` : totalInputTokens >= 1_000 ? `${(totalInputTokens / 1_000).toFixed(1)}k` : totalInputTokens} / out: ${totalOutputTokens >= 1_000_000 ? `${(totalOutputTokens / 1_000_000).toFixed(1)}M` : totalOutputTokens >= 1_000 ? `${(totalOutputTokens / 1_000).toFixed(1)}k` : totalOutputTokens}`}
          className="col-span-2 lg:col-span-3"
        />
      )}
      </div>
    </div>
  );
}
