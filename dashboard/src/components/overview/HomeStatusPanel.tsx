import { useCallback, useState, type ReactNode } from 'react';
import { Activity, Bot, Plus, Terminal } from 'lucide-react';
import { getHealth } from '../../api/client.js';
import { useSseAwarePolling } from '../../hooks/useSseAwarePolling.js';
import { useStore } from '../../store/useStore.js';
import type { HealthResponse } from '../../types';
import RealtimeBadge from './RealtimeBadge.js';

const FALLBACK_POLL_INTERVAL_MS = 10_000;
const SSE_HEALTHY_POLL_INTERVAL_MS = 30_000;

type StatusTone = 'blue' | 'green' | 'amber' | 'red';

interface StatusCardProps {
  label: string;
  value: string | number;
  detail: string;
  tone: StatusTone;
  icon: ReactNode;
}

interface HomeStatusPanelProps {
  onCreateFirstSession: () => void;
}

function getErrorMessage(prefix: string, error: unknown): string {
  return error instanceof Error && error.message
    ? `${prefix}: ${error.message}`
    : prefix;
}

function StatusCard({ label, value, detail, tone, icon }: StatusCardProps) {
  const toneStyles: Record<StatusTone, { border: string; icon: string; value: string }> = {
    blue: {
      border: 'border-cyan-500/20',
      icon: 'text-cyan-300',
      value: 'text-cyan-200',
    },
    green: {
      border: 'border-emerald-500/20',
      icon: 'text-emerald-300',
      value: 'text-emerald-200',
    },
    amber: {
      border: 'border-amber-500/20',
      icon: 'text-amber-300',
      value: 'text-amber-200',
    },
    red: {
      border: 'border-red-500/20',
      icon: 'text-red-300',
      value: 'text-red-200',
    },
  };

  return (
    <article
      aria-label={`${label}: ${value}`}
      className={`rounded-xl border bg-[var(--color-surface)] p-4 ${toneStyles[tone].border}`}
    >
      <div className="mb-3 flex items-center gap-2 text-sm text-gray-400">
        <span className={toneStyles[tone].icon}>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`font-mono text-2xl font-semibold ${toneStyles[tone].value}`}>
        {value}
      </div>
      <p className="mt-2 text-sm text-gray-500">{detail}</p>
    </article>
  );
}

function getTmuxCard(health: HealthResponse | null, isLoading: boolean, loadError: string | null): Omit<StatusCardProps, 'icon' | 'label'> {
  if (isLoading && !health) {
    return {
      value: 'Checking…',
      detail: 'Verifying that the tmux server is responding.',
      tone: 'blue',
    };
  }

  if (!health?.tmux) {
    return {
      value: 'Unavailable',
      detail: loadError ?? 'Tmux status has not been reported yet.',
      tone: 'red',
    };
  }

  if (!health.tmux.healthy) {
    return {
      value: 'Degraded',
      detail: health.tmux.error ?? 'Tmux is not responding to health checks.',
      tone: 'red',
    };
  }

  return {
    value: 'Ready',
    detail: 'Tmux server is reachable and ready for new sessions.',
    tone: 'green',
  };
}

function getClaudeCard(health: HealthResponse | null, isLoading: boolean, loadError: string | null): Omit<StatusCardProps, 'icon' | 'label'> {
  if (isLoading && !health) {
    return {
      value: 'Checking…',
      detail: 'Inspecting the installed Claude Code CLI.',
      tone: 'blue',
    };
  }

  if (!health?.claude) {
    return {
      value: 'Unavailable',
      detail: loadError ?? 'Claude CLI status has not been reported yet.',
      tone: 'red',
    };
  }

  if (!health.claude.available) {
    return {
      value: 'Unavailable',
      detail: health.claude.error ?? 'Claude CLI could not be found on this host.',
      tone: 'red',
    };
  }

  if (!health.claude.healthy) {
    return {
      value: 'Needs upgrade',
      detail: health.claude.error ?? `Minimum supported version is ${health.claude.minimumVersion}.`,
      tone: 'amber',
    };
  }

  return {
    value: 'Ready',
    detail: health.claude.version
      ? `Claude CLI ${health.claude.version} is available.`
      : 'Claude CLI is installed and responding.',
    tone: 'green',
  };
}

function getActiveSessionsCard(health: HealthResponse | null, isLoading: boolean, loadError: string | null): Omit<StatusCardProps, 'icon' | 'label'> {
  if (isLoading && !health) {
    return {
      value: 'Checking…',
      detail: 'Loading the current session count.',
      tone: 'blue',
    };
  }

  if (!health) {
    return {
      value: '—',
      detail: loadError ?? 'Session totals are temporarily unavailable.',
      tone: 'red',
    };
  }

  const totalSessions = health.sessions.total;
  const activeSessions = health.sessions.active;

  return {
    value: activeSessions,
    detail: totalSessions === 0
      ? 'No sessions created yet.'
      : `${totalSessions} total session${totalSessions === 1 ? '' : 's'} created.`,
    tone: activeSessions > 0 ? 'green' : 'blue',
  };
}

export default function HomeStatusPanel({ onCreateFirstSession }: HomeStatusPanelProps) {
  const latestActivity = useStore((s) => s.activities[0] ?? null);
  const sseConnected = useStore((s) => s.sseConnected);
  const sseError = useStore((s) => s.sseError);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const next = await getHealth();
      setHealth(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(getErrorMessage('Unable to load home status', error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useSseAwarePolling({
    refresh: fetchData,
    sseConnected,
    eventTrigger: latestActivity,
    fallbackPollIntervalMs: FALLBACK_POLL_INTERVAL_MS,
    healthyPollIntervalMs: SSE_HEALTHY_POLL_INTERVAL_MS,
  });

  const totalSessions = health?.sessions.total;
  const showFirstSessionCta = !isLoading && totalSessions === 0;
  const showStatusRow = Boolean(loadError) || Boolean(!sseConnected && sseError);

  const tmuxCard = getTmuxCard(health, isLoading, loadError);
  const claudeCard = getClaudeCard(health, isLoading, loadError);
  const activeSessionsCard = getActiveSessionsCard(health, isLoading, loadError);

  return (
    <section className="space-y-4" aria-label="System health">
      {showStatusRow && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-void-lighter bg-[var(--color-surface)] px-4 py-3"
        >
          <div className="text-xs text-gray-400">
            {loadError ?? 'Using the latest available home status data.'}
          </div>
          {!sseConnected && sseError && <RealtimeBadge mode="polling" message={sseError} />}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard
          label="Tmux status"
          icon={<Terminal className="h-4 w-4" />}
          {...tmuxCard}
        />
        <StatusCard
          label="Claude CLI"
          icon={<Bot className="h-4 w-4" />}
          {...claudeCard}
        />
        <StatusCard
          label="Active sessions"
          icon={<Activity className="h-4 w-4" />}
          {...activeSessionsCard}
        />
      </div>

      {showFirstSessionCta && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-100">Create your first session</h3>
              <p className="mt-1 text-sm text-gray-400">
                Aegis is healthy. Start a Claude Code session in a working directory to unlock live activity and session controls.
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateFirstSession}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-medium text-slate-950 transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              Create first session
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
