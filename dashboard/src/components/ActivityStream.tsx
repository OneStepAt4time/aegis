/**
 * components/ActivityStream.tsx - Real-time feed of all CC actions across sessions.
 */

import { useMemo } from 'react';
import {
  Activity,
  MessageSquare,
  ShieldAlert,
  Power,
  PlusCircle,
  RefreshCw,
  X,
  AlertTriangle,
  Skull,
  Users,
  UserCheck,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { GlobalSSEEventType, GlobalSSEEvent } from '../types';
import RealtimeBadge from './overview/RealtimeBadge';

interface ActivityStreamProps {
  title?: string;
  showFilters?: boolean;
  maxItems?: number;
  emptyMessage?: string;
}

const EVENT_META: Record<GlobalSSEEventType, { icon: typeof Activity; label: string; color: string }> = {
  session_status_change: { icon: RefreshCw, label: 'Status', color: 'var(--color-accent)' },
  session_message: { icon: MessageSquare, label: 'Message', color: 'var(--color-success)' },
  session_approval: { icon: ShieldAlert, label: 'Approval', color: 'var(--color-warning)' },
  session_ended: { icon: Power, label: 'Ended', color: 'var(--color-error)' },
  session_created: { icon: PlusCircle, label: 'Created', color: 'var(--color-accent-indigo)' },
  session_stall: { icon: AlertTriangle, label: 'Stall', color: 'var(--color-warning-dark)' },
  session_dead: { icon: Skull, label: 'Dead', color: 'var(--color-error-dark)' },
  session_subagent_start: { icon: Users, label: 'Subagent', color: 'var(--color-accent)' },
  session_subagent_stop: { icon: UserCheck, label: 'Subagent Done', color: 'var(--color-success)' },
  session_verification: { icon: ShieldAlert, label: 'Verification', color: 'var(--color-info)' },
  shutdown: { icon: Power, label: 'Shutdown', color: 'var(--color-accent)' },
};

export function safeStr(val: unknown, fallback: string = 'unknown'): string {
  if (typeof val !== 'string') {
    return fallback;
  }

  const normalized = normalizeDisplayText(val);
  return normalized || fallback;
}

export function normalizeDisplayText(value: string): string {
  return value
    .replace(/\r\n?/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\uFFFD+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convert any raw object into readable key=value pairs, never leaking raw JSON */
function humanizeData(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return normalizeDisplayText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const pairs = Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, 4)
      .map(([k, v]) => {
        const key = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
        const val = typeof v === 'object' ? '...' : String(v);
        return `${key}: ${val}`;
      });
    return pairs.length > 0 ? pairs.join(' · ') : 'Event received';
  }
  return 'Event received';
}

export function describeEvent(event: GlobalSSEEvent): string {
  const d = event.data;
  switch (event.event) {
    case 'session_status_change': {
      const status = safeStr(d.status);
      const statusLabel = status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
      const detail = typeof d.detail === 'string' && d.detail ? ` — ${truncate(d.detail, 60)}` : '';
      return `State changed to ${statusLabel}${detail}`;
    }
    case 'session_message': {
      const role = d.role === 'user' ? 'User prompt' : d.role === 'assistant' ? 'Agent response' : 'System';
      const text = typeof d.text === 'string' ? normalizeDisplayText(d.text) : humanizeData(d.text);
      return `${role}: ${truncate(text, 80)}`;
    }
    case 'session_approval': {
      const prompt = typeof d.prompt === 'string' ? normalizeDisplayText(d.prompt) : humanizeData(d.prompt);
      return `Permission request: ${truncate(prompt, 80)}`;
    }
    case 'session_ended':
      return `Session completed — ${safeStr(d.reason, 'no reason given').replace(/_/g, ' ')}`;
    case 'session_created':
      return `New session in ${safeStr(d.workDir, 'unknown directory')}`;
    case 'session_stall':
      return `Agent stalled: ${safeStr(d.stallType, 'unknown type').replace(/_/g, ' ')}`;
    case 'session_dead':
      return `Agent unresponsive: ${safeStr(d.stallType, 'connection lost').replace(/_/g, ' ')}`;
    case 'session_subagent_start':
      return `Subagent launched: ${safeStr(d.name, 'unnamed')}`;
    case 'session_subagent_stop':
      return `Subagent finished: ${safeStr(d.name, 'unnamed')}`;
    case 'session_verification':
      return `Verification complete: ${safeStr(d.summary ?? d.status, 'passed')}`;
    case 'shutdown':
      return 'Orchestrator shutting down gracefully';
    default:
      return humanizeData(d) || 'System event received';
  }
}

function truncate(s: string, max: number): string {
  const normalized = normalizeDisplayText(s);
  return normalized.length > max ? normalized.slice(0, max) + '...' : normalized;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export default function ActivityStream({
  title = 'Activity Stream',
  showFilters = true,
  maxItems,
  emptyMessage,
}: ActivityStreamProps) {
  const activities = useStore((s) => s.activities);
  const sseConnected = useStore((s) => s.sseConnected);
  const sseError = useStore((s) => s.sseError);
  const filterSession = useStore((s) => s.activityFilterSession);
  const filterType = useStore((s) => s.activityFilterType);
  const setFilterSession = useStore((s) => s.setActivityFilterSession);
  const setFilterType = useStore((s) => s.setActivityFilterType);
  const sessions = useStore((s) => s.sessions);

  const filtered = useMemo(() => {
    return activities.filter((e) => {
      if (showFilters) {
        if (filterSession && e.sessionId !== filterSession) return false;
        if (filterType && e.event !== filterType) return false;
      }
      return true;
    });
  }, [activities, filterSession, filterType, showFilters]);

  const visibleEvents = useMemo(() => (
    typeof maxItems === 'number' ? filtered.slice(0, maxItems) : filtered
  ), [filtered, maxItems]);

  // Build a lookup map once instead of O(n) find per event
  const sessionNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sessions) {
      m.set(s.id, s.windowName ?? s.id.slice(0, 8));
    }
    return m;
  }, [sessions]);

  const sessionName = (id: string): string => {
    return sessionNameMap.get(id) ?? (id ?? 'unknown').slice(0, 8);
  };

  return (
    <div className="card-glass w-full animate-bento-reveal overflow-hidden">
      {/* Header + filters */}
      <div className="flex flex-col gap-3 border-b border-white/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
        {showFilters && (
          <div className="flex items-center gap-2">
            {!sseConnected && sseError && <RealtimeBadge mode="paused" message={sseError} />}

            {/* Session filter */}
            <select
              value={filterSession ?? ''}
              onChange={(e) => setFilterSession(e.target.value || null)}
              className="min-h-[44px] text-xs bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded px-2 py-2 text-gray-400 focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.windowName || s.id.slice(0, 8)}
                </option>
              ))}
            </select>

            {/* Type filter */}
            <select
              value={filterType ?? ''}
              onChange={(e) => setFilterType((e.target.value || null) as GlobalSSEEventType | null)}
              className="min-h-[44px] text-xs bg-[var(--color-void)] border border-[var(--color-void-lighter)] rounded px-2 py-2 text-gray-400 focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">All types</option>
              {Object.entries(EVENT_META).map(([key, meta]) => (
                <option key={key} value={key}>{meta.label}</option>
              ))}
            </select>

            {/* Clear filters */}
            {(filterSession || filterType) && (
              <button
                onClick={() => { setFilterSession(null); setFilterType(null); }}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-500 hover:text-gray-300"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Event list */}
      <div className="max-h-[360px] overflow-y-auto divide-y divide-white/5">
        {visibleEvents.length === 0 && (
          <div className="px-4 py-10 text-center">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/5 mb-3">
              <Activity className="h-5 w-5 text-slate-500" />
            </div>
            <p className="text-sm font-medium text-slate-400">
              {emptyMessage ?? (!sseConnected && sseError ? 'Stream paused' : 'Awaiting events')}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {!sseConnected && sseError
                ? 'Real-time feed will resume when the connection recovers.'
                : 'Agent activity will appear here in real-time.'}
            </p>
          </div>
        )}
        {visibleEvents.map((event) => {
          const meta = EVENT_META[event.event] ?? EVENT_META.session_status_change;
          const Icon = meta.icon;
          const description = describeEvent(event);
          return (
            <div key={event.renderKey} className="group flex items-start gap-3 px-4 py-3 transition-all duration-150 hover:bg-white/[0.04] cursor-default">
              {/* Icon bubble with colored glow */}
              <div
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-inner transition-shadow group-hover:shadow-md"
                style={{ background: `${meta.color}18`, boxShadow: `0 0 8px ${meta.color}20` }}
              >
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
              </div>
              <div className="flex-1 min-w-0">
                {/* Session name + event type badge */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300 truncate max-w-[120px]">
                    {sessionName(event.sessionId)}
                  </span>
                  <span
                    className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                    style={{ background: `${meta.color}18`, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </div>
                {/* Human-readable description — never raw JSON */}
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed line-clamp-2">
                  {description}
                </p>
              </div>
              <span className="text-[10px] text-slate-500 shrink-0 tabular-nums mt-0.5 font-mono">
                {formatTime(event.timestamp)}
              </span>
            </div>
          );
        })}
        {/* Bottom fade gradient */}
        {visibleEvents.length > 5 && (
          <div className="h-8 bg-gradient-to-t from-[var(--color-void-dark)]/60 to-transparent pointer-events-none sticky bottom-0" />
        )}
      </div>
    </div>
  );
}

