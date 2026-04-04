/**
 * shutdown-utils.ts — reusable shutdown helpers for server signal handling.
 */

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

export function parseShutdownTimeoutMs(
  rawValue: string | undefined,
  fallbackMs: number = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1_000) return fallbackMs;
  return Math.floor(parsed);
}

export function isWindowsShutdownMessage(message: unknown): boolean {
  if (typeof message === 'string') {
    const normalized = message.trim().toLowerCase();
    return normalized === 'shutdown' || normalized === 'graceful-shutdown';
  }

  if (typeof message === 'object' && message !== null && 'type' in message) {
    const typeValue = (message as { type?: unknown }).type;
    if (typeof typeValue === 'string') {
      const normalized = typeValue.trim().toLowerCase();
      return normalized === 'shutdown' || normalized === 'graceful-shutdown';
    }
  }

  return false;
}
