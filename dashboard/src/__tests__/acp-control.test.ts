/**
 * __tests__/acp-control.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  sendControlAction,
  pauseSession,
  resumeSession,
  startIntervention,
  completeIntervention,
  cancelSession,
  getIntervention,
  generateActionId,
} from '../api/acp-control-client';
import type { ControlActionRequest } from '../api/acp-control-client';
import { deriveControlAvailability } from '../types/acp-control';

describe('generateActionId', () => {
  it('returns a string starting with ctrl-', () => {
    const id = generateActionId();
    expect(id).toMatch(/^ctrl-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateActionId()));
    expect(ids.size).toBe(100);
  });
});

describe('sendControlAction', () => {
  it('returns completed mock response', async () => {
    const request: ControlActionRequest = {
      actionId: 'test-1',
      sessionId: 'sess-1',
      type: 'pause',
      reason: 'test',
    };
    const result = await sendControlAction(request);
    expect(result.actionId).toBe('test-1');
    expect(result.sessionId).toBe('sess-1');
    expect(result.type).toBe('pause');
    expect(result.status).toBe('completed');
    expect(result.timestamp).toBeDefined();
  });
});

describe('pauseSession', () => {
  it('sends pause action with reason', async () => {
    const result = await pauseSession('sess-1', 'security review');
    expect(result.type).toBe('pause');
    expect(result.sessionId).toBe('sess-1');
    expect(result.actionId).toMatch(/^ctrl-/);
  });
});

describe('resumeSession', () => {
  it('sends resume action', async () => {
    const result = await resumeSession('sess-1');
    expect(result.type).toBe('resume');
  });
});

describe('startIntervention', () => {
  it('sends intervene action', async () => {
    const result = await startIntervention('sess-1');
    expect(result.type).toBe('intervene');
  });
});

describe('completeIntervention', () => {
  it('sends intervene action with guidance', async () => {
    const result = await completeIntervention('sess-1', 'follow these steps');
    expect(result.type).toBe('intervene');
  });

  it('works without guidance', async () => {
    const result = await completeIntervention('sess-1');
    expect(result.type).toBe('intervene');
    expect(result.status).toBe('completed');
  });
});

describe('cancelSession', () => {
  it('sends cancel action', async () => {
    const result = await cancelSession('sess-1');
    expect(result.type).toBe('cancel');
  });
});

describe('getIntervention', () => {
  it('returns null in mock mode', async () => {
    const result = await getIntervention('sess-1');
    expect(result).toBeNull();
  });
});

describe('deriveControlAvailability', () => {
  it('allows pause when running as driver', () => {
    const avail = deriveControlAvailability('running', true);
    expect(avail.canPause).toBe(true);
    expect(avail.canResume).toBe(false);
    expect(avail.canCancel).toBe(true);
  });

  it('does not allow pause when running as observer', () => {
    const avail = deriveControlAvailability('running', false);
    expect(avail.canPause).toBe(false);
    expect(avail.canCancel).toBe(false);
  });

  it('allows approve/reject when awaiting_approval as driver', () => {
    const avail = deriveControlAvailability('awaiting_approval', true);
    expect(avail.canApprove).toBe(true);
    expect(avail.canReject).toBe(true);
  });

  it('allows resume and intervene when paused as driver', () => {
    const avail = deriveControlAvailability('paused', true);
    expect(avail.canResume).toBe(true);
    expect(avail.canIntervene).toBe(true);
    expect(avail.canPause).toBe(false);
  });

  it('allows resume but not intervene when intervening', () => {
    const avail = deriveControlAvailability('intervening', true);
    expect(avail.canResume).toBe(true);
    expect(avail.canIntervene).toBe(false);
  });

  it('disables all actions for completed state', () => {
    const avail = deriveControlAvailability('completed', true);
    expect(avail.canPause).toBe(false);
    expect(avail.canResume).toBe(false);
    expect(avail.canCancel).toBe(false);
    expect(avail.canApprove).toBe(false);
  });

  it('disables all actions for failed state', () => {
    const avail = deriveControlAvailability('failed', true);
    expect(avail.canPause).toBe(false);
    expect(avail.canResume).toBe(false);
  });
});
