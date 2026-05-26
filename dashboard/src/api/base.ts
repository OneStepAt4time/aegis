/**
 * api/base.ts — Shared API client infrastructure.
 *
 * Provides the fetch wrapper, auth helpers, and constants used by all domain modules.
 */

import { z } from 'zod';

import type { UIState, ApiError } from '../types';

// ── Constants ──────────────────────────────────────────────────

export const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';
export const OIDC_LOGIN_PATH = '/auth/login';
export const SESSION_STATUS_VALUES: UIState[] = [
  'idle',
  'working',
  'compacting',
  'context_warning',
  'waiting_for_input',
  'permission_prompt',
  'plan_mode',
  'ask_question',
  'bash_approval',
  'settings',
  'error',
  'rate_limit',
  'unknown',
];

// ── Token & Unauthorized ───────────────────────────────────────

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// #1924: Token is held in memory by the auth store and read via this accessor.
// No persistence to localStorage — reduces XSS token-theft exposure.
let tokenAccessor: (() => string | null) = () => null;

export function setTokenAccessor(fn: () => string | null): void {
  tokenAccessor = fn;
}

// ── Helpers ──────────────────────────────────────────────────────

/** Build auth headers using the in-memory token accessor. Used by ACP sub-clients. */
export function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = tokenAccessor();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const obj: Record<string, string> = {};
    h.forEach((v, k) => { obj[k] = v; });
    return obj;
  }
  return h as Record<string, string>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── Runtime validation (defensive, non-blocking) ─────────────────

import { logger } from '../utils/logger';

/**
 * Validates raw API data against a Zod schema.
 * On mismatch, throws an Error with validation failure details.
 */
export function validateResponse<T>(data: unknown, schema: z.ZodType<T>, context: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  logger.error('aegis', 'API response validation failed (%s):', context, result.error.issues);
  throw new Error('API response validation failed for ' + context + ': ' + result.error.issues.map(i => i.message).join(', '));
}

// ── Error classification ────────────────────────────────────────

/** Returns true if the error is a transient failure worth retrying. */
export function isRetryableError(error: Error): boolean {
  if (error.name === 'AbortError') return false;
  if (!error.message) return false;
  if (error.message.includes('HTTP ')) return false;
  // Validation failures are deterministic — retrying won't help
  if (error.message.includes('validation failed') || error.message.includes('validateResponse')) return false;
  return true;
}

// ── Fetch wrapper ───────────────────────────────────────────────

export interface RequestOptions extends RequestInit {
  /** AbortSignal for request cancellation (e.g., from useEffect cleanup) */
  signal?: AbortSignal;
  /** Number of retry attempts for transient failures (default: 0, no retry) */
  retries?: number;
  /** Optional Zod schema for runtime response validation (defensive, non-blocking) */
  schema?: z.ZodType<unknown>;
  /** Label for validation warnings (used with schema) */
  schemaContext?: string;
}

export async function requestResponse(
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  const token = tokenAccessor();
  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headersToObject(options.headers),
  };

  const { retries = 0, ...fetchOptions } = options;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        ...fetchOptions,
        credentials: fetchOptions.credentials ?? 'include',
        headers,
      });
      if (!res.ok) {
        if (res.status === 401) {
          unauthorizedHandler?.();
          if (!unauthorizedHandler && window.location.pathname !== '/dashboard/login') {
            window.location.assign('/dashboard/login');
          }
          throw new Error('Unauthorized');
        }
        const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
        const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & { statusCode: number };
        err.statusCode = res.status;
        throw err;
      }
      return res;
    } catch (e) {
      lastError = e as Error;
      // Retry only on transient network errors (not HTTP errors or AbortError)
      if (attempt < retries && isRetryableError(lastError)) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      } else {
        throw lastError;
      }
    }
  }
  throw lastError ?? new Error(`Request failed for ${path}`);
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { schema, schemaContext, ...requestOptions } = options;
  const res = await requestResponse(path, requestOptions);
  const data = await res.json();
  if (schema) return validateResponse(data, schema as z.ZodType<T>, schemaContext ?? path);
  return data as T;
}
