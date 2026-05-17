/**
 * types/session-isolation.ts — Forward-compatible isolation mode extension.
 *
 * CC v2.1.143 added `worktree.bgIsolation: "none"` — sessions can edit the
 * working copy directly. Aegis needs to surface this in the dashboard.
 *
 * These optional fields will be provided by the backend API after #3590 lands.
 * Until then, they default to undefined and UI components degrade gracefully.
 */

import type { SessionInfo } from './index';

export type IsolationMode = 'worktree' | 'none';

export interface IsolationSessionInfo extends SessionInfo {
  /** Session isolation mode. Undefined = not yet detected (assume worktree). */
  isolationMode?: IsolationMode;
}
