/**
 * utils/logger.ts — Controlled logging for the dashboard.
 *
 * In development: logs to console with prefixed labels.
 * In production: suppresses warn/debug, surfaces errors to console.error
 * (for error-tracking integrations to pick up).
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const isDev = import.meta.env.DEV;

function log(level: LogLevel, prefix: string, ...args: unknown[]): void {
  if (isDev) {
    // eslint-disable-next-line no-console
    console[level](`[${prefix}]`, ...args);
    return;
  }

  // In production, only surface errors
  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(`[${prefix}]`, ...args);
  }
}

/** Dev-only debug log. Silenced in production. */
export const logger = {
  debug(prefix: string, ...args: unknown[]) { log('debug', prefix, ...args); },
  info(prefix: string, ...args: unknown[]) { log('info', prefix, ...args); },
  warn(prefix: string, ...args: unknown[]) { log('warn', prefix, ...args); },
  error(prefix: string, ...args: unknown[]) { log('error', prefix, ...args); },
} as const;
