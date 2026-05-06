/**
 * types/acp-pause.ts — Frontend types for ACP pause/resume/intervention.
 *
 * Matches the backend AcpPauseInterventionRecord and related types
 * from src/services/acp/pause-intervention.ts and session-service.ts.
 *
 * NOTE: These are placeholder types aligned with the backend contracts.
 * They will be finalized once the REST endpoints are defined in ACP-064.
 */

/** Status of a pause intervention. */
export type AcpPauseInterventionStatus =
  | 'paused'
  | 'intervening'
  | 'resumed';

/** Metadata attached to pause/resume actions. */
export type AcpPauseInterventionMetadata = Record<string, string | number | boolean | null>;

/** Full pause intervention record as returned by the API. */
export interface AcpPauseInterventionRecord {
  pauseId: string;
  sessionId: string;
  status: AcpPauseInterventionStatus;
  idempotencyKey?: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  metadata?: AcpPauseInterventionMetadata;
  /** Set when an intervention is started. */
  interventionId?: string;
  interventionBy?: string;
  interventionStartedAt?: string;
  interventionCompletedBy?: string;
  interventionCompletedAt?: string;
  /** Guidance provided when completing an intervention. */
  guidance?: string;
  /** Set when the session is resumed. */
  resumeId?: string;
  resumedBy?: string;
  resumedAt?: string;
  resumeMetadata?: AcpPauseInterventionMetadata;
  updatedAt: string;
}

/** Request body for pausing a session. */
export interface AcpPauseSessionRequest {
  reason: string;
  requestedBy?: string;
  idempotencyKey?: string;
  metadata?: AcpPauseInterventionMetadata;
}

/** Request body for starting an intervention on a paused session. */
export interface AcpStartInterventionRequest {
  interventionBy?: string;
}

/** Request body for completing an intervention. */
export interface AcpCompleteInterventionRequest {
  completedBy?: string;
  guidance?: string;
}

/** Request body for resuming a session. */
export interface AcpResumeSessionRequest {
  resumedBy?: string;
  resumeMetadata?: AcpPauseInterventionMetadata;
}

/** Request body for cancelling a session turn. */
export interface AcpCancelSessionRequest {
  force?: boolean;
}

/** Combined result returned by pause/resume/intervention endpoints. */
export interface AcpPauseInterventionPolicyResult {
  session: {
    id: string;
    status: string;
    updatedAt: string;
  };
  pause: AcpPauseInterventionRecord;
}
