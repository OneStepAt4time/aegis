/**
 * components/ActivityStream.tsx — Real-time feed of all CC actions across sessions.
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
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { GlobalSSEEventType, GlobalSSEEvent } from '../types';

const EVENT_META: Record<GlobalSSEEventType, { icon: typeof Activity; label: string; color: string }> = {
  session_status_change: { icon: RefreshCw, label: 'Status', color: '#00e5ff' },
  session_message: { icon: MessageSquare, label: 'Message', color: '#00ff88' },
  session_approval: { icon: ShieldAlert, label: 'Approval', color: '#ffaa00' },
  session_ended: { icon: Power, label: 'Ended', color: '#ff3366' },
  session_created: { icon: PlusCircle, label: 'Created', color: '#a78bfa' },
};

function describeEvent(event: GlobalSSEEvent): string {
  const d = event.data;
  switch (event.event) {
    case 'session_status_change':
      return `Status → ${d.status ?? 'unknown'}${d.detail ? `: ${d.detail}` : ''}`;
    case 'session_message':
      return `${d.role === 'user' ? 'User' : d.role === 'assistant' ? 'Claude' : 'System'}: ${truncate((d.text as string) ?? '', 80)}`;
    case 'session_approval':
      return `Approval needed: ${truncate((d.prompt as string) ?? '', 80)}`;
    case 'session_ended':
      return `Session ended: ${d.reason ?? 'unknown'}`;
    case 'session_created':
      return `Created in ${(d.workDir as string) ?? 'unknown dir'}`;
    default:
      return JSON.stringify(d);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
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

  const sessionName = (id: string): string => {
    const s = sessions.find((s) => s.id === id);
    return s?.windowName ?? id.slice(0, 8);
  };

  return (
    <div className="bg-[#111118] border border-[#1a1a2e] rounded-lg">
      {/* Header + filters */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a2e]">
        <h3 className="text-sm font-semibold text-gray-200">Activity Stream</h3>
        <div className="flex items-center gap-2">
          {/* Session filter */}
          <select
            value={filterSession ?? ''}
            onChange={(e) => setFilterSession(e.target.value || null)}
            className="text-xs bg-[#0a0a0f] border border-[#1a1a2e] rounded px-2 py-1 text-gray-400 focus:outline-none focus:border-[#00e5ff]"
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
            className="text-xs bg-[#0a0a0f] border border-[#1a1a2e] rounded px-2 py-1 text-gray-400 focus:outline-none focus:border-[#00e5ff]"
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
              className="text-gray-500 hover:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
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
            <div key={`${event.sessionId}-${event.timestamp}-${idx}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-[#1a1a2e]/30 transition-colors">
              <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: meta.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-300 truncate">
                    {sessionName(event.sessionId)}
                  </span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
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
