/**
 * SessionPermissionService — Extracted from SessionManager (#4251 step 3).
 *
 * Handles permission prompt resolution, approval option picking,
 * and session-level approval/rejection flows.
 */

import { PermissionRequestManager, type PermissionDecision } from '../../permission-request-manager.js';
import type { SessionInfo } from '../../session.js';

export type { PermissionDecision };

// ── Numbered approval option parsing ──

/** Normalize an approval label for fuzzy matching. */
function normalizeApprovalLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pick the best numbered approval option for approve/reject action. */
export function pickNumberedApprovalOption(
  options: NumberedApprovalOption[],
  action: 'approve' | 'reject',
  permissionMode: string,
): string {
  const normalized = options.map(option => ({
    ...option,
    normalizedLabel: normalizeApprovalLabel(option.label),
  }));

  if (action === 'approve') {
    if (permissionMode === 'plan') {
      const manualApproval = normalized.find(option => option.normalizedLabel.includes('manuallyapproveedits'));
      if (manualApproval) return manualApproval.value;
    }

    const leastPrivilegeYes = normalized.find(option =>
      (option.normalizedLabel.startsWith('yes') || option.normalizedLabel.startsWith('allow'))
      && !option.normalizedLabel.includes('always')
      && !option.normalizedLabel.includes('automode')
    );
    if (leastPrivilegeYes) return leastPrivilegeYes.value;

    const anyPositive = normalized.find(option =>
      option.normalizedLabel.includes('yes')
      || option.normalizedLabel.includes('allow')
      || option.normalizedLabel.includes('proceed')
    );
    if (anyPositive) return anyPositive.value;

    return options[0]?.value ?? '1';
  }

  const negative = normalized.find(option =>
    option.normalizedLabel.startsWith('no')
    || option.normalizedLabel.includes('deny')
    || option.normalizedLabel.includes('reject')
    || option.normalizedLabel.includes('cancel')
  );
  if (negative) return negative.value;

  return options[options.length - 1]?.value ?? 'n';
}

// ── Types ──

/** Numbered approval option parsed from CC's permission prompt. */
export interface NumberedApprovalOption {
  value: string;
  label: string;
}

/**
 * Detect whether CC is showing numbered permission options (e.g. "1. Yes, 2. No")
 *
 * CC's permission UI uses indented numbered lines with "Esc to cancel" nearby.
 * This function extracts those options from raw pane text, carefully distinguishing
 * permission options from regular numbered lists in output.
 */
export function parseNumberedApprovalOptions(paneText: string): NumberedApprovalOption[] {
  const numberedRegex = /^\s*[❯> ]?\s*(\d+)\.\s*(.+)$/gm;
  const options: NumberedApprovalOption[] = [];
  let match: RegExpExecArray | null;

  while ((match = numberedRegex.exec(paneText)) !== null) {
    options.push({
      value: match[1]!,
      label: match[2]!.trim(),
    });
  }

  return options;
}

/**
 * Resolve the approval input for a permission prompt.
 * Picks the appropriate numbered option if available, otherwise returns 'y'/'n'.
 */
export function resolveApprovalInput(
  paneText: string,
  action: 'approve' | 'reject',
  permissionMode: string,
): string {
  const options = parseNumberedApprovalOptions(paneText);
  if (options.length >= 2) {
    return pickNumberedApprovalOption(options, action, permissionMode);
  }
  return action === 'approve' ? 'y' : 'n';
}

// ── Permission prompt management ──

/**
 * Manages pending permission requests and approval/rejection flows
 * for Claude Code sessions. Delegates storage to PermissionRequestManager.
 */
export class SessionPermissionService {
  private readonly requestManager = new PermissionRequestManager();

  /** Resolve a pending permission request. Returns true if resolved. */
  resolvePermission(sessionId: string, decision: PermissionDecision): boolean {
    return this.requestManager.resolvePendingPermission(sessionId, decision) !== null;
  }

  /** Approve a pending permission prompt. Throws if none pending. */
  approvePermission(sessionId: string): void {
    const resolved = this.requestManager.resolvePendingPermission(sessionId, 'allow');
    if (!resolved) {
      throw new Error('No pending permission request');
    }
  }

  /** Reject a pending permission prompt. Throws if none pending. */
  rejectPermission(sessionId: string): void {
    const resolved = this.requestManager.resolvePendingPermission(sessionId, 'deny');
    if (!resolved) {
      throw new Error('No pending permission request');
    }
  }

  /** Get the underlying request manager for direct access. */
  get requests(): PermissionRequestManager {
    return this.requestManager;
  }
}

export default SessionPermissionService;
