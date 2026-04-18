import { useCallback, useState, type ReactNode } from 'react';
import { Activity, Bot, Plus, Terminal, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  criticalAlert?: boolean;
  /** Optional inline action button */
  actionButton?: { label: string; onClick: () => void; icon?: 'external' | 'wrench' };
}

interface HomeStatusPanelProps {
  onCreateFirstSession: () => void;
}

function getErrorMessage(prefix: string, error: unknown): string {
  return error instanceof Error && error.message
    ? `${prefix}: ${error.message}`
    : prefix;
}

function StatusCard({ label, value, detail, tone, icon, actionButton }: StatusCardProps) {
  const toneStyles: Record<StatusTone, { border: string; icon: string; value: string }> = {
    blue: {
      border: 'border-cyan-500/20',
      icon: 'text-cyan-400',
      value: 'text-cyan-300',
    },
    green: {
      border: 'border-emerald-500/20',
      icon: 'text-emerald-400',
      value: 'text-emerald-300',
    },
    amber: {
      border: 'border-amber-500/20',
      icon: 'text-amber-400',
      value: 'text-amber-300',
    },
    red: {
      border: 'border-red-500/40 bg-red-500/10 shadow-[0_0_20px_rgba(239,68,68,0.15),0_20px_40px_-15px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-red-500/20',
      icon: 'text-red-400',
      value: 'text-red-300',
    },
  };

  const isCritical = tone === 'red';

  return (
    <article
      aria-label={`${label}: ${value}`}
      className={`relative overflow-hidden card-glass card-glass-interactive animate-bento-reveal px-5 py-4 flex items-center justify-between shadow-[0_20px_40px_-15px_rgba(0,0,0,0.7)] ${toneStyles[tone].border}`}
    >
      {/* Critical Alert Glowing Underlay */}
      {isCritical && (
        <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 via-transparent to-red-500/5 animate-pulse pointer-events-none" />
      )}

      <div className="flex flex-col gap-2 relative z-10">
        <div className="flex items-center gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 shadow-inner ${toneStyles[tone].icon}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</h4>
            <p className="mt-0.5 text-xs text-slate-500 truncate">{detail}</p>
          </div>
          <div className={`font-mono text-xl font-bold tracking-tight shrink-0 pl-4 ${toneStyles[tone].value}`}>
            {value}
          </div>
        </div>
        {/* Inline action button (shown for critical/degraded states) */}
        {actionButton && (
          <button
            type="button"
            onClick={actionButton.onClick}
            className={`ml-14 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              tone === 'red' ? 'text-red-400 hover:text-red-300' : 'text-amber-400 hover:text-amber-300'
            }`}
          >
            <ExternalLink className="h-3 w-3" />
            {actionButton.label}
          </button>
        )}
      </div>
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

  const navigate = useNavigate();
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

      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard
          label="Tmux status"
          icon={<Terminal className="h-4 w-4" />}
          {...tmuxCard}
          actionButton={tmuxCard.tone === 'red' || tmuxCard.tone === 'amber' ? {
            label: 'View Logs',
            onClick: () => navigate('/audit'),
          } : undefined}
        />
        <StatusCard
          label="Claude CLI"
          icon={<Bot className="h-4 w-4" />}
          {...claudeCard}
          actionButton={claudeCard.tone === 'red' ? {
            label: 'Troubleshoot →',
            onClick: () => navigate('/settings'),
          } : claudeCard.tone === 'amber' ? {
            label: 'Check Requirements',
            onClick: () => navigate('/settings'),
          } : undefined}
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
