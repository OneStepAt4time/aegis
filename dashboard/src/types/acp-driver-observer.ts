/**
 * types/acp-driver-observer.ts — Frontend types for ACP driver/observer model.
 *
 * Matches the backend driver lock and presence types from
 * src/services/acp/redis-coordination.ts and epic §9.1.
 *
 * Roles:
 *   - Driver: send prompts, request cancel, request pause/resume (requires `send` permission)
 *   - Observer: read chat, timeline, terminal, transcript, metrics (read-only)
 *   - Operator: revoke stale driver, force pause, inspect health, transfer control
 *   - Admin: operator capabilities plus configuration and emergency control
 */

/** ACP realtime subscriber role. */
export type AcpSubscriberRole = 'driver' | 'observer' | 'worker' | 'system';

/** UI-facing role for display purposes (worker/system are internal). */
export type AcpDisplayRole = 'driver' | 'observer' | 'operator' | 'admin';

/** Information about a connected subscriber. */
export interface AcpPresenceRecord {
  sessionId: string;
  subscriberId: string;
  role: AcpSubscriberRole;
  metadata?: Record<string, string | number | boolean | null>;
  expiresAt?: number;
}


/** Request body to claim the driver role. */
export interface AcpClaimDriverRequest {
  holderId?: string;
  ttlMs?: number;
}

/** Request body to release the driver role. */
export interface AcpReleaseDriverRequest {
  holderId?: string;
}

/** Request body to transfer driver to another subscriber. */
export interface AcpTransferDriverRequest {
  targetSubscriberId: string;
  reason?: string;
}

/** Result of a driver claim/release/transfer action. */
export interface AcpDriverActionResult {
  sessionId: string;
  holderId: string | null;
  role: AcpSubscriberRole;
  fence?: number;
  ttlMs?: number;
}

/** Active session participants for display. */
export interface AcpSessionParticipants {
  driver: AcpPresenceRecord | null;
  observers: AcpPresenceRecord[];
  activeCount: number;
}


/** Role color mapping for UI badges. */
export const ROLE_COLORS: Record<AcpDisplayRole, { bg: string; text: string }> = {
  driver: { bg: 'bg-[var(--color-info)]/20', text: 'text-[var(--color-info-glow)]' },
  observer: { bg: 'bg-zinc-500/20', text: 'text-zinc-400' },
  operator: { bg: 'bg-[var(--color-warning)]/20', text: 'text-[var(--color-warning-glow)]' },
  admin: { bg: 'bg-[var(--color-danger)]/20', text: 'text-[var(--color-danger-glow)]' },
};
