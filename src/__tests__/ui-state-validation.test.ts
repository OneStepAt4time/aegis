/**
 * Test for Issue #619: Verify all UIState values pass Zod validation.
 * The missing states (compacting, context_warning, waiting_for_input, error)
 * caused sessions to be dropped on validation.
 */
import { describe, it, expect } from 'vitest';
import { persistedStateSchema } from '../validation.js';

function makeValidSession(status: string) {
  return {
    id: 'test-id',
    windowId: '@1',
    windowName: 'test',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionMode: 'default',
  };
}

describe('UIStateEnum — all states pass validation (#619)', () => {
  const allStates = [
    'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'bash_approval', 'plan_mode', 'ask_question',
    'settings', 'error', 'unknown',
  ];

  it.each(allStates)('accepts status "%s"', (status) => {
    const result = persistedStateSchema.safeParse({ 'test-id': makeValidSession(status) });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid status', () => {
    const result = persistedStateSchema.safeParse({ 'test-id': makeValidSession('invalid_state') });
    expect(result.success).toBe(false);
  });
});
