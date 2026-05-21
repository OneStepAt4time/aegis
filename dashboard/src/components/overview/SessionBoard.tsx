/**
 * components/overview/SessionBoard.tsx
 *
 * Kanban board view for sessions. Displays sessions in columns
 * by status, inspired by Multica's board view but using
 * Aegis session data.
 *
 * Columns: Running | Waiting | Idle | Other
 * Each card shows: session name, model, status, last activity.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { getSessions } from '../../api/client';
import type { SessionInfo, UIState } from '../../types';
import StatusDot from './StatusDot';
import { useStore } from '../../store/useStore';
import { Loader2, Columns3 } from 'lucide-react';

/** Status groupings for board columns */
type BoardColumn = {
  id: string;
  title: string;
  statuses: string[];
  color: string;
};

const BOARD_COLUMNS: BoardColumn[] = [
  {
    id: 'running',
    title: 'Running',
    statuses: ['working', 'compacting', 'plan_mode', 'settings'],
    color: 'text-[var(--color-success)]',
  },
  {
    id: 'waiting',
    title: 'Waiting',
    statuses: ['permission_prompt', 'ask_question', 'bash_approval', 'context_warning', 'waiting_for_input'],
    color: 'text-[var(--color-warning)]',
  },
  {
    id: 'idle',
    title: 'Idle',
    statuses: ['idle'],
    color: 'text-[var(--color-text-muted)]',
  },
];

function getStatusGroup(status: string): string {
  for (const col of BOARD_COLUMNS) {
    if (col.statuses.includes(status)) return col.id;
  }
  return 'other';
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(start: number): string {
  const diff = Date.now() - start;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const m = mins % 60;
  return `${hours}h ${m}m`;
}

function SessionCard({ session }: { session: SessionInfo }) {
  const age = formatDuration(session.createdAt);
  const lastActive = formatTimeAgo(session.lastActivity);
  const statusGroup = getStatusGroup(session.status);

  return (
    <div
      className="rounded-lg border border-[var(--color-void-lighter)] bg-[var(--color-surface)]/80 p-3 hover:bg-[var(--color-surface-hover)] transition-colors cursor-default"
      role="article"
      aria-label={`Session ${session.displayName}, status ${session.status}`}
    >
      {/* Header: status + name */}
      <div className="flex items-start gap-2">
        <StatusDot status={session.status as UIState} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate" title={session.displayName}>
            {session.displayName}
          </p>
        </div>
      </div>

      {/* Meta row */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
        {session.model && (
          <span className="rounded-full bg-[var(--color-void-lighter)]/50 px-2 py-0.5 font-mono" title={session.model}>
            {session.model.replace('claude-', '').replace('-20250514', '')}
          </span>
        )}
        <span title={`Started ${age} ago`}>⏱ {age}</span>
        <span title={`Last active ${lastActive}`}>💬 {lastActive}</span>
      </div>

      {/* Status indicator for waiting sessions */}
      {statusGroup === 'waiting' && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--color-warning)]">
          <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] animate-pulse" />
          <span>Needs attention</span>
        </div>
      )}
    </div>
  );
}

function BoardColumnView({
  column,
  sessions,
}: {
  column: BoardColumn;
  sessions: SessionInfo[];
}) {
  return (
    <div className="w-[280px] shrink-0 flex flex-col gap-2" role="region" aria-label={`${column.title} sessions`}>
      {/* Column header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${
            column.id === 'running' ? 'bg-[var(--color-success)]' :
            column.id === 'waiting' ? 'bg-[var(--color-warning)]' :
            'bg-[var(--color-text-muted)]'
          }`} />
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${column.color}`}>
            {column.title}
          </h3>
          <span className="rounded-full bg-[var(--color-void-lighter)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
            {sessions.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto rounded-lg p-1" role="list" aria-label={`${column.title} session list`}>
        {sessions.length === 0 && (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]/50">
            No sessions
          </div>
        )}
        {sessions.map((session) => (
          <div key={session.id} role="listitem">
            <SessionCard session={session} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionBoard() {
  const sseConnected = useStore((s) => s.sseConnected);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getSessions({ limit: 100 });
      setSessions(result.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  // Refetch on SSE reconnect
  useEffect(() => {
    if (sseConnected) {
      void fetchSessions();
    }
  }, [sseConnected, fetchSessions]);

  const columns = useMemo(() => {
    const grouped = new Map<string, SessionInfo[]>();
    for (const col of BOARD_COLUMNS) {
      grouped.set(col.id, []);
    }
    grouped.set('other', []);

    for (const session of sessions) {
      const groupId = getStatusGroup(session.status);
      if (!grouped.has(groupId)) grouped.set(groupId, []);
      grouped.get(groupId)!.push(session);
    }

    // Sort within each column: running first by most recent activity
    for (const [, colSessions] of grouped) {
      colSessions.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    return { grouped, hasOther: (grouped.get('other')?.length ?? 0) > 0 };
  }, [sessions]);

  const totalSessions = sessions.length;
  const runningCount = sessions.filter(s => BOARD_COLUMNS[0].statuses.includes(s.status)).length;
  const waitingCount = sessions.filter(s => BOARD_COLUMNS[1].statuses.includes(s.status)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-busy="true" aria-label="Loading session board">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-muted)]" />
        <span className="ml-2 text-sm text-[var(--color-text-muted)]">Loading sessions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-16" role="alert">
        <p className="text-sm text-[var(--color-danger)]">Failed to load: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Board header with stats */}
      <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
        <Columns3 className="h-4 w-4" />
        <span>{totalSessions} sessions</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
          {runningCount} running
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
          {waitingCount} waiting
        </span>
      </div>

      {/* Board */}
      <div
        className="flex gap-4 overflow-x-auto pb-4"
        role="region"
        aria-label="Session board"
        tabIndex={0}
      >
        {BOARD_COLUMNS.map((col) => (
          <BoardColumnView
            key={col.id}
            column={col}
            sessions={columns.grouped.get(col.id) ?? []}
          />
        ))}

        {/* Other column (only if there are sessions in it) */}
        {columns.hasOther && (
          <div className="w-[280px] shrink-0 flex flex-col gap-2" role="region" aria-label="Other sessions">
            <div className="flex items-center gap-2 px-1">
              <div className="h-2 w-2 rounded-full bg-[var(--color-text-muted)]/50" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Other
              </h3>
              <span className="rounded-full bg-[var(--color-void-lighter)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
                {columns.grouped.get('other')?.length ?? 0}
              </span>
            </div>
            <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto rounded-lg p-1" role="list">
              {(columns.grouped.get('other') ?? []).map((session) => (
                <div key={session.id} role="listitem">
                  <SessionCard session={session} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
