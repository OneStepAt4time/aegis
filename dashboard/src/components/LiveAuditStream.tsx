/**
 * components/LiveAuditStream.tsx
 * A borderless vertical timeline feed — no card wrapper, no box-within-box.
 * Events float on the mesh background connected by a continuous trace line.
 */

import { useState, useMemo } from 'react';
import {
  Activity,
  MessageSquare,
  ShieldAlert,
  Power,
  PlusCircle,
  RefreshCw,
  AlertTriangle,
  Skull,
  Users,
  UserCheck,
  Radio,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { GlobalSSEEventType } from '../types';
import { describeEvent } from './ActivityStream';

// Semantic color tiers matching enterprise signal priority
const EVENT_META: Record<GlobalSSEEventType, {
  icon: typeof Activity;
  label: string;
  color: string;        // icon + dot color
  category: 'health' | 'action' | 'security' | 'error';
}> = {
  session_status_change: { icon: RefreshCw,   label: 'Status',     color: '#67e8f9', category: 'health'   }, // cyan
  session_message:       { icon: MessageSquare,label: 'Message',    color: '#e2e8f0', category: 'action'   }, // silver
  session_approval:      { icon: ShieldAlert,  label: 'Approval',   color: '#fbbf24', category: 'security' }, // amber
  session_ended:         { icon: Power,        label: 'Ended',      color: '#94a3b8', category: 'action'   }, // slate
  session_created:       { icon: PlusCircle,   label: 'Created',    color: '#818cf8', category: 'action'   }, // indigo
  session_stall:         { icon: AlertTriangle,label: 'Stall',      color: '#f59e0b', category: 'security' }, // amber
  session_dead:          { icon: Skull,        label: 'Dead',       color: '#ef4444', category: 'error'    }, // crimson
  session_subagent_start:{ icon: Users,        label: 'Subagent',   color: '#67e8f9', category: 'health'   }, // cyan
  session_subagent_stop: { icon: UserCheck,    label: 'Done',       color: '#34d399', category: 'health'   }, // emerald
  session_verification:  { icon: ShieldAlert,  label: 'Verify',     color: '#fbbf24', category: 'security' }, // amber
  shutdown:              { icon: Power,        label: 'Shutdown',   color: '#ef4444', category: 'error'    }, // crimson
};

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

type FilterMode = 'all' | 'errors' | 'actions';

const ERROR_EVENTS = new Set(['session_dead', 'shutdown', 'session_stall']);
const ACTION_EVENTS = new Set(['session_created', 'session_ended', 'session_message', 'session_approval', 'session_subagent_start', 'session_subagent_stop']);

interface LiveAuditStreamProps {
  maxItems?: number;
}

export default function LiveAuditStream({ maxItems = 20 }: LiveAuditStreamProps) {
  const activities = useStore((s) => s.activities);
  const sseConnected = useStore((s) => s.sseConnected);
  const sessions = useStore((s) => s.sessions);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  const sessionNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sessions) {
      m.set(s.id, s.windowName ?? s.id.slice(0, 8));
    }
    return m;
  }, [sessions]);

  const visibleEvents = useMemo(() => {
    const filtered = filterMode === 'errors'
      ? activities.filter((e) => ERROR_EVENTS.has(e.event))
      : filterMode === 'actions'
      ? activities.filter((e) => ACTION_EVENTS.has(e.event))
      : activities;
    return filtered.slice(0, maxItems);
  }, [activities, filterMode, maxItems]);

  return (
    <div className="flex flex-col h-full">
      {/* Header — filter tabs + live indicator */}
      <div className="flex items-center justify-between mb-4 gap-2">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
          {(['all', 'errors', 'actions'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                filterMode === mode
                  ? 'bg-white/10 text-white shadow-inner'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              {mode === 'errors' ? '⚠ Errors' : mode === 'actions' ? '⚡ Actions' : 'All'}
            </button>
          ))}
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${sseConnected ? 'bg-cyan-400' : 'bg-slate-600'}`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${sseConnected ? 'bg-cyan-400 shadow-[0_0_6px_#67e8f9]' : 'bg-slate-600'}`} />
          </span>
          {sseConnected ? (
            <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-500/70 flex items-center gap-1">
              <Radio className="h-3 w-3" />LIVE
            </span>
          ) : (
            <span className="text-[9px] text-slate-600 uppercase tracking-widest">PAUSED</span>
          )}
        </div>
      </div>

      {/* Empty state */}
      {visibleEvents.length === 0 && (
        <div className="flex flex-col items-center justify-center pt-12 gap-3 text-center">
          <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center">
            <Activity className="h-4 w-4 text-slate-600" />
          </div>
          <p className="text-xs text-slate-500">No events yet</p>
          <p className="text-[10px] text-slate-600">Agent events will stream here in real time</p>
        </div>
      )}

      {/* Timeline trace */}
      {visibleEvents.length > 0 && (
        <div className="relative flex-1 overflow-y-auto overflow-x-hidden">
          {/* The continuous vertical trace line — uses CSS var for light/dark */}
          <div
            className="absolute left-[13px] top-2 bottom-2 w-px"
            style={{
              background: 'linear-gradient(to bottom, var(--color-trace-line, rgba(103,232,249,0.3)), rgba(103,232,249,0.05) 60%, transparent)',
            }}
          />

          <div className="flex flex-col gap-0">
            {visibleEvents.map((event, index) => {
              const meta = EVENT_META[event.event] ?? EVENT_META.session_status_change;
              const Icon = meta.icon;
              const isFirst = index === 0;
              const sessionLabel = sessionNameMap.get(event.sessionId) ?? event.sessionId?.slice(0, 8) ?? 'system';

              return (
                <div key={event.renderKey} className="relative flex gap-3 px-0 py-2 group">
                  {/* Icon node — sits ON the trace line */}
                  <div
                    className="relative z-10 mt-0.5 flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full transition-all duration-200 group-hover:scale-110"
                    style={{
                      background: `${meta.color}15`,
                      border: `1px solid ${meta.color}30`,
                      boxShadow: isFirst ? `0 0 10px ${meta.color}40` : undefined,
                    }}
                  >
                    <Icon
                      className="h-3 w-3"
                      style={{ color: meta.color }}
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pb-3 border-b border-white/[0.04] group-last:border-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="text-[9px] font-bold uppercase tracking-widest shrink-0"
                          style={{ color: meta.color }}
                        >
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-slate-500 truncate">
                          {sessionLabel}
                        </span>
                      </div>
                      <span className="text-[9px] text-slate-600 font-mono shrink-0 tabular-nums">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">
                      {describeEvent(event)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom fade to suggest infinite scroll */}
          <div className="sticky bottom-0 h-10 bg-gradient-to-t from-[#020617] to-transparent pointer-events-none" />
        </div>
      )}
    </div>
  );
}
