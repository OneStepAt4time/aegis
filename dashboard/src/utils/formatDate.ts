/**
 * utils/formatDate.ts — Date formatting using Intl.DateTimeFormat.
 * Respects user's locale preference from settings.
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
 * Format a date/timestamp in a locale-aware way.
 */
export function formatDate(
  date: Date | number | string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const locale = getLocale();
  
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };
  
  return new Intl.DateTimeFormat(locale, options || defaultOptions).format(d);
}

/**
 * Format a date for short display (e.g., "Jan 15").
 */
export function formatDateShort(date: Date | number | string): string {
  return formatDate(date, { month: 'short', day: 'numeric' });
}

/**
 * Format a date with time (e.g., "Jan 15, 2025, 3:45 PM").
 */
export function formatDateTime(date: Date | number | string): string {
  return formatDate(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a date as ISO date string (YYYY-MM-DD).
 */
export function formatDateIso(date: Date | number | string): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}
