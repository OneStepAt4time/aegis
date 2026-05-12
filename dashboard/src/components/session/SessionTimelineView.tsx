/**
 * SessionTimelineView — Visual timeline wrapper for session events.
 *
 * Adds a vertical connecting line, event dots, and category-colored markers
 * on top of the existing OperatorTimeline event data.
 *
 * Issue: #3126
 */

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  User, Terminal, Wrench, Shield, Pause, AlertTriangle, Server,
  ChevronDown, ChevronRight, Clock, Filter,
} from 'lucide-react';
import type { AcpTimelineEvent, AcpTimelineCategory } from '../../types/acp-timeline';
import { useT } from '../../i18n/context';

/* ── Category config ─────────────────────────────────────── */

const CATEGORY_CONFIG: Record<AcpTimelineCategory, {
  label: string;
  icon: typeof Terminal;
  color: string;
  dotColor: string;
}> = {
  driver:       { label: 'Driver',       icon: User,          color: 'text-blue-400',          dotColor: 'bg-blue-400' },
  prompt:       { label: 'Prompt',       icon: Terminal,      color: 'text-[var(--color-text-primary)]', dotColor: 'bg-[var(--color-text-primary)]' },
  tool:         { label: 'Tool',         icon: Wrench,        color: 'text-amber-400',         dotColor: 'bg-amber-400' },
  approval:     { label: 'Approval',     icon: Shield,        color: 'text-emerald-400',       dotColor: 'bg-emerald-400' },
  session:      { label: 'Session',      icon: Pause,         color: 'text-[var(--color-text-muted)]', dotColor: 'bg-[var(--color-text-muted)]' },
  intervention: { label: 'Intervention', icon: AlertTriangle, color: 'text-orange-400',        dotColor: 'bg-orange-400' },
  system:       { label: 'System',       icon: Server,        color: 'text-[var(--color-text-muted)]', dotColor: 'bg-[var(--color-text-muted)]' },
  error:        { label: 'Error',        icon: AlertTriangle, color: 'text-red-400',           dotColor: 'bg-red-400' },
};

const ALL_CATEGORIES = Object.keys(CATEGORY_CONFIG) as AcpTimelineCategory[];

/* ── Helpers ─────────────────────────────────────────────── */

function formatRelativeTime(ts: string | number): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatAbsoluteTime(ts: string | number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ── Props ───────────────────────────────────────────────── */

interface SessionTimelineViewProps {
  events: AcpTimelineEvent[];
  isLoading?: boolean;
}

/* ── Component ───────────────────────────────────────────── */

export function SessionTimelineView({ events, isLoading }: SessionTimelineViewProps) {
    const t = useT();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeFilters, setActiveFilters] = useState<Set<AcpTimelineCategory>>(new Set(ALL_CATEGORIES));
  const [showFilters, setShowFilters] = useState(false);
  const [relativeTime, setRelativeTime] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleFilter = useCallback((cat: AcpTimelineCategory) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const filteredEvents = useMemo(
    () => events.filter(e => activeFilters.has(e.category)),
    [events, activeFilters],
  );

  const errorCount = useMemo(
    () => events.filter(e => e.category === 'error').length,
    [events],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--color-text-muted)] text-sm" role="status" aria-busy="true">
        <div className="animate-pulse">Loading timeline…</div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)]">
        <Clock className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-sm">No timeline events yet</p>
        <p className="text-xs mt-1 opacity-60">Events will appear as the session progresses</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 pb-3 border-b border-[var(--color-void-lighter)]">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-muted)]">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
          </span>
          {errorCount > 0 && (
            <span className="text-xs text-red-400 font-medium">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRelativeTime(v => !v)}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label={relativeTime ? 'Show absolute time' : 'Show relative time'}
          >
            <Clock className="h-3.5 w-3.5 inline mr-1" />
            {relativeTime ? 'relative' : 'absolute'}
          </button>
          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            className={`text-xs transition-colors ${showFilters ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
            aria-label={t("aria.toggleEventFilters")}
            aria-expanded={showFilters}
          >
            <Filter className="h-3.5 w-3.5 inline mr-1" />
            Filters
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="flex flex-wrap gap-1.5 py-2 px-1" role="group" aria-label={t("aria.eventCategoryFilters")}>
          {ALL_CATEGORIES.map(cat => {
            const cfg = CATEGORY_CONFIG[cat];
            const active = activeFilters.has(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleFilter(cat)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                  active
                    ? `bg-[var(--color-void)] ${cfg.color} border border-[var(--color-void-lighter)]`
                    : 'text-[var(--color-text-muted)] opacity-40 border border-transparent hover:opacity-70'
                }`}
                aria-pressed={active}
                aria-label={`${cfg.label} events`}
              >
                <cfg.icon className="h-3 w-3" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Timeline */}
      <div ref={containerRef} className="flex-1 overflow-y-auto py-3 space-y-0" role="list" aria-label={t("aria.sessionEventTimeline")}>
        {filteredEvents.map((event, i) => {
          const cfg = CATEGORY_CONFIG[event.category];
          const Icon = cfg.icon;
          const expanded = expandedIds.has(event.id);
          const isLast = i === filteredEvents.length - 1;
          const details = event.details as Record<string, unknown> | undefined;

          return (
            <div key={event.id} className="flex group" role="listitem">
              {/* Timeline track */}
              <div className="relative flex flex-col items-center w-8 shrink-0">
                {/* Dot */}
                <div className={`w-3 h-3 rounded-full ${cfg.dotColor} ring-2 ring-[var(--color-surface)] z-10 shrink-0`} />
                {/* Connector line */}
                {!isLast && (
                  <div className="w-px flex-1 bg-[var(--color-void-lighter)] group-hover:bg-[var(--color-void-lighter)]/80 transition-colors" />
                )}
              </div>

              {/* Event content */}
              <div className={`flex-1 pb-4 pl-2 ${isLast ? '' : ''}`}>
                <button
                  type="button"
                  onClick={() => toggleExpand(event.id)}
                  className="w-full text-left flex items-start gap-2 rounded p-1.5 -m-1.5 hover:bg-[var(--color-void)]/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
                  aria-expanded={expanded}
                  aria-label={`${cfg.label}: ${event.description}`}
                >
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                        {event.description}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
                        {relativeTime ? formatRelativeTime(event.timestamp) : formatAbsoluteTime(event.timestamp)}
                      </span>
                    </div>
                    {event.actor && (
                      <span className="text-[10px] text-[var(--color-text-muted)]">{event.actor}</span>
                    )}
                  </div>
                  <span className="text-[var(--color-text-muted)] mt-0.5 shrink-0">
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </span>
                </button>

                {/* Expanded details */}
                {expanded && details && (
                  <div className="mt-1 ml-6 p-2.5 rounded bg-[var(--color-void)]/50 border border-[var(--color-void-lighter)] text-xs space-y-1">
                    {Object.entries(details).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-[var(--color-text-muted)] shrink-0">{key}:</span>
                        <span className="text-[var(--color-text-primary)] font-mono break-all">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                    {details.durationMs !== undefined && (
                      <div className="flex gap-2 pt-1 border-t border-[var(--color-void-lighter)]">
                        <span className="text-[var(--color-text-muted)]">duration:</span>
                        <span className="text-amber-400 font-mono">{(Number(details.durationMs) / 1000).toFixed(1)}s</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
