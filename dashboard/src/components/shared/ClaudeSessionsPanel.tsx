/**
 * components/shared/ClaudeSessionsPanel.tsx
 *
 * Read-only panel showing active Claude Code sessions discovered via
 * `claude agents --json`. Proxies through Aegis backend endpoint
 * GET /v1/cc-sessions.
 *
 * Sessions not managed by Aegis appear here alongside Aegis-managed ones,
 * providing system-level visibility into all running CC sessions.
 */

import { useEffect, useState } from 'react';
import { Terminal, Circle } from 'lucide-react';
import { getClaudeSessions, type ClaudeAgentSession } from '../../api/client';
import { useT } from '../../i18n/context';

function formatCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, '/');
  // Abbreviate home directory
  return normalized.replace(/^\/home\/[^/]+/, '~');
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface ClaudeSessionsPanelProps {
  /** Poll interval in ms (default: 30s) */
  pollInterval?: number;
  /** Max sessions to display */
  maxItems?: number;
}

export function ClaudeSessionsPanel({ pollInterval = 30_000, maxItems = 20 }: ClaudeSessionsPanelProps) {
  const t = useT();
  const [sessions, setSessions] = useState<ClaudeAgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const fetchSessions = () => {
    const controller = new AbortController();
    getClaudeSessions(controller.signal)
      .then((data) => {
        setSessions(data);
        setLoading(false);
        setError(null);
        setAvailable(true);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setLoading(false);
          // If the endpoint returns 404, it means the backend endpoint isn't implemented yet
          if (err.message?.includes('404') || err.status === 404) {
            setAvailable(false);
            setError(null);
          } else {
            setError(err instanceof Error ? err.message : 'Failed to load CC sessions');
          }
        }
      });
  };

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval]);

  // Don't render if endpoint isn't available
  if (!available && !loading) return null;

  const displaySessions = sessions.slice(0, maxItems);

  return (
    <div className="flex flex-col gap-1.5 min-h-[120px]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <Terminal className="h-3 w-3 text-[var(--color-text-muted)]" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
          CC Sessions
        </span>
        {displaySessions.length > 0 && (
          <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
            {displaySessions.length}
          </span>
        )}
      </div>

      {/* Content */}
      {loading && (
        <div className="space-y-1.5 px-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-6 animate-shimmer rounded bg-[var(--color-surface-hover)]" />
          ))}
        </div>
      )}

      {error && (
        <p className="px-2 text-[10px] text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && displaySessions.length === 0 && (
        <p className="px-2 text-[10px] text-[var(--color-text-muted)]">
          No active CC sessions
        </p>
      )}

      {!loading && displaySessions.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label={t('aria.activeClaudeSessions')}>
          {displaySessions.map((session) => (
            <li
              key={session.sessionId}
              className="flex items-center gap-2 rounded px-2 py-1 text-[10px] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {/* Status indicator */}
              <Circle
                className={`h-1.5 w-1.5 shrink-0 ${
                  session.status === 'working'
                    ? 'fill-[var(--color-accent-cyan)] text-[var(--color-accent-cyan)]'
                    : 'fill-[var(--color-text-muted)] text-[var(--color-text-muted)]'
                }`}
                aria-hidden="true"
              />
              {/* Session name (truncated) */}
              <span
                className="flex-1 min-w-0 truncate font-mono text-[var(--color-text-primary)]"
                title={session.name}
              >
                {session.name}
              </span>
              {/* Working directory */}
              <span
                className="hidden sm:inline max-w-[100px] truncate text-[var(--color-text-muted)]"
                title={session.cwd}
              >
                {formatCwd(session.cwd)}
              </span>
              {/* Time ago */}
              <span className="shrink-0 text-[var(--color-text-muted)]">
                {formatTimeAgo(session.startedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
