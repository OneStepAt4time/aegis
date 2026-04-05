/**
 * components/overview/MetricCards.tsx — Grid of metric cards with fallback polling.
 */

import { useCallback, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  GitBranch,
  Layers,
  Send,
  ShieldCheck,
  XCircle,
  Zap,
  Layers3,
  Camera,
  AlertTriangle,
} from 'lucide-react';
import { getHealth, getMetrics } from '../../api/client';
import { useSseAwarePolling } from '../../hooks/useSseAwarePolling';
import { useStore } from '../../store/useStore';
import type { HealthResponse } from '../../types';
import { formatUptime } from '../../utils/format';
import MetricCard from './MetricCard';
import RealtimeBadge from './RealtimeBadge';

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
  const sseError = useStore((s) => s.sseError);
  const setMetrics = useStore((s) => s.setMetrics);
  const sseConnected = useStore((s) => s.sseConnected);
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
      <div className="rounded-lg border border-void-lighter bg-[#111118] p-6 text-sm text-gray-400">
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
  const activeSessions = m?.sessions.currently_active ?? health?.sessions.active ?? 0;
  const totalCreated = m?.sessions.total_created ?? health?.sessions.total ?? 0;
  const completedSessions = m?.sessions.completed ?? 0;
  const failedSessions = m?.sessions.failed ?? 0;
  const deliveryRate = m?.prompt_delivery.success_rate;
  const deliveryRate_ = deliveryRate ?? null;
  const promptsDelivered = m?.prompt_delivery.delivered ?? 0;
  const promptsFailed = m?.prompt_delivery.failed ?? 0;
  const promptsSent = m?.prompt_delivery.sent ?? 0;
  const uptime = health?.uptime ?? m?.uptime ?? 0;
  const hookLatency = m?.latency?.hook_latency_ms.avg ?? null;
  const permissionLatency = m?.latency?.permission_response_ms.avg ?? null;
  const channelLatency = m?.latency?.channel_delivery_ms.avg ?? null;
  const webhooksSent = m?.webhooks_sent ?? 0;
  const webhooksFailed = m?.webhooks_failed ?? 0;
  const autoApprovals = m?.auto_approvals ?? 0;
  const pipelinesCreated = m?.pipelines_created ?? 0;
  const batchesCreated = m?.batches_created ?? 0;
  const screenshotsTaken = m?.screenshots_taken ?? 0;
  const avgMessages = m?.sessions.avg_messages_per_session ?? 0;

  const formatLatency = (value: number | null): string => (value === null ? '—' : `${Math.round(value)} ms`);

  const deliveryColor = deliveryRate_ === null ? 'blue' : deliveryRate_ >= 99 ? 'green' : deliveryRate_ >= 90 ? 'amber' : 'red';

  const showStatusRow = Boolean(loadError) || Boolean(!sseConnected && sseError);

  return (
    <div className="space-y-3">
      {showStatusRow && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-void-lighter bg-[#111118] px-4 py-3">
          <div className="text-xs text-gray-400">{loadError ?? 'Overview widgets are using the latest available data.'}</div>
          {!sseConnected && sseError && <RealtimeBadge mode="polling" message={sseError} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
      {/* ── Session Metrics ──────────────────────────────── */}
      <MetricCard
        label="Active Sessions"
        value={activeSessions}
        icon={<Activity className="h-4 w-4" />}
      />
      <MetricCard
        label="Total Created"
        value={totalCreated}
        icon={<Layers className="h-4 w-4" />}
        subLabel={totalCreated > 0 ? `${avgMessages} avg msgs/session` : undefined}
      />
      {completedSessions > 0 && (
        <MetricCard
          label="Completed"
          value={completedSessions}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="green"
        />
      )}
      {failedSessions > 0 && (
        <MetricCard
          label="Failed"
          value={failedSessions}
          icon={<AlertTriangle className="h-4 w-4" />}
          color="red"
        />
      )}

      {/* ── Prompt Delivery ──────────────────────────────── */}
      <MetricCard
        label="Delivery Rate"
        value={deliveryRate_ !== null ? deliveryRate_.toFixed(1) : '—'}
        suffix="%"
        icon={<Zap className="h-4 w-4" />}
        color={deliveryColor}
        bar={deliveryRate_ ?? undefined}
      />
      {promptsDelivered > 0 && (
        <MetricCard
          label="Prompts Delivered"
          value={promptsDelivered}
          subLabel={promptsSent > 0 ? `${promptsSent} sent total` : undefined}
          icon={<Send className="h-4 w-4" />}
          color="green"
        />
      )}
      {promptsFailed > 0 && (
        <MetricCard
          label="Prompts Failed"
          value={promptsFailed}
          icon={<XCircle className="h-4 w-4" />}
          color="red"
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
      />
      <MetricCard
        label="Avg Permission Latency"
        value={formatLatency(permissionLatency)}
        icon={<Clock className="h-4 w-4" />}
      />
      <MetricCard
        label="Avg Channel Latency"
        value={formatLatency(channelLatency)}
        icon={<Clock className="h-4 w-4" />}
      />

      {/* ── Uptime ───────────────────────────────────────── */}
      <MetricCard
        label="Uptime"
        value={formatUptime(uptime)}
        icon={<Clock className="h-4 w-4" />}
      />
      </div>
    </div>
  );
}
