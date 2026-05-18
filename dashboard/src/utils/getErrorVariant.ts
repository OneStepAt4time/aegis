/**
 * utils/getErrorVariant.ts — Map API/network errors to ErrorState variant.
 *
 * The API client (api/client.ts) attaches `statusCode` to thrown errors.
 * Network failures throw plain Error without statusCode.
 * This utility maps both patterns to the correct ErrorState variant.
 */

import type { ErrorVariant } from '../components/ErrorState';

interface ApiError extends Error {
  statusCode?: number;
}

/**
 * Map an error to the appropriate ErrorState variant.
 *
 * - No statusCode + "Failed to fetch" → offline
 * - No statusCode + "timeout" / "AbortError" → timeout
 * - 403 → unauthorized
 * - 429 → rate-limited
 * - 404 → not-found
 * - 5xx → server-5xx
 * - Other → server-5xx (safe default)
 */
export function getErrorVariant(error: unknown): ErrorVariant {
  const err = error as ApiError;

  // Network errors (no statusCode)
  if (!err?.statusCode) {
    const msg = (err?.message ?? '').toLowerCase();

    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('net::')) {
      return 'offline';
    }

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
      return 'timeout';
    }

    // Unknown error without status code — assume server issue
    return 'server-5xx';
  }

  // HTTP status code based mapping
  const status = err.statusCode;

  if (status === 403) return 'unauthorized';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server-5xx';

  // 4xx other than 403/404/429 — treat as server error for UX
  return 'server-5xx';
}
