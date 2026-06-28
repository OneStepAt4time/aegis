/**
 * overview/TelemetryStrip.tsx — Command Center signature status bar.
 *
 * A dense, full-width, monospace readout strip pinned under the header —
 * the "mission control" console bar. Every operator's eye lands here first:
 * system nominal, how many agents flying, how many awaiting clearance,
 * tokens burned, cost, uptime. Border-divided cells, mono values, amber
 * for the live agent count + warnings, cyan for nominal.
 *
 * See dashboard/DESIGN.md §4 "telemetry strip" motif.
 */

import type { ReactNode } from 'react';

export type SystemStatus = 'nominal' | 'degraded' | 'down';

interface TelemetryStripProps {
  agentsRunning: number;
  awaitingApproval: number;
  totalSessions: number;
  totalTokens: number;
  totalCostUsd: number;
  systemStatus: SystemStatus;
  serverUptimeSec?: number;
}

const STATUS_META: Record<SystemStatus, { label: string; dotClass: string; textClass: string; pulse: boolean }> = {
  nominal: { label: 'NOMINAL', dotClass: 'bg-[var(--color-accent-cyan)]', textClass: 'text-[var(--color-accent-cyan)]', pulse: false },
  degraded: { label: 'DEGRADED', dotClass: 'bg-[var(--color-warning)]', textClass: 'text-[var(--color-warning)]', pulse: true },
  down: { label: 'OFFLINE', dotClass: 'bg-[var(--color-danger)]', textClass: 'text-[var(--color-danger)]', pulse: false },
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h${rm}m`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24}h`;
}

interface CellProps {
  label: string;
  children: ReactNode;
  /** emphasize = amber (live / primary metric). */
  emphasize?: boolean;
  className?: string;
}

function Cell({ label, children, emphasize, className = '' }: CellProps) {
  return (
    <div className={`flex flex-col justify-center gap-0.5 px-4 py-2 min-w-[88px] border-r border-[var(--color-border-subtle)] last:border-r-0 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        {label}
      </span>
      <span
        className={`font-mono text-sm leading-none ${emphasize ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-primary)]'}`}
      >
        {children}
      </span>
    </div>
  );
}

export function TelemetryStrip({
  agentsRunning,
  awaitingApproval,
  totalSessions,
  totalTokens,
  totalCostUsd,
  systemStatus,
  serverUptimeSec,
}: TelemetryStripProps) {
  const status = STATUS_META[systemStatus];
  return (
    <div
      role="status"
      aria-label="System telemetry"
      className="flex items-stretch overflow-x-auto whitespace-nowrap border-y border-[var(--color-border)] bg-[var(--color-void-deep)]"
    >
      {/* System status — the lead cell, cyan/amber/red */}
      <div className="flex items-center gap-2 px-4 py-2 border-r border-[var(--color-border)]">
        <span className={`relative inline-flex h-2 w-2 rounded-full ${status.dotClass}${status.pulse ? ' animate-pulse' : ''}`} />
        <span className={`font-mono text-xs font-semibold tracking-[0.06em] ${status.textClass}`}>
          {status.label}
        </span>
      </div>

      <Cell label="Agents" emphasize={agentsRunning > 0}>
        {agentsRunning.toString().padStart(2, '0')}
      </Cell>

      <Cell
        label="Awaiting"
        className={awaitingApproval > 0 ? 'bg-[var(--color-warning)]/5' : ''}
      >
        <span className={awaitingApproval > 0 ? 'text-[var(--color-warning)]' : ''}>
          {awaitingApproval.toString().padStart(2, '0')}
        </span>
      </Cell>

      <Cell label="Sessions">{totalSessions}</Cell>
      <Cell label="Tokens">{fmtTokens(totalTokens)}</Cell>
      <Cell label="Cost">{fmtCost(totalCostUsd)}</Cell>
      {serverUptimeSec !== undefined && (
        <Cell label="Uptime">{fmtUptime(serverUptimeSec)}</Cell>
      )}
    </div>
  );
}
