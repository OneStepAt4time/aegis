/**
 * error-categories.ts — Structured error categorization and retry guidance.
 *
 * Issue #701: Provides an ErrorCode enum, categorize() function to inspect
 * unknown errors and return structured metadata, and shouldRetry() helper.
 */

import { TmuxTimeoutError } from './tmux.js';

/** String enum of Aegis error codes. */
export enum ErrorCode {
  /** Session not found, already deleted, or in wrong state. */
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  /** Session creation failed (tmux window, CC launch). */
  SESSION_CREATE_FAILED = 'SESSION_CREATE_FAILED',
  /** Permission request was rejected by the user. */
  PERMISSION_REJECTED = 'PERMISSION_REJECTED',
  /** Tmux command timed out. */
  TMUX_TIMEOUT = 'TMUX_TIMEOUT',
  /** Tmux operation failed (non-timeout). */
  TMUX_ERROR = 'TMUX_ERROR',
  /** Request body or parameter failed validation. */
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  /** Authentication failed (missing/invalid token). */
  AUTH_ERROR = 'AUTH_ERROR',
  /** Rate limit exceeded. */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Network or I/O error (transient). */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** Unexpected internal error. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Structured result returned by categorize(). */
export interface CategorizedError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

/** Inspect an unknown error and return a structured categorization. */
export function categorize(error: unknown): CategorizedError {
  // 1. Known typed errors
  if (error instanceof TmuxTimeoutError) {
    return { code: ErrorCode.TMUX_TIMEOUT, message: error.message, retryable: true };
  }

  if (error instanceof Error) {
    const msg = error.message;
    const lower = msg.toLowerCase();

    // 2. Message-based heuristics for common Aegis error patterns
    if (lower.includes('session not found') || lower.includes('no session with id')) {
      return { code: ErrorCode.SESSION_NOT_FOUND, message: msg, retryable: false };
    }
    if (lower.includes('permission denied') || lower.includes('permission rejected')) {
      return { code: ErrorCode.PERMISSION_REJECTED, message: msg, retryable: false };
    }
    if (lower.includes('unauthorized') || lower.includes('invalid token') || lower.includes('authentication')) {
      return { code: ErrorCode.AUTH_ERROR, message: msg, retryable: false };
    }
    if (lower.includes('rate limit') || lower.includes('too many requests')) {
      return { code: ErrorCode.RATE_LIMITED, message: msg, retryable: true };
    }
    if (lower.includes('validation') || lower.includes('invalid ') || lower.includes('required')) {
      return { code: ErrorCode.VALIDATION_ERROR, message: msg, retryable: false };
    }
    if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('etimedout') || lower.includes('fetch failed')) {
      return { code: ErrorCode.NETWORK_ERROR, message: msg, retryable: true };
    }
    if (lower.includes('tmux')) {
      return { code: ErrorCode.TMUX_ERROR, message: msg, retryable: true };
    }

    // 3. Generic Error fallback
    return { code: ErrorCode.INTERNAL_ERROR, message: msg, retryable: false };
  }

  // 4. Non-Error values
  const msg = typeof error === 'string' ? error : String(error);
  return { code: ErrorCode.INTERNAL_ERROR, message: msg, retryable: false };
}

/** Return true if the error is worth retrying. */
export function shouldRetry(error: unknown): boolean {
  return categorize(error).retryable;
}
