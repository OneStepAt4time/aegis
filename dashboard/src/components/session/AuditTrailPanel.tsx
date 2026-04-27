/**
 * components/session/AuditTrailPanel.tsx
 * Displays permission prompts, approvals, and rejections for a session.
 * Fetched via GET /v1/audit?sessionId=:id
 */

import { Shield, CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';
import type { AuditRecord } from '../../types';

interface AuditTrailPanelProps {
  records: AuditRecord[];
  loading: boolean;
  error: string | null;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function actionIcon(action: string): typeof CheckCircle {
  const a = action.toLowerCase();
  if (a.includes('approve') || a.includes('permission_granted')) return CheckCircle;
  if (a.includes('reject') || a.includes('deny') || a.includes('permission_denied')) return XCircle;
  if (a.includes('prompt') || a.includes('request')) return AlertTriangle;
  return Shield;
}

function actionColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('approve') || a.includes('permission_granted'))
    return 'text-green-400';
  if (a.includes('reject') || a.includes('deny') || a.includes('permission_denied'))
    return 'text-red-400';
  if (a.includes('prompt') || a.includes('request'))
    return 'text-amber-400';
  return 'text-slate-400';
}

function actionBg(action: string): string {
  const a = action.toLowerCase();
  if (a.includes('approve') || a.includes('permission_granted'))
    return 'bg-green-950/30 border-green-900/30';
  if (a.includes('reject') || a.includes('deny') || a.includes('permission_denied'))
    return 'bg-red-950/30 border-red-900/30';
  if (a.includes('prompt') || a.includes('request'))
    return 'bg-amber-950/30 border-amber-900/30';
  return 'bg-[var(--color-surface-strong)] border-[var(--color-border)]';
}

export function AuditTrailPanel({ records, loading, error }: AuditTrailPanelProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg bg-[var(--color-surface-strong)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/30 bg-red-950/20 p-4 text-red-400 text-sm">
        Failed to load audit trail: {error}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <Shield className="h-10 w-10 text-[var(--color-text-muted)]" />
        <p className="text-sm text-[var(--color-text-muted)]">No audit events for this session</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" role="list" aria-label="Audit trail">
      {records.map((record, i) => {
        const Icon = actionIcon(record.action);
        const color = actionColor(record.action);
        const bg = actionBg(record.action);

        return (
          <div
            key={`${record.hash}-${i}`}
            role="listitem"
            className={`flex items-start gap-3 rounded-lg border p-3 ${bg}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${color}`}>
                  {record.action}
                </span>
                <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] shrink-0">
                  <Clock className="h-3 w-3" />
                  {formatDate(record.ts)} {formatTime(record.ts)}
                </span>
              </div>
              {record.detail && (
                <p className="mt-1 text-xs text-[var(--color-text-muted)] break-all">
                  {record.detail}
                </p>
              )}
              {record.actor && (
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  by {record.actor}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
