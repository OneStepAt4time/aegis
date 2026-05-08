/**
 * sessionTableUtils.ts — Shared types and utilities for SessionTable components.
 * @ticket #2932
 */

import type { MouseEvent } from 'react';
import type { SessionInfo, SessionHealthState, SessionStatusFilter } from '../../types';

/** Props shared by SessionMobileCard and SessionDesktopRow */
export interface SessionRowProps {
  session: SessionInfo;
  isAlive: boolean;
  health: SessionHealthState | null;
  selected: boolean;
  currentAction: string | null;
  estimatedCostUsd: number;
  isFocused: boolean;
  onToggleSelect: (id: string, checked: boolean) => void;
  onApprove: (e: MouseEvent, id: string) => void;
  onInterrupt: (e: MouseEvent, id: string) => void;
  onKill: (e: MouseEvent, id: string) => void;
}

export interface SessionsPaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SessionRowViewModel {
  session: SessionInfo;
  isAlive: boolean;
  health: SessionHealthState | null;
  estimatedCostUsd?: number;
  selected: boolean;
  currentAction: string | null;
  isFocused: boolean;
}

export function formatStatusLabel(status: SessionStatusFilter): string {
  switch (status) {
    case 'all': return 'All';
    case 'idle': return 'Idle';
    case 'working': return 'Working';
    case 'compacting': return 'Compacting';
    case 'context_warning': return 'Context Warning';
    case 'waiting_for_input': return 'Waiting';
    case 'permission_prompt': return 'Permission Prompt';
    case 'plan_mode': return 'Plan Mode';
    case 'ask_question': return 'Ask';
    case 'bash_approval': return 'Bash Approval';
    case 'settings': return 'Settings';
    case 'error': return 'Error';
    case 'rate_limit': return 'Rate Limit';
    case 'unknown': return 'Unknown';
    default: return status;
  }
}

export function matchesSearch(session: SessionInfo, query: string): boolean {
  const q = query.toLowerCase();
  return (
    (session.displayName?.toLowerCase().includes(q) ?? false) ||
    session.id.toLowerCase().includes(q) ||
    session.status.toLowerCase().includes(q)
  );
}

export function isDisplayedSessionEqual(a: SessionInfo, b: SessionInfo): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.displayName === b.displayName &&

    a.lastActivity === b.lastActivity
  );
}

export function areSessionRowPropsEqual(prev: SessionRowProps, next: SessionRowProps): boolean {
  return (
    prev.selected === next.selected &&
    prev.currentAction === next.currentAction &&
    prev.isFocused === next.isFocused &&
    prev.estimatedCostUsd === next.estimatedCostUsd &&
    prev.isAlive === next.isAlive &&
    isDisplayedSessionEqual(prev.session, next.session) &&
    prev.health === next.health
  );
}


export const needsApproval = (session: SessionInfo): boolean =>
  session.status === 'permission_prompt' || session.status === 'bash_approval';

export const truncateDir = (dir: string, max = 40): string => {
  const normalized = dir.replace(/\\/g, '/');
  const abbreviated = normalized
    .replace(/^\/home\/[^/]+\//, '~/')
    .replace(/^[A-Z]:\/Users\/[^/]+\//i, (m) => `${m[0]}:/…/`);
  if (abbreviated.length <= max) return abbreviated;
  const segments = abbreviated.split('/');
  let result = segments[segments.length - 1] || abbreviated;
  for (let i = segments.length - 2; i >= 0; i--) {
    const candidate = segments.slice(i).join('/');
    if (candidate.length > max) break;
    result = candidate;
  }
  return result;
};
