/**
 * components/shared/LiveAuditStream.tsx
 * Sticky 280px side rail showing live audit events on xl+ viewports (issue 2014).
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle, Zap, XCircle } from 'lucide-react';
import { useStore } from '../../store/useStore';
import type { GlobalSSEEventType } from '../../types';
import { tokens } from '../../design/tokens';

const maxEvents = tokens.glamour.sideRailMaxEvents;

const EVENT_ICONS: Record<string, typeof Activity> = {
  session_created: Zap,
  session_status_change: Activity,
  session_message: Activity,
  session_approval: AlertTriangle,
  session_ended: XCircle,
  session_stall: AlertTriangle,
  session_dead: XCircle,
  session_subagent_start: Zap,
  session_subagent_stop: CheckCircle,
  session_verification: CheckCircle,
};

const EVENT_ACCENTS: Record<string, string> = {
  session_created: 'var(--color-success)',
  session_status_change: 'var(--color-accent-cyan)',
  session_message: 'var(--color-text-muted)',
  session_approval: 'var(--color-warning)',
  session_ended: 'var(--color-danger)',
  session_stall: 'var(--color-warning)',
  session_dead: 'var(--color-danger)',
  session_subagent_start: 'var(--color-accent-purple)',
  session_subagent_stop: 'var(--color-success)',
  session_verification: 'var(--color-info)',
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function EventIcon({ event }: { event: GlobalSSEEventType }) {
  const Icon = EVENT_ICONS[event] ?? Activity;
  const accent = EVENT_ACCENTS[event] ?? 'var(--color-text-muted)';
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
      style={{ backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)` }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
    </div>
  );
}

export default function LiveAuditStream() {
  const activities = useStore((s) => s.activities);
  const sseConnected = useStore((s) => s.sseConnected);

  const events = useMemo(() => activities.slice(0, maxEvents), [activities]);

  return (
    <aside className="hidden xl:flex w-[var(--side-rail-width)] shrink-0 flex-col border-l border-white/5 bg-transparent backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 px-4 py-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-[var(--color-accent-cyan)]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Live Stream</span>
        {sseConnected && (
          <span className="ml-auto h-2 w-2 rounded-full bg-[var(--color-success)] shadow-[0_0_6px_var(--color-success)]" />
        )}
      </div>

      {/* Scrollable event list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        <AnimatePresence initial={false}>
          {events.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-600">
              <Activity className="h-6 w-6 mb-2 opacity-40" />
              <span className="text-xs">Waiting for events…</span>
            </div>
          )}
          {events.map((ev) => (
            <motion.div
              key={ev.renderKey}
              initial={{ opacity: 0, x: 20, height: 0 }}
              animate={{ opacity: 1, x: 0, height: 'auto' }}
              exit={{ opacity: 0, x: -10, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Link
                to={`/sessions/${encodeURIComponent(ev.sessionId)}`}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.03] transition-colors"
              >
                <EventIcon event={ev.event} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-slate-300 truncate leading-tight">
                    {ev.event.replace(/_/g, ' ')}
                  </p>
                  <p className="text-[10px] text-slate-600 truncate mt-0.5">
                    {ev.sessionId.slice(0, 8)}&middot;{formatTimestamp(ev.timestamp)}
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/5 px-4 py-2">
        <span className="text-[10px] text-slate-600">
          {events.length} event{events.length !== 1 ? 's' : ''}
        </span>
      </div>
    </aside>
  );
}
