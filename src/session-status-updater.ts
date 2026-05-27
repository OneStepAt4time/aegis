/**
 * session-status-updater.ts — Hook-to-status mapping for session state.
 *
 * Extracted from SessionManager (#4246 step 3).
 * Maps incoming hook events to session status transitions and
 * tracks premature termination detection.
 */

import { StructuredLogger } from './logger.js';
import type { SessionInfo, UIState } from './session-types.js';

const log = new StructuredLogger();

/** Premature termination thresholds (configurable via env). */
const PREMATURE_MIN_TOOLS = parseInt(process.env.PREMATURE_TERMINATION_MIN_TOOLS ?? '30', 10);
const PREMATURE_MIN_DURATION_MS = parseInt(process.env.PREMATURE_TERMINATION_MIN_DURATION_MS ?? '30000', 10);

/**
 * Apply a hook event to a session, updating its status and tracking fields.
 *
 * Returns the previous status (for change-detection) or null if no session provided.
 * Mutates the session object in place.
 */
export function applyHookEvent(
  session: SessionInfo,
  hookEvent: string,
  hookTimestamp?: number,
): UIState | null {
  const prevStatus = session.status;
  const now = Date.now();

  // Map hook events to UI states
  switch (hookEvent) {
    case 'Stop':
    case 'TaskCompleted':
    case 'SessionEnd':
      // Issue #2538: CC finished work — transition to idle immediately
      // so the API returns the correct status instead of staying "working".
      session.status = 'idle';
      break;
    case 'TeammateIdle':
      // Informational — a teammate went idle, not this session
      break;
    case 'PreToolUse':
      // Issue #2520: Track tool use count for premature termination detection
      session.toolUseCount = (session.toolUseCount ?? 0) + 1;
      session.status = 'working';
      break;
    case 'PostToolUse':
    case 'SubagentStart':
    case 'UserPromptSubmit':
      session.status = 'working';
      break;
    case 'PermissionRequest':
      session.status = 'permission_prompt';
      break;
    case 'StopFailure':
    case 'PostToolUseFailure':
      session.status = 'error';
      break;
    case 'Notification':
    case 'PreCompact':
    case 'PostCompact':
    case 'SubagentStop':
      // Informational events — no status change
      break;
    default:
      // Unknown hook events: no status change
      break;
  }

  // Issue #2520: Detect premature termination. Upstream CC kills background
  // agents at ~20-30 tool uses with no wrap-up (upstream #55707).
  if ((hookEvent === 'TaskCompleted' || hookEvent === 'Stop') && session.toolUseCount !== undefined) {
    const toolCount = session.toolUseCount;
    const duration = now - session.createdAt;
    if (toolCount > 0 && toolCount <= PREMATURE_MIN_TOOLS && duration >= PREMATURE_MIN_DURATION_MS) {
      session.prematureTermination = true;
      log.warn({
        component: 'session',
        operation: 'possiblePrematureTermination',
        sessionId: session.id,
        attributes: { toolCount, durationMs: duration, thresholdTools: PREMATURE_MIN_TOOLS, thresholdMs: PREMATURE_MIN_DURATION_MS },
      });
    }
  }

  session.lastHookAt = now;
  session.lastActivity = now;

  // Issue #87: Record hook receive timestamp for latency calculation
  session.lastHookReceivedAt = now;
  if (hookTimestamp) {
    // Issue #828: Clamp future timestamps to prevent clock skew corruption.
    if (hookTimestamp > now) {
      log.warn({ component: 'session', operation: 'clampedFutureTimestamp', sessionId: session.id, attributes: { hookTimestamp, now } });
      session.lastHookEventAt = now;
    } else {
      session.lastHookEventAt = hookTimestamp;
    }
  }

  // Issue #87: Track permission prompt timestamp
  if (hookEvent === 'PermissionRequest') {
    session.permissionPromptAt = now;
  }

  return prevStatus;
}
