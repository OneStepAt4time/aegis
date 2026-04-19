/**
 * utils/formatRelativeTime.ts — Relative time formatting using Intl.RelativeTimeFormat.
 * Replaces manual "5m ago" patterns with proper i18n-aware formatting.
 */

const LOCALE_STORAGE_KEY = 'aegis:locale';

function getLocale(): string {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  return navigator.language || 'en-US';
}

/**
 * Format a timestamp as relative time (e.g., "5 minutes ago", "in 2 hours").
 */
export function formatRelativeTime(
  timestamp: number | Date,
  options?: Intl.RelativeTimeFormatOptions
): string {
  const now = Date.now();
  const then = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  const diffMs = then - now;
  const diffSeconds = Math.round(diffMs / 1000);
  
  const locale = getLocale();
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: 'auto',
    style: 'long',
    ...options,
  });
  
  // Choose the appropriate unit based on magnitude
  const absSeconds = Math.abs(diffSeconds);
  
  if (absSeconds < 60) {
    return rtf.format(diffSeconds, 'second');
  }
  
  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute');
  }
  
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, 'hour');
  }
  
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return rtf.format(diffDays, 'day');
  }
  
  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) {
    return rtf.format(diffMonths, 'month');
  }
  
  const diffYears = Math.round(diffMonths / 12);
  return rtf.format(diffYears, 'year');
}

/**
 * Format a timestamp as short relative time (e.g., "5m ago", "2h ago").
 * Uses 'short' style for compact display.
 */
export function formatRelativeTimeShort(timestamp: number | Date): string {
  return formatRelativeTime(timestamp, { style: 'short' });
}

/**
 * Format a timestamp as "time ago" (always in the past).
 * If the timestamp is in the future, returns "just now".
 */
export function formatTimeAgo(timestamp: number | Date): string {
  const now = Date.now();
  const then = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  
  if (then > now) {
    return 'just now';
  }
  
  return formatRelativeTime(then);
}

/**
 * Format a timestamp as short "time ago" (e.g., "5m ago").
 */
export function formatTimeAgoShort(timestamp: number | Date): string {
  const now = Date.now();
  const then = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  
  if (then > now) {
    return 'now';
  }
  
  return formatRelativeTimeShort(then);
}
