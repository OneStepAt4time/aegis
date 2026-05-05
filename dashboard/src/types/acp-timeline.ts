/**
 * types/acp-timeline.ts — Types for the ACP operator timeline view.
 *
 * Matches the normalized event model from epic §11.5:
 *   - driver claimed/released/transferred/revoked
 *   - prompt submitted
 *   - tool started/completed/failed
 *   - approval requested/responded/timed out
 *   - session paused/resumed
 *   - intervention started/completed
 *   - child process restart
 *   - ACP protocol errors
 *   - Redis/Postgres health transitions
 *   - actor and tenant attribution
 */

/** Timeline event categories for filtering. */
export type AcpTimelineCategory =
  | 'driver'
  | 'prompt'
  | 'tool'
  | 'approval'
  | 'session'
  | 'intervention'
  | 'system'
  | 'error';

/** A single timeline event. */
export interface AcpTimelineEvent {
  id: string;
  /** Event timestamp (ISO string). */
  timestamp: string;
  /** Event category for filtering and icon selection. */
  category: AcpTimelineCategory;
  /** Human-readable event description. */
  description: string;
  /** Optional structured details. */
  details?: AcpTimelineEventDetails;
  /** Actor who triggered the event (username or 'system'). */
  actor?: string;
  /** Tenant attribution (enterprise). */
  tenant?: string;
}

/** Structured details for specific event types. */
export interface AcpTimelineEventDetails {
  /** For tool events: tool name. */
  toolName?: string;
  /** For tool events: tool status. */
  toolStatus?: 'started' | 'completed' | 'failed' | 'cancelled';
  /** For approval events: approval ID. */
  approvalId?: string;
  /** For approval events: approval decision. */
  approvalDecision?: 'approved' | 'rejected' | 'timed_out';
  /** For driver events: old and new driver. */
  driverFrom?: string;
  driverTo?: string;
  /** For driver events: transfer type. */
  driverAction?: 'claimed' | 'released' | 'transferred' | 'revoked';
  /** For session events: session state change. */
  sessionFrom?: string;
  sessionTo?: string;
  /** For error events: error code. */
  errorCode?: string;
  /** For error events: error message. */
  errorMessage?: string;
  /** Duration in milliseconds (for tool events). */
  durationMs?: number;
  /** Token usage snapshot (for prompt/completion events). */
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

/** Timeline view configuration. */
export interface AcpTimelineConfig {
  /** Maximum events to display (default: 100). */
  maxEvents?: number;
  /** Whether to auto-scroll to latest event. */
  autoScroll?: boolean;
  /** Default filter categories (empty = show all). */
  defaultFilters?: AcpTimelineCategory[];
  /** Whether to show timestamps in relative format. */
  relativeTime?: boolean;
}

/** Timeline filter state. */
export interface AcpTimelineFilters {
  /** Active category filters. */
  categories: Set<AcpTimelineCategory>;
  /** Text search query. */
  search: string;
  /** Actor filter. */
  actor?: string;
}
