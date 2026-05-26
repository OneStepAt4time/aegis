/**
 * session-ui-parser.ts — Pure functions for parsing Claude Code terminal UI state.
 *
 * Extracted from session.ts (#4228): UI state detection, approval method
 * detection, and blank prompt detection. All functions are pure with
 * no side effects, making them easy to test independently.
 */

import type { UIState } from './session-types.js';

/** Detect UI state from terminal pane text (ACP mode — currently stubbed). */
export function detectUIState(_paneText: string): UIState {
  return 'idle';
}

/** Check if the pane has a blank prompt (❯) near the bottom. */
export function hasBlankPromptNearBottom(paneText: string): boolean {
  if (!paneText) return false;
  const lines = paneText.trimEnd().split('\n');
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) {
    const stripped = lines[i]?.trim() ?? '';
    if (stripped === '❯' || stripped === '❯\u00a0') {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether CC is showing numbered permission options (e.g. "1. Yes, 2. No")
 * vs a simple y/N prompt. Returns the approval method to use.
 *
 * CC's permission UI uses indented numbered lines with "Esc to cancel" nearby.
 * We look for the pattern "  <N>. <option>" where N is 1-3, which distinguishes
 * permission options from regular numbered lists in output.
 */
export function detectApprovalMethod(paneText: string): 'numbered' | 'yes' {
  // Match CC's permission option format: indented "  1. Yes" lines.
  // Issue #843: Tightened to require "Esc to cancel" nearby (within 300 chars)
  // to avoid false positives on regular indented numbered lists in output.
  const numberedOptionPattern = /^\s{2}[1-3]\.\s/m;
  if (numberedOptionPattern.test(paneText) && /Esc to cancel/i.test(paneText)) {
    return 'numbered';
  }
  return 'yes';
}

/**
 * Resolve UI approval input for a given pane text and action.
 * Delegates to SessionPermissionService.resolveApprovalInput for numbered option parsing.
 */
export function getUiApprovalInput(
  paneText: string,
  action: 'approve' | 'reject',
  permissionMode: string,
  resolveApprovalInput: (paneText: string, action: 'approve' | 'reject', permissionMode: string) => string,
): string | null {
  const state = detectUIState(paneText);
  if (state !== 'permission_prompt' && state !== 'plan_mode' && state !== 'bash_approval') {
    return null;
  }
  return resolveApprovalInput(paneText, action, permissionMode);
}
