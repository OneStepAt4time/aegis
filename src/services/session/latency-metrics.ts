/**
 * latency-metrics.ts — Session latency metrics computation.
 *
 * Pure function that computes hook latency, state-change detection latency,
 * and permission response latency from a SessionInfo object.
 */

import type { SessionInfo } from '../../session-types.js';

export interface LatencyMetrics {
  hook_latency_ms: number | null;
  state_change_detection_ms: number | null;
  permission_response_ms: number | null;
}

/**
 * Compute latency metrics for a session.
 *
 * - `hook_latency_ms`: time from CC sending hook to Aegis receiving it.
 * - `state_change_detection_ms`: approximated as hook_latency (hook IS the signal).
 * - `permission_response_ms`: time from permission prompt to user action.
 */
export function computeLatencyMetrics(session: SessionInfo): LatencyMetrics {
  // hook_latency_ms: time from CC sending hook to Aegis receiving it
  let hookLatency: number | null = null;
  if (session.lastHookReceivedAt && session.lastHookEventAt) {
    hookLatency = session.lastHookReceivedAt - session.lastHookEventAt;
    // Guard against negative values (clock skew)
    if (hookLatency < 0) hookLatency = null;
  }

  // state_change_detection_ms: approximated as hook_latency_ms
  const stateChangeDetection: number | null = hookLatency;

  // permission_response_ms: time from permission prompt to user action
  let permissionResponse: number | null = null;
  if (session.permissionPromptAt && session.permissionRespondedAt) {
    permissionResponse = session.permissionRespondedAt - session.permissionPromptAt;
  }

  return {
    hook_latency_ms: hookLatency,
    state_change_detection_ms: stateChangeDetection,
    permission_response_ms: permissionResponse,
  };
}
