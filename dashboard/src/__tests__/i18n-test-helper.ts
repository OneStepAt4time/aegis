/**
 * i18n test helper — resolves translation keys from the English catalog.
 *
 * Use in vi.mock() to make tests assert against real user-facing text
 * instead of raw i18n keys like 'activity.noActivity'.
 *
 * Usage:
 *   vi.mock('../../i18n/context', () => {
 *     const { testT } = await import('../../__tests__/i18n-test-helper');
 *     return { useT: () => testT };
 *   });
 */
import { en } from '../i18n/en';

function resolve(obj: unknown, key: string): string {
  const parts = key.split('.');
  let result: unknown = obj;
  for (const part of parts) {
    if (result && typeof result === 'object' && part in (result as Record<string, unknown>)) {
      result = (result as Record<string, unknown>)[part];
    } else {
      return key; // key not found, return as-is
    }
  }
  return typeof result === 'string' ? result : key;
}

/** test-compatible `t()` that resolves from the English catalog. */
export const testT = (key: string, params?: Record<string, string | number>): string => {
  let result = resolve(en, key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{${k}}`, String(v));
    }
  }
  return result;
};
