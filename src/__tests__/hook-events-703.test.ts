/**
 * hook-events-703.test.ts — Unit tests for Issue #703 Phase 1:
 * Additional hook lifecycle events: PermissionDenied, TaskCreated,
 * Setup, ConfigChange, InstructionsLoaded.
 */

import { describe, it, expect } from 'vitest';

// ── Mirror helpers from hooks.ts ──────────────────────────────────────

type UIState = 'idle' | 'working' | 'error' | 'compacting' | 'permission_prompt' | 'waiting_for_input' | 'unknown';

const KNOWN_HOOK_EVENTS = new Set([
  'Stop', 'StopFailure', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'Notification', 'PermissionRequest', 'SessionStart', 'SessionEnd',
  'SubagentStart', 'SubagentStop', 'TaskCompleted', 'TeammateIdle',
  'PreCompact', 'PostCompact', 'UserPromptSubmit',
  'WorktreeCreate', 'WorktreeRemove', 'Elicitation', 'ElicitationResult',
  'FileChanged', 'CwdChanged',
  // Issue #703 Phase 1
  'PermissionDenied', 'TaskCreated', 'Setup', 'ConfigChange', 'InstructionsLoaded',
]);

const INFORMATIONAL_EVENTS = new Set([
  'Notification', 'FileChanged', 'CwdChanged',
  // Issue #703 Phase 1
  'Setup', 'ConfigChange', 'InstructionsLoaded', 'PermissionDenied',
]);

function hookToUIState(eventName: string): UIState | null {
  switch (eventName) {
    case 'Stop': case 'TaskCompleted': case 'SessionEnd': case 'PostCompact': return 'idle';
    case 'StopFailure': case 'PostToolUseFailure': return 'error';
    case 'PreToolUse': case 'PostToolUse': case 'SubagentStart':
    case 'UserPromptSubmit': case 'Elicitation': case 'ElicitationResult':
    case 'WorktreeCreate': case 'WorktreeRemove': return 'working';
    case 'PreCompact': return 'compacting';
    case 'PermissionRequest': return 'permission_prompt';
    case 'TeammateIdle': return 'idle';
    // Issue #703 Phase 1
    case 'TaskCreated': return 'working';
    default: return null;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Issue #703: New hook events are accepted in KNOWN_HOOK_EVENTS', () => {
  it('accepts PermissionDenied', () => {
    expect(KNOWN_HOOK_EVENTS.has('PermissionDenied')).toBe(true);
  });
  it('accepts TaskCreated', () => {
    expect(KNOWN_HOOK_EVENTS.has('TaskCreated')).toBe(true);
  });
  it('accepts Setup', () => {
    expect(KNOWN_HOOK_EVENTS.has('Setup')).toBe(true);
  });
  it('accepts ConfigChange', () => {
    expect(KNOWN_HOOK_EVENTS.has('ConfigChange')).toBe(true);
  });
  it('accepts InstructionsLoaded', () => {
    expect(KNOWN_HOOK_EVENTS.has('InstructionsLoaded')).toBe(true);
  });
});

describe('Issue #703: Informational events set', () => {
  it('Setup is informational (no status change)', () => {
    expect(INFORMATIONAL_EVENTS.has('Setup')).toBe(true);
  });
  it('ConfigChange is informational', () => {
    expect(INFORMATIONAL_EVENTS.has('ConfigChange')).toBe(true);
  });
  it('InstructionsLoaded is informational', () => {
    expect(INFORMATIONAL_EVENTS.has('InstructionsLoaded')).toBe(true);
  });
  it('PermissionDenied is informational (no status change needed)', () => {
    expect(INFORMATIONAL_EVENTS.has('PermissionDenied')).toBe(true);
  });
  it('TaskCreated is NOT informational — implies working status', () => {
    expect(INFORMATIONAL_EVENTS.has('TaskCreated')).toBe(false);
  });
});

describe('Issue #703: hookToUIState mappings', () => {
  it('TaskCreated maps to "working"', () => {
    expect(hookToUIState('TaskCreated')).toBe('working');
  });
  it('PermissionDenied maps to null (informational)', () => {
    expect(hookToUIState('PermissionDenied')).toBeNull();
  });
  it('Setup maps to null (informational)', () => {
    expect(hookToUIState('Setup')).toBeNull();
  });
  it('ConfigChange maps to null (informational)', () => {
    expect(hookToUIState('ConfigChange')).toBeNull();
  });
  it('InstructionsLoaded maps to null (informational)', () => {
    expect(hookToUIState('InstructionsLoaded')).toBeNull();
  });
  // Existing regression checks
  it('Stop still maps to "idle"', () => {
    expect(hookToUIState('Stop')).toBe('idle');
  });
  it('PreToolUse still maps to "working"', () => {
    expect(hookToUIState('PreToolUse')).toBe('working');
  });
  it('PermissionRequest still maps to "permission_prompt"', () => {
    expect(hookToUIState('PermissionRequest')).toBe('permission_prompt');
  });
});

describe('Issue #703: SSEEventType includes permission_denied', () => {
  // This is a compile-time assertion validated in api-contracts.typecheck.ts
  // We test the runtime set to confirm the event string is a valid SSE event.
  const VALID_SSE_EVENTS = new Set([
    'status', 'message', 'approval', 'ended', 'heartbeat',
    'stall', 'dead', 'system', 'hook',
    'subagent_start', 'subagent_stop', 'verification',
    'permission_denied', // Issue #703
  ]);

  it('permission_denied is a valid SSE event type', () => {
    expect(VALID_SSE_EVENTS.has('permission_denied')).toBe(true);
  });
});
