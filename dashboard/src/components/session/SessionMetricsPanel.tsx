import { useState, useEffect } from 'react';
import type { SessionMetrics } from '../../types';
import { getSessionMetrics } from '../../api/client';

interface SessionMetricsPanelProps {
  sessionId: string;
}

function formatSeconds(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm.toString().padStart(2, '0')}m`;
}

interface MetricCardData {
  label: string;
  value: string;
  icon: string;
  color: string;
}

export function SessionMetricsPanel({ sessionId }: SessionMetricsPanelProps) {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await getSessionMetrics(sessionId);
        if (!cancelled) setMetrics(data);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sessionId]);

  if (loading || !metrics) {
    return (
      <div className="flex items-center justify-center h-48 text-[#555] text-sm animate-pulse">
        Loading metrics…
      </div>
    );
  }

  const cards: MetricCardData[] = [
    { label: 'Duration', value: formatSeconds(metrics.durationSec), icon: '⏱', color: '#00e5ff' },
    { label: 'Messages', value: metrics.messages.toString(), icon: '💬', color: '#00e5ff' },
    { label: 'Tool Calls', value: metrics.toolCalls.toString(), icon: '🔧', color: '#00e5ff' },
    { label: 'Approvals', value: metrics.approvals.toString(), icon: '✅', color: '#00ff88' },
    { label: 'Auto-approvals', value: metrics.autoApprovals.toString(), icon: '⚡', color: '#ffaa00' },
    { label: 'Status Changes', value: metrics.statusChanges.length.toString(), icon: '🔄', color: '#8888ff' },
  ];

  return (
    <div className="space-y-4">
      {/* Metric cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="rounded-lg border border-[#1a1a2e] bg-[#111118] p-4 transition-colors duration-150 hover:border-[#00e5ff]/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{card.icon}</span>
              <span className="text-[10px] text-[#888] uppercase tracking-wider">{card.label}</span>
            </div>
            <div
              className="text-2xl font-semibold font-mono tabular-nums"
              style={{ color: card.color }}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      {/* Status changes timeline */}
      {metrics.statusChanges.length > 0 && (
        <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg p-4">
          <h3 className="text-xs text-[#888] uppercase tracking-wider mb-3">Status Changes</h3>
          <div className="flex flex-wrap gap-2">
            {metrics.statusChanges.map((change, i) => (
              <div
                key={i}
                className="text-xs font-mono text-[#555] bg-[#0a0a0f] px-2 py-1 rounded border border-[#1a1a2e]"
              >
                {change}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
