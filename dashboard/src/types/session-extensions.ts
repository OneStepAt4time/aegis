/**
 * types/session-extensions.ts — Forward-compatible extensions to SessionInfo.
 *
 * These optional fields will be provided by the backend API in a future update.
 * Until then, they default to undefined and UI components degrade gracefully.
 *
 * Usage: cast SessionInfo to ExtendedSessionInfo where model/effort is needed.
 */

import type { SessionInfo } from './index';

export interface ExtendedSessionInfo extends SessionInfo {
  /** Effort level for this session (e.g. "high", "medium", "low", "0.8"). Undefined for older sessions. */
  effort?: string;
}
