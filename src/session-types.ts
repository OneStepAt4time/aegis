/**
 * session-types.ts — Shared types for session management.
 *
 * Extracted from session.ts (#4228): breaks circular dependencies
 * and provides clean type imports for all session-related modules.
 */

import type { z } from 'zod';
import type { persistedStateSchema, PermissionPolicy, PermissionProfile } from './validation.js';
import type { PendingPermissionInfo, PendingQuestionInfo } from './api-contracts.js';

/** UI states for Claude Code sessions. */
export type UIState =
  | 'idle' | 'working' | 'compacting' | 'context_warning'
  | 'waiting_for_input' | 'permission_prompt' | 'plan_mode'
  | 'ask_question' | 'bash_approval' | 'settings' | 'error' | 'pending' | 'unknown'
  | 'killed' | 'completed' | 'crashed';

/**
 * Canonical runtime metadata for an Aegis-managed Claude Code session.
 *
 * This structure is persisted to disk and reused by the REST API, SSE layer,
 * monitoring loop, and session recovery logic.
 */
export interface SessionInfo {
  id: string;                    // Our bridge session ID (UUID)
  windowId: string;              // session identifier (reserved, empty in ACP mode)
  displayName: string;           // session label
  workDir: string;               // Working directory
  claudeSessionId?: string;      // CC's own session ID (from hook)
  jsonlPath?: string;            // Path to the JSONL file
  byteOffset: number;            // Last read byte offset (for API reads)
  monitorOffset: number;         // Last read byte offset (for monitor/telegram)
  status: UIState;               // Current UI state
  createdAt: number;             // Unix timestamp
  lastActivity: number;          // Unix timestamp of last activity
  stallThresholdMs: number;      // Per-session stall threshold (Issue #4)
  permissionStallMs: number;     // Per-session permission stall threshold (Issue #89 L8)
  permissionMode: string;        // Permission mode: "default"|"plan"|"acceptEdits"|"bypassPermissions"|"dontAsk"|"auto"
  settingsPatched?: boolean;     // Permission guard: settings.local.json was patched
  hookSettingsFile?: string;     // Temp file with HTTP hook settings (Issue #169)
  hookSecret?: string;           // Per-session secret for hook URL authentication (Issue #629)
  lastHookAt?: number;           // Unix timestamp of last received hook event (Issue #169 Phase 3)
  activeSubagents?: Set<string>;    // Active subagent names (Issue #88, #357: Set for O(1))
  // Issue #87: Latency metrics
  permissionPromptAt?: number;   // Unix timestamp when permission prompt was detected
  permissionRespondedAt?: number; // Unix timestamp when user approved/rejected
  lastHookReceivedAt?: number;   // Unix timestamp when last hook was received by Aegis
  lastHookEventAt?: number;      // Unix timestamp from the hook payload (CC's timestamp)
  model?: string;                // Issue #89 L25: Model name from hook payload (e.g. "claude-sonnet-4-6")
  lastDeadAt?: number;           // Unix timestamp when session was detected as dead (Issue #283)
  ccPid?: number;                // PID of the Claude Code process (Issue #353: swarm parent matching)
  parentId?: string;             // Issue #702: Parent session ID for sub-agent hierarchy
  children?: string[];          // Issue #702: Child session IDs for sub-agent hierarchy
  permissionPolicy?: PermissionPolicy;  // Issue #700: Dynamic permission rules
  permissionProfile?: PermissionProfile; // Issue #742: Per-session tool permission profile
  prd?: string;                // Issue #735: Optional PRD contract text attached to the session
  ownerKeyId?: string;         // Issue #1429: API key ID that created this session (ownership)
  tenantId?: string;           // Issue #1944: Tenant isolation scoping
  autoApprove?: boolean;        // API contract compat: auto-approve flag
  pendingPermission?: PendingPermissionInfo;  // API contract compat: active permission prompt
  pendingQuestion?: PendingQuestionInfo;       // API contract compat: active question
  promptDelivery?: { delivered: boolean; attempts: number; status?: "pending" | "delivered" | "failed" | "timeout" };  // Issue #3243: async prompt delivery status
  actionHints?: Record<string, { method: string; url: string; description: string }>;  // API contract compat: actionable hints
  // Issue #2518: Hook failure circuit breaker
  hookFailureTimestamps?: number[];   // Sliding window of StopFailure timestamps (ms)
  circuitBreakerTripped?: boolean;    // True once the circuit breaker has fired
  // Issue #2520: Premature termination detection for background agents
  toolUseCount?: number;               // Count of PreToolUse hook events
  prematureTermination?: boolean;       // True when session ended with suspiciously low tool use
}

/** Persisted session store keyed by Aegis session ID. */
export interface SessionState {
  sessions: Record<string, SessionInfo>;
}

/** Re-export zod inferred type for persisted state */
export type PersistedStateData = z.infer<typeof persistedStateSchema>;
