/**
 * session-ui-parser.ts — Pure functions for parsing Claude Code terminal UI state.
 *
 * Extracted from session.ts (#4228): UI state detection, approval method
 * detection, and numbered option parsing. All functions are pure with
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

interface NumberedApprovalOption {
  value: string;
  label: string;
}

export function parseNumberedApprovalOptions(paneText: string): NumberedApprovalOption[] {
  const numberedRegex = /^\s*[❯> ]?\s*(\d+)\.\s*(.+)$/gm;
  const options: NumberedApprovalOption[] = [];
  let match: RegExpExecArray | null;

  while ((match = numberedRegex.exec(paneText)) !== null) {
    options.push({
      value: match[1],
      label: match[2].trim(),
    });
  }

  return options;
}

function normalizeApprovalLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function pickNumberedApprovalOption(
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

export function getUiApprovalInput(
  paneText: string,
  action: 'approve' | 'reject',
  permissionMode: string,
): string | null {
  const state = detectUIState(paneText);
  if (state !== 'permission_prompt' && state !== 'plan_mode' && state !== 'bash_approval') {
    return null;
  }
  return resolveApprovalInput(paneText, action, permissionMode);
}
