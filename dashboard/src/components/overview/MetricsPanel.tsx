/**
 * components/overview/MetricsPanel.tsx — Compact metrics bar for at-a-glance stats.
 *
 * Shows 4 key metrics in a single horizontal strip: active sessions, total sessions,
 * avg duration, and system uptime. Uses /v1/health as the primary data source with
 * graceful degradation when the metrics endpoint is unavailable.
 */

import { useCallback, useState } from 'react';
import { Activity, Clock, Layers, Timer } from 'lucide-react';
import { getHealth, getMetrics } from '../../api/client.js';
import { useSseAwarePolling } from '../../hooks/useSseAwarePolling.js';
import { useStore } from '../../store/useStore.js';
import type { GlobalMetrics, HealthResponse } from '../../types';
import { formatUptime } from '../../utils/format';

interface MetricsData {
  activeSessions: number;
  totalSessions: number;
  avgDurationSec: number;
  uptime: number;
}

const FALLBACK: MetricsData = {
  activeSessions: 0,
  totalSessions: 0,
  avgDurationSec: 0,
  uptime: 0,
};

const PLACEHOLDER: MetricsData = {
  activeSessions: 0,
  totalSessions: 0,
  avgDurationSec: 0,
  uptime: 0,
};

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
}

function StatTile({ icon, label, value, color = 'text-[#3b82f6]' }: StatTileProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-void-lighter bg-[#111118] px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1e1e2a] text-[#888]">
        {icon}
      </div>
      <div>
        <div className="text-xs text-[#666]">{label}</div>
        <div className={`font-mono text-lg font-semibold ${color}`}>{value}</div>
      </div>
    </div>
  );
}

export default function MetricsPanel() {
  const latestActivity = useStore((s) => s.activities[0] ?? null);
  const sseConnected = useStore((s) => s.sseConnected);
  const [data, setData] = useState<MetricsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnavailable, setIsUnavailable] = useState(false);

  const fetchData = useCallback(async () => {
    const [metricsResult, healthResult] = await Promise.allSettled([
      getMetrics(),
      getHealth(),
    ]);

    const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
    const metrics = metricsResult.status === 'fulfilled' ? metricsResult.value : null;

    if (!health && !metrics) {
      setIsUnavailable(true);
      setIsLoading(false);
      return;
    }

    setIsUnavailable(false);

    const m = metrics as GlobalMetrics | null;
    const h = health as HealthResponse | null;

    setData({
      activeSessions: m?.sessions.currently_active ?? h?.sessions.active ?? 0,
      totalSessions: m?.sessions.total_created ?? h?.sessions.total ?? 0,
      avgDurationSec: m?.sessions.avg_duration_sec ?? 0,
      uptime: h?.uptime ?? m?.uptime ?? 0,
    });

    setIsLoading(false);
  }, []);

  useSseAwarePolling({
    refresh: fetchData,
    sseConnected,
    eventTrigger: latestActivity,
    fallbackPollIntervalMs: 10_000,
    healthyPollIntervalMs: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-lg border border-void-lighter bg-[#111118] px-4 py-3"
          >
            <div className="mb-2 h-3 w-16 rounded bg-[#1e1e2a]" />
            <div className="h-5 w-20 rounded bg-[#1e1e2a]" />
          </div>
        ))}
      </div>
    );
  }

  const d = isUnavailable ? PLACEHOLDER : (data ?? FALLBACK);

  return (
    <div className="space-y-1.5">
      {isUnavailable && (
        <p className="text-xs text-gray-500">
          Metrics endpoint unavailable — showing placeholder values.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={<Activity className="h-4 w-4" />}
          label="Active Sessions"
          value={d.activeSessions}
          color="text-[#22c55e]"
        />
        <StatTile
          icon={<Layers className="h-4 w-4" />}
          label="Total Sessions"
          value={d.totalSessions}
          color="text-[#3b82f6]"
        />
        <StatTile
          icon={<Timer className="h-4 w-4" />}
          label="Avg Duration"
          value={formatDuration(d.avgDurationSec)}
          color="text-[#f59e0b]"
        />
        <StatTile
          icon={<Clock className="h-4 w-4" />}
          label="Uptime"
          value={formatUptime(d.uptime)}
          color="text-[#a78bfa]"
        />
      </div>
    </div>
  );
}
