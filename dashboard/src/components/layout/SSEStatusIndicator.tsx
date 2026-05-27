/**
 * SSEStatusIndicator — Subtle persistent indicator for SSE connection state.
 * Shows a colored dot + label: green "Live", yellow "Reconnecting…", red "Offline".
 */

import { useStore } from '../../store/useStore';

export function SSEStatusIndicator() {
  const sseConnected = useStore((s) => s.sseConnected);
  const sseError = useStore((s) => s.sseError);

  // Don't render until we have a connection attempt (avoid flash on initial load)
  if (!sseConnected && !sseError) return null;

  const label = sseConnected ? 'Live' : sseError ? 'Reconnecting…' : 'Offline';
  const color = sseConnected
    ? 'var(--color-success)'
    : sseError
      ? 'var(--color-warning)'
      : 'var(--color-error)';

  return (
    <div
      className="flex items-center gap-1.5 text-xs"
      role="status"
      aria-label={`SSE connection: ${label}`}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
        style={{ backgroundColor: color }}
      />
      <span className="text-[var(--color-text-muted)]">{label}</span>
    </div>
  );
}
