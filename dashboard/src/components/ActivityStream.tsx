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

const EVENT_META: Record<GlobalSSEEventType, { icon: typeof Activity; label: string; color: string }> = {
  session_status_change: { icon: RefreshCw, label: 'Status', color: '#3b82f6' },
  session_message: { icon: MessageSquare, label: 'Message', color: '#10b981' },
  session_approval: { icon: ShieldAlert, label: 'Approval', color: '#f59e0b' },
  session_ended: { icon: Power, label: 'Ended', color: '#ef4444' },
  session_created: { icon: PlusCircle, label: 'Created', color: '#6366f1' },
  session_stall: { icon: AlertTriangle, label: 'Stall', color: '#d97706' },
  session_dead: { icon: Skull, label: 'Dead', color: '#dc2626' },
  session_subagent_start: { icon: Users, label: 'Subagent', color: '#3b82f6' },
  session_subagent_stop: { icon: UserCheck, label: 'Subagent Done', color: '#10b981' },
  session_verification: { icon: ShieldAlert, label: 'Verification', color: '#0891b2' },
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

function safeDisplayJson(value: unknown): string {
  return normalizeDisplayText(JSON.stringify(value ?? ''));
}

export function describeEvent(event: GlobalSSEEvent): string {
  const d = event.data;
  switch (event.event) {
    case 'session_status_change': {
      const status = safeStr(d.status);
      const detail = typeof d.detail === 'string' ? `: ${d.detail}` : '';
      return `Status -> ${status}${detail}`;
    }
    case 'session_message': {
      const role = d.role === 'user' ? 'User' : d.role === 'assistant' ? 'Claude' : 'System';
      const text = typeof d.text === 'string' ? normalizeDisplayText(d.text) : safeDisplayJson(d.text);
      return `${role}: ${truncate(text, 80)}`;
    }
    case 'session_approval': {
      const prompt = typeof d.prompt === 'string' ? normalizeDisplayText(d.prompt) : safeDisplayJson(d.prompt);
      return `Approval needed: ${truncate(prompt, 80)}`;
    }
    case 'session_ended':
      return `Session ended: ${safeStr(d.reason)}`;
    case 'session_created':
      return `Created in ${safeStr(d.workDir, 'unknown dir')}`;
    case 'session_stall':
      return `Session stalled: ${safeStr(d.stallType)}`;
    case 'session_dead':
      return `Session dead: ${safeStr(d.stallType)}`;
    case 'session_subagent_start':
      return `Subagent started: ${safeStr(d.name)}`;
    case 'session_subagent_stop':
      return `Subagent finished: ${safeStr(d.name)}`;
    case 'session_verification':
      return `Verification: ${safeStr(d.summary ?? d.status, 'completed')}`;
    default:
      return safeDisplayJson(d);
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

export default function ActivityStream() {
  const activities = useStore((s) => s.activities);
  const filterSession = useStore((s) => s.activityFilterSession);
  const filterType = useStore((s) => s.activityFilterType);
  const setFilterSession = useStore((s) => s.setActivityFilterSession);
  const setFilterType = useStore((s) => s.setActivityFilterType);
  const sessions = useStore((s) => s.sessions);

  const filtered = useMemo(() => {
    return activities.filter((e) => {
      if (filterSession && e.sessionId !== filterSession) return false;
      if (filterType && e.event !== filterType) return false;
      return true;
    });
  }, [activities, filterSession, filterType]);

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
    <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg w-full">
      {/* Header + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 sm:px-4 py-3 border-b border-[#1a1a2e]">
        <h3 className="text-sm font-semibold text-gray-200">Activity Stream</h3>
        <div className="flex items-center gap-2">
          {/* Session filter */}
          <select
            value={filterSession ?? ''}
            onChange={(e) => setFilterSession(e.target.value || null)}
            className="min-h-[44px] text-xs bg-[#0a0a0f] border border-[#1a1a2e] rounded px-2 py-2 text-gray-400 focus:outline-none focus:border-[#3b82f6]"
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
            className="min-h-[44px] text-xs bg-[#0a0a0f] border border-[#1a1a2e] rounded px-2 py-2 text-gray-400 focus:outline-none focus:border-[#3b82f6]"
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
      </div>

      {/* Event list */}
      <div className="max-h-[360px] overflow-y-auto divide-y divide-[#1a1a2e]/50">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[#555]">
            No activity yet
          </div>
        )}
        {filtered.map((event, idx) => {
          const meta = EVENT_META[event.event] ?? EVENT_META.session_status_change;
          const Icon = meta.icon;
          return (
            <div key={event.renderKey} className="flex items-start gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 hover:bg-[#1a1a2e]/30 transition-colors">
              <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: meta.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <span className="text-xs font-medium text-gray-300 truncate">
                    {sessionName(event.sessionId)}
                  </span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded hidden sm:inline-block"
                    style={{
                      backgroundColor: `${meta.color}15`,
                      color: meta.color,
                    }}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">
                  {describeEvent(event)}
                </p>
              </div>
              <span className="text-[10px] text-[#444] shrink-0 tabular-nums mt-0.5">
                {formatTime(event.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

