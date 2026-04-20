/**
 * utils/formatNumber.ts — Number formatting using Intl.NumberFormat.
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
 * Format a number with locale-aware separators.
 */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  const locale = getLocale();
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * Format a number as currency (USD by default).
 */
export function formatCurrency(
  value: number,
  currency: string = 'USD',
  options?: Intl.NumberFormatOptions
): string {
  const locale = getLocale();
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
    ...options,
  }).format(value);
}

/**
 * Format a number as a percentage.
 */
export function formatPercent(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  const locale = getLocale();
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

/**
 * Format a large number with compact notation (e.g., 1.2K, 3.5M).
 */
export function formatCompact(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  const locale = getLocale();
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
    ...options,
  }).format(value);
}

/**
 * Format bytes as human-readable size (e.g., 1.2 KB, 3.5 MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${formatNumber(value, { maximumFractionDigits: 1 })} ${sizes[i]}`;
}
