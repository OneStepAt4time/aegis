/**
 * __tests__/acp-control.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Mock the acp-pause-client module
const mockPauseSessionApi = vi.fn();
const mockResumeSessionApi = vi.fn();
const mockStartInterventionApi = vi.fn();
const mockCompleteInterventionApi = vi.fn();
const mockGetSessionInterventionApi = vi.fn();

vi.mock('../api/acp-pause-client.js', () => ({
  pauseSession: (...args: unknown[]) => mockPauseSessionApi(...args),
  resumeSession: (...args: unknown[]) => mockResumeSessionApi(...args),
  startIntervention: (...args: unknown[]) => mockStartInterventionApi(...args),
  completeIntervention: (...args: unknown[]) => mockCompleteInterventionApi(...args),
  getSessionIntervention: (...args: unknown[]) => mockGetSessionInterventionApi(...args),
}));

const mockPolicyResult = (sessionId: string) => ({
  session: { id: sessionId, status: 'paused', updatedAt: '2026-05-06T07:00:00.000Z' },
  pause: {
    pauseId: 'pause-1',
    sessionId,
    status: 'paused' as const,
    reason: 'test',
    requestedBy: 'test-user',
    requestedAt: '2026-05-06T07:00:00.000Z',
    updatedAt: '2026-05-06T07:00:00.000Z',
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

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
  it('delegates pause to the real API', async () => {
    mockPauseSessionApi.mockResolvedValue(mockPolicyResult('sess-1'));
    const request: ControlActionRequest = {
      actionId: 'test-1',
      sessionId: 'sess-1',
      type: 'pause',
      reason: 'security review',
    };
    const result = await sendControlAction(request);
    expect(mockPauseSessionApi).toHaveBeenCalledWith('sess-1', {
      reason: 'security review',
      idempotencyKey: 'test-1',
    }, undefined);
    expect(result.actionId).toBe('test-1');
    expect(result.status).toBe('completed');
    expect(result.timestamp).toBe('2026-05-06T07:00:00.000Z');
  });

  it('delegates resume to the real API', async () => {
    mockResumeSessionApi.mockResolvedValue(mockPolicyResult('sess-2'));
    const result = await sendControlAction({
      actionId: 'test-2',
      sessionId: 'sess-2',
      type: 'resume',
    });
    expect(mockResumeSessionApi).toHaveBeenCalledWith('sess-2', {
      resumedBy: 'test-2',
    }, undefined);
    expect(result.status).toBe('completed');
  });

  it('delegates intervene without guidance to startIntervention', async () => {
    mockStartInterventionApi.mockResolvedValue(mockPolicyResult('sess-3'));
    const result = await sendControlAction({
      actionId: 'test-3',
      sessionId: 'sess-3',
      type: 'intervene',
    });
    expect(mockStartInterventionApi).toHaveBeenCalledWith('sess-3', {
      interventionBy: 'test-3',
    }, undefined);
    expect(result.status).toBe('completed');
  });

  it('delegates intervene with guidance to completeIntervention', async () => {
    mockCompleteInterventionApi.mockResolvedValue(mockPolicyResult('sess-4'));
    const result = await sendControlAction({
      actionId: 'test-4',
      sessionId: 'sess-4',
      type: 'intervene',
      guidance: 'follow these steps',
    });
    expect(mockCompleteInterventionApi).toHaveBeenCalledWith('sess-4', {
      completedBy: 'test-4',
      guidance: 'follow these steps',
    }, undefined);
    expect(result.status).toBe('completed');
  });

  it('throws for cancel type', async () => {
    await expect(sendControlAction({
      actionId: 'test-5',
      sessionId: 'sess-5',
      type: 'cancel',
    })).rejects.toThrow('Cancel not yet implemented');
  });

  it('throws for unknown type', async () => {
    await expect(sendControlAction({
      actionId: 'test-6',
      sessionId: 'sess-6',
      type: 'prompt' as ControlActionRequest['type'],
    })).rejects.toThrow('Unknown control action type');
  });
});

describe('pauseSession', () => {
  it('sends pause action with reason via delegation', async () => {
    mockPauseSessionApi.mockResolvedValue(mockPolicyResult('sess-1'));
    const result = await pauseSession('sess-1', 'security review');
    expect(mockPauseSessionApi).toHaveBeenCalled();
    expect(result.type).toBe('pause');
    expect(result.sessionId).toBe('sess-1');
    expect(result.actionId).toMatch(/^ctrl-/);
  });
});

describe('resumeSession', () => {
  it('sends resume action via delegation', async () => {
    mockResumeSessionApi.mockResolvedValue(mockPolicyResult('sess-1'));
    const result = await resumeSession('sess-1');
    expect(mockResumeSessionApi).toHaveBeenCalled();
    expect(result.type).toBe('resume');
  });
});

describe('startIntervention', () => {
  it('sends intervene action via delegation', async () => {
    mockStartInterventionApi.mockResolvedValue(mockPolicyResult('sess-1'));
    const result = await startIntervention('sess-1');
    expect(mockStartInterventionApi).toHaveBeenCalled();
    expect(result.type).toBe('intervene');
  });
});

describe('completeIntervention', () => {
  it('sends intervene action with guidance via delegation', async () => {
    mockCompleteInterventionApi.mockResolvedValue(mockPolicyResult('sess-1'));
    const result = await completeIntervention('sess-1', 'follow these steps');
    expect(mockCompleteInterventionApi).toHaveBeenCalled();
    expect(result.type).toBe('intervene');
  });

  it('works without guidance via delegation', async () => {
    mockStartInterventionApi.mockResolvedValue(mockPolicyResult('sess-1'));
    const result = await completeIntervention('sess-1');
    expect(result.type).toBe('intervene');
    expect(result.status).toBe('completed');
  });
});

describe('cancelSession', () => {
  it('throws because cancel is not yet implemented', async () => {
    await expect(cancelSession('sess-1')).rejects.toThrow('Cancel not yet implemented');
  });
});

describe('getIntervention', () => {
  it('returns mapped record from real API', async () => {
    mockGetSessionInterventionApi.mockResolvedValue({
      pauseId: 'pause-1',
      sessionId: 'sess-1',
      status: 'paused',
      reason: 'test reason',
      requestedBy: 'test-user',
      requestedAt: '2026-05-06T07:00:00.000Z',
      updatedAt: '2026-05-06T07:00:00.000Z',
    });
    const result = await getIntervention('sess-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('pause-1');
    expect(result!.sessionId).toBe('sess-1');
    expect(result!.reason).toBe('test reason');
    expect(result!.actor).toBe('test-user');
    expect(result!.status).toBe('active');
  });

  it('returns null when no intervention exists', async () => {
    mockGetSessionInterventionApi.mockResolvedValue(null);
    const result = await getIntervention('sess-1');
    expect(result).toBeNull();
  });

  it('maps resumed status to completed', async () => {
    mockGetSessionInterventionApi.mockResolvedValue({
      pauseId: 'pause-2',
      sessionId: 'sess-2',
      status: 'resumed',
      reason: 'test',
      requestedBy: 'user',
      requestedAt: '2026-05-06T07:00:00.000Z',
      interventionCompletedAt: '2026-05-06T07:05:00.000Z',
      updatedAt: '2026-05-06T07:05:00.000Z',
    });
    const result = await getIntervention('sess-2');
    expect(result!.status).toBe('completed');
    expect(result!.completedAt).toBe('2026-05-06T07:05:00.000Z');
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
