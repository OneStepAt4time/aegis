/**
 * components/session/OperatorTimeline.tsx — ACP operator timeline view.
 *
 * Displays a chronological audit trail of session events per epic §11.5:
 * - Driver claimed/released/transferred/revoked
 * - Prompt submitted, tool started/completed/failed
 * - Approval requested/responded/timed out
 * - Session paused/resumed, intervention started/completed
 * - System events, ACP protocol errors
 *
 * Features:
 * - Category-based filtering
 * - Text search
 * - Collapsible event details
 * - Actor attribution
 * - Relative/absolute timestamps
 *
 * Uses CSS design tokens (var(--color-*)).
 *
 * TODO: Wire to real event stream once ACP-025 lands.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useT } from '../../i18n/context';
import {
  User,
  Terminal,
  Wrench,
  Shield,
  Pause,
  AlertTriangle,
  Server,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type {
  AcpTimelineEvent,
  AcpTimelineCategory,
  AcpTimelineFilters,
  AcpTimelineConfig,
} from '../../types/acp-timeline';

/** Map categories to display config. */
const CATEGORY_CONFIG: Record<AcpTimelineCategory, { label: string; icon: typeof Terminal; color: string }> = {
  driver: { label: 'Driver', icon: User, color: 'text-[var(--color-accent)]' },
  prompt: { label: 'Prompt', icon: Terminal, color: 'text-[var(--color-text-primary)]' },
  tool: { label: 'Tool', icon: Wrench, color: 'text-[var(--color-warning)]' },
  approval: { label: 'Approval', icon: Shield, color: 'text-[var(--color-success)]' },
  session: { label: 'Session', icon: Pause, color: 'text-[var(--color-text-muted)]' },
  intervention: { label: 'Intervention', icon: AlertTriangle, color: 'text-[var(--color-error)]' },
  system: { label: 'System', icon: Server, color: 'text-[var(--color-text-muted)]' },
  error: { label: 'Error', icon: AlertTriangle, color: 'text-[var(--color-error)]' },
};

const ALL_CATEGORIES: AcpTimelineCategory[] = [
  'driver', 'prompt', 'tool', 'approval', 'session', 'intervention', 'system', 'error',
];

/** Format a timestamp as relative time. */
function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffS = Math.floor(diffMs / 1000);

  if (diffS < 5) return 'just now';
  if (diffS < 60) return `${diffS}s ago`;
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return new Date(isoString).toLocaleTimeString();
}

/** Format a timestamp as absolute time. */
function formatAbsoluteTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString();
}

/** Event detail renderer. */
function EventDetails({ event }: { event: AcpTimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const details = event.details;
  if (!details) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Details
      </button>
      {expanded && (
        <div className="ml-4 mt-1 rounded-md border border-[var(--color-border)] bg-[var(--color-void)] p-2 font-mono text-xs text-[var(--color-text-secondary)]">
          {details.toolName && (
            <div><span className="text-[var(--color-text-muted)]">tool:</span> {details.toolName}</div>
          )}
          {details.toolStatus && (
            <div><span className="text-[var(--color-text-muted)]">status:</span> {details.toolStatus}</div>
          )}
          {details.driverAction && (
            <div><span className="text-[var(--color-text-muted)]">action:</span> {details.driverAction}</div>
          )}
          {details.driverFrom && details.driverTo && (
            <div><span className="text-[var(--color-text-muted)]">transfer:</span> {details.driverFrom} → {details.driverTo}</div>
          )}
          {details.sessionFrom && details.sessionTo && (
            <div><span className="text-[var(--color-text-muted)]">state:</span> {details.sessionFrom} → {details.sessionTo}</div>
          )}
          {details.approvalDecision && (
            <div><span className="text-[var(--color-text-muted)]">decision:</span> {details.approvalDecision}</div>
          )}
          {details.durationMs !== undefined && (
            <div><span className="text-[var(--color-text-muted)]">duration:</span> {(details.durationMs / 1000).toFixed(1)}s</div>
          )}
          {details.tokenUsage && (
            <div><span className="text-[var(--color-text-muted)]">tokens:</span> {details.tokenUsage.total.toLocaleString()}</div>
          )}
          {details.errorCode && (
            <div><span className="text-[var(--color-error)]">error:</span> {details.errorCode}</div>
          )}
          {details.errorMessage && (
            <div className="text-[var(--color-error)]">{details.errorMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Single timeline event row. */
function TimelineEventRow({
  event,
  relativeTime,
}: {
  event: AcpTimelineEvent;
  relativeTime: boolean;
}) {
  const config = CATEGORY_CONFIG[event.category];
  const Icon = config.icon;

  return (
    <div
      className="flex gap-3 border-b border-[var(--color-border)] px-3 py-2 "
      role="listitem"
      aria-label={`${config.label}: ${event.description}`}
    >
      {/* Icon */}
      <div className={`mt-0.5 shrink-0 ${config.color}`}>
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-primary)]">{event.description}</span>
          {event.actor && (
            <span className="shrink-0 rounded bg-[var(--color-void-lighter)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
              {event.actor}
            </span>
          )}
        </div>
        <EventDetails event={event} />
      </div>

      {/* Timestamp */}
      <time
        className="shrink-0 text-[10px] text-[var(--color-text-muted)]"
        dateTime={event.timestamp}
      >
        {relativeTime ? formatRelativeTime(event.timestamp) : formatAbsoluteTime(event.timestamp)}
      </time>
    </div>
  );
}

export interface OperatorTimelineProps {
  sessionId: string;
  /** Timeline events to display. */
  events: AcpTimelineEvent[];
  /** View configuration. */
  config?: AcpTimelineConfig;
  /** Whether events are loading. */
  isLoading?: boolean;
}

export function OperatorTimeline({
  sessionId,
  events,
  config,
  isLoading = false,
}: OperatorTimelineProps) {
    const t = useT();

  const [filters, setFilters] = useState<AcpTimelineFilters>({
    categories: new Set(config?.defaultFilters ?? ALL_CATEGORIES),
    search: '',
  });
  const [showFilters, setShowFilters] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const relativeTime = config?.relativeTime ?? true;
  const autoScroll = config?.autoScroll ?? true;

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  // Filter events
  const filteredEvents = useMemo(() => {
    const max = config?.maxEvents ?? 100;
    return events
      .filter((e) => filters.categories.has(e.category))
      .filter((e) => {
        if (!filters.search) return true;
        const q = filters.search.toLowerCase();
        return (
          e.description.toLowerCase().includes(q) ||
          e.actor?.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q)
        );
      })
      .slice(-max);
  }, [events, filters, config?.maxEvents]);

  const toggleCategory = useCallback((cat: AcpTimelineCategory) => {
    setFilters((prev) => {
      const next = new Set(prev.categories);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return { ...prev, categories: next };
    });
  }, []);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters((prev) => ({ ...prev, search: e.target.value }));
  }, []);

  return (
    <div className="flex h-full flex-col" data-session-id={sessionId}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <button
          type="button"
          onClick={() => setShowFilters((prev) => !prev)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
            showFilters
              ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
          aria-expanded={showFilters}
          aria-label={t("aria.toggleCategoryFilters")}
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
          {filters.categories.size < ALL_CATEGORIES.length && (
            <span className="ml-1 rounded-full bg-[var(--color-accent)]/20 px-1 py-0.5 text-[10px] text-[var(--color-accent)]">
              {filters.categories.size}
            </span>
          )}
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={filters.search}
            onChange={handleSearch}
            placeholder="Search events..."
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-void)] py-1.5 pl-7 pr-3 text-xs text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50 focus:outline-none"
            aria-label={t("aria.searchTimeline")}
          />
        </div>
        <span className="text-[10px] text-[var(--color-text-muted)]">
          {filteredEvents.length} / {events.length}
        </span>
      </div>

      {/* Category filter bar */}
      {showFilters && (
        <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-3 py-2" role="group" aria-label={t("aria.categoryFilters")}>
          {ALL_CATEGORIES.map((cat) => {
            const cfg = CATEGORY_CONFIG[cat];
            const isActive = filters.categories.has(cat);
            const Icon = cfg.icon;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  isActive
                    ? `${cfg.color} bg-[var(--color-surface)]`
                    : 'text-[var(--color-text-muted)] opacity-40'
                }`}
                aria-pressed={isActive}
              >
                <Icon className="h-3 w-3" />
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Event list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        role="list"
        aria-label={t("aria.sessionTimeline")}
      >
        {isLoading && (
          <div className="flex items-center justify-center p-8" role="status">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
            <span className="ml-3 text-sm text-[var(--color-text-muted)]">Loading events...</span>
          </div>
        )}

        {!isLoading && filteredEvents.length === 0 && (
          <div className="flex items-center justify-center p-8 text-sm text-[var(--color-text-muted)]">
            {events.length === 0 ? 'No events yet.' : 'No events match the current filters.'}
          </div>
        )}

        {!isLoading && filteredEvents.map((event) => (
          <TimelineEventRow key={event.id} event={event} relativeTime={relativeTime} />
        ))}
      </div>
    </div>
  );
}
