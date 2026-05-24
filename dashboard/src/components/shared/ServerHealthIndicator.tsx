/**
 * components/shared/ServerHealthIndicator.tsx — Server connection health dot + banner.
 *
 * Shows in the sidebar footer:
 * - Green dot + "Connected" when Aegis server is healthy
 * - Amber dot + "Reconnecting…" when temporarily disconnected
 * - Red dot + "Server unreachable" when down for >60s
 *
 * Also shows a top banner when disconnected for extended time.
 */

import { useServerHealth, type ServerHealthStatus } from '../../hooks/useServerHealth';
import { Wifi, WifiOff, Loader2, AlertTriangle } from 'lucide-react';

const STATUS_CONFIG: Record<ServerHealthStatus, { color: string; label: string; Icon: typeof Wifi }> = {
  connected: { color: 'text-[var(--color-success)]', label: 'Connected', Icon: Wifi },
  reconnecting: { color: 'text-[var(--color-warning)]', label: 'Reconnecting…', Icon: Loader2 },
  disconnected: { color: 'text-[var(--color-danger)]', label: 'Server unreachable', Icon: WifiOff },
  checking: { color: 'text-[var(--color-text-muted)]', label: 'Checking…', Icon: Loader2 },
};

export function ServerHealthDot() {
  const health = useServerHealth();
  const config = STATUS_CONFIG[health.status];

  return (
    <div className="flex items-center gap-2 px-3 py-2" role="status" aria-label={`Server status: ${config.label}`}>
      <config.Icon
        className={`h-3.5 w-3.5 ${config.color} ${health.status === 'reconnecting' || health.status === 'checking' ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span className={`text-xs font-medium ${config.color}`}>
        {config.label}
      </span>
    </div>
  );
}

export function ServerHealthBanner() {
  const health = useServerHealth();

  if (health.status !== 'disconnected' || !health.errorMessage) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-50 flex h-9 items-center justify-center gap-2 bg-[var(--color-danger)]/15 border-b border-[var(--color-danger)]/30 text-xs font-medium backdrop-blur-sm"
      data-testid="server-health-banner"
    >
      <AlertTriangle className="h-3.5 w-3.5 text-[var(--color-danger)]" aria-hidden="true" />
      <span className="text-[var(--color-danger)]">{health.errorMessage}</span>
    </div>
  );
}
