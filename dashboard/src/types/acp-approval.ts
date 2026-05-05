/**
 * types/acp-approval.ts — Frontend types for ACP approval flow.
 *
 * Matches the backend control action types (approve/reject) from
 * src/services/acp/types.ts and epic §7.2 (session state machine).
 *
 * Approval flow:
 *   1. Agent requests tool approval → session enters `awaiting_approval`
 *   2. Dashboard shows ApprovalModal with tool details + TTL countdown
 *   3. Operator approves/rejects → control action submitted
 *   4. Session resumes or times out → `approval_timeout` → paused/failed
 */

/** Tool information included in an approval request. */
export interface AcpToolApprovalInfo {
  /** The tool name being requested (e.g., 'bash', 'edit_file'). */
  toolName: string;
  /** Human-readable description of what the tool will do. */
  description: string;
  /** The tool input/payload (may be truncated for display). */
  input?: Record<string, unknown>;
  /** Risk level of the tool call. */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

/** Approval request as received from SSE/event stream. */
export interface AcpApprovalRequest {
  /** Unique approval ID for idempotent response. */
  approvalId: string;
  /** Session this approval belongs to. */
  sessionId: string;
  /** The tool being approved. */
  tool: AcpToolApprovalInfo;
  /** When the approval was requested (ISO string). */
  requestedAt: string;
  /** When the approval times out (ISO string). Null = no timeout. */
  expiresAt?: string;
  /** Which subscriber requested the approval (driver ID). */
  requestedBy?: string;
}

/** Response body for approving a tool. */
export interface AcpApproveRequest {
  approvalId: string;
  /** Optional reason for audit log. */
  reason?: string;
}

/** Response body for rejecting a tool. */
export interface AcpRejectRequest {
  approvalId: string;
  /** Optional reason for audit log. */
  reason?: string;
}

/** Result of an approve/reject action. */
export interface AcpApprovalActionResult {
  sessionId: string;
  approvalId: string;
  action: 'approved' | 'rejected';
  timestamp: string;
}

/** Risk level styling config. */
export const RISK_LEVEL_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  low: { label: 'Low Risk', bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
  medium: { label: 'Medium Risk', bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  high: { label: 'High Risk', bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30' },
  critical: { label: 'Critical Risk', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30' },
};
