import { describe, expect, it } from 'vitest';

import {
  AcpInvalidStateTransitionError,
  transitionAcpSessionStatus,
} from '../services/acp/state-machine.js';

import type { AcpSessionStatus, AcpSessionTransitionEvent } from '../services/acp/types.js';

// ---------------------------------------------------------------------------
// Happy path: every valid state × event combination that should succeed
// ---------------------------------------------------------------------------

describe('transitionAcpSessionStatus — valid transitions', () => {
  // agent_ready
  it('initializing → idle on agent_ready', () => {
    expect(transitionAcpSessionStatus('initializing', { type: 'agent_ready' })).toBe('idle');
  });

  // run_started — allowed from initializing, idle, intervening
  it('initializing → running on run_started', () => {
    expect(transitionAcpSessionStatus('initializing', { type: 'run_started' })).toBe('running');
  });

  it('idle → running on run_started', () => {
    expect(transitionAcpSessionStatus('idle', { type: 'run_started' })).toBe('running');
  });

  it('intervening → running on run_started', () => {
    expect(transitionAcpSessionStatus('intervening', { type: 'run_started' })).toBe('running');
  });

  // run_completed — allowed from running, intervening
  it('running → idle on run_completed', () => {
    expect(transitionAcpSessionStatus('running', { type: 'run_completed' })).toBe('idle');
  });

  it('intervening → idle on run_completed', () => {
    expect(transitionAcpSessionStatus('intervening', { type: 'run_completed' })).toBe('idle');
  });

  // pause_requested — allowed from running only
  it('running → paused on pause_requested', () => {
    expect(transitionAcpSessionStatus('running', { type: 'pause_requested' })).toBe('paused');
  });

  // resume_requested — allowed from paused, intervening
  it('paused → running on resume_requested', () => {
    expect(transitionAcpSessionStatus('paused', { type: 'resume_requested' })).toBe('running');
  });

  it('intervening → running on resume_requested', () => {
    expect(transitionAcpSessionStatus('intervening', { type: 'resume_requested' })).toBe('running');
  });

  // intervention_started — allowed from paused only
  it('paused → intervening on intervention_started', () => {
    expect(transitionAcpSessionStatus('paused', { type: 'intervention_started' })).toBe('intervening');
  });

  // intervention_completed — allowed from intervening only
  it('intervening → paused on intervention_completed', () => {
    expect(transitionAcpSessionStatus('intervening', { type: 'intervention_completed' })).toBe('paused');
  });

  // close_requested — allowed from all active statuses (initializing, idle, running, paused, intervening)
  it('initializing → closing on close_requested', () => {
    expect(transitionAcpSessionStatus('initializing', { type: 'close_requested' })).toBe('closing');
  });

  it('idle → closing on close_requested', () => {
    expect(transitionAcpSessionStatus('idle', { type: 'close_requested' })).toBe('closing');
  });

  it('running → closing on close_requested', () => {
    expect(transitionAcpSessionStatus('running', { type: 'close_requested' })).toBe('closing');
  });

  it('paused → closing on close_requested', () => {
    expect(transitionAcpSessionStatus('paused', { type: 'close_requested' })).toBe('closing');
  });

  it('intervening → closing on close_requested', () => {
    expect(transitionAcpSessionStatus('intervening', { type: 'close_requested' })).toBe('closing');
  });

  // close_completed — allowed from closing only
  it('closing → closed on close_completed', () => {
    expect(transitionAcpSessionStatus('closing', { type: 'close_completed' })).toBe('closed');
  });

  // runtime_failed — allowed from all active + closing
  it('initializing → failed on runtime_failed', () => {
    expect(transitionAcpSessionStatus('initializing', { type: 'runtime_failed' })).toBe('failed');
  });

  it('idle → failed on runtime_failed', () => {
    expect(transitionAcpSessionStatus('idle', { type: 'runtime_failed' })).toBe('failed');
  });

  it('running → failed on runtime_failed', () => {
    expect(transitionAcpSessionStatus('running', { type: 'runtime_failed' })).toBe('failed');
  });

  it('paused → failed on runtime_failed', () => {
    expect(transitionAcpSessionStatus('paused', { type: 'runtime_failed' })).toBe('failed');
  });

  it('intervening → failed on runtime_failed', () => {
    expect(transitionAcpSessionStatus('intervening', { type: 'runtime_failed' })).toBe('failed');
  });

  it('closing → failed on runtime_failed', () => {
    expect(transitionAcpSessionStatus('closing', { type: 'runtime_failed' })).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Sad path: invalid transitions must throw AcpInvalidStateTransitionError
// ---------------------------------------------------------------------------

describe('transitionAcpSessionStatus — invalid transitions', () => {
  const terminalStatuses: AcpSessionStatus[] = ['closed', 'failed'];

  for (const status of terminalStatuses) {
    describe(`from terminal state "${status}"`, () => {
      const allEvents: AcpSessionTransitionEvent['type'][] = [
        'agent_ready', 'run_started', 'run_completed',
        'pause_requested', 'resume_requested',
        'intervention_started', 'intervention_completed',
        'close_requested', 'close_completed', 'runtime_failed',
      ];

      for (const eventType of allEvents) {
        it(`throws on ${eventType}`, () => {
          expect(() =>
            transitionAcpSessionStatus(status, { type: eventType })
          ).toThrow(AcpInvalidStateTransitionError);
        });
      }
    });
  }

  // agent_ready only from initializing
  it('throws on agent_ready from idle', () => {
    expect(() => transitionAcpSessionStatus('idle', { type: 'agent_ready' })).toThrow(AcpInvalidStateTransitionError);
  });

  it('throws on agent_ready from running', () => {
    expect(() => transitionAcpSessionStatus('running', { type: 'agent_ready' })).toThrow(AcpInvalidStateTransitionError);
  });

  // pause_requested only from running
  it('throws on pause_requested from idle', () => {
    expect(() => transitionAcpSessionStatus('idle', { type: 'pause_requested' })).toThrow(AcpInvalidStateTransitionError);
  });

  it('throws on pause_requested from paused', () => {
    expect(() => transitionAcpSessionStatus('paused', { type: 'pause_requested' })).toThrow(AcpInvalidStateTransitionError);
  });

  // intervention_started only from paused
  it('throws on intervention_started from idle', () => {
    expect(() => transitionAcpSessionStatus('idle', { type: 'intervention_started' })).toThrow(AcpInvalidStateTransitionError);
  });

  it('throws on intervention_started from running', () => {
    expect(() => transitionAcpSessionStatus('running', { type: 'intervention_started' })).toThrow(AcpInvalidStateTransitionError);
  });

  // intervention_completed only from intervening
  it('throws on intervention_completed from paused', () => {
    expect(() => transitionAcpSessionStatus('paused', { type: 'intervention_completed' })).toThrow(AcpInvalidStateTransitionError);
  });

  // close_completed only from closing
  it('throws on close_completed from running', () => {
    expect(() => transitionAcpSessionStatus('running', { type: 'close_completed' })).toThrow(AcpInvalidStateTransitionError);
  });

  it('throws on close_completed from idle', () => {
    expect(() => transitionAcpSessionStatus('idle', { type: 'close_completed' })).toThrow(AcpInvalidStateTransitionError);
  });

  // run_completed only from running, intervening
  it('throws on run_completed from idle', () => {
    expect(() => transitionAcpSessionStatus('idle', { type: 'run_completed' })).toThrow(AcpInvalidStateTransitionError);
  });

  it('throws on run_completed from paused', () => {
    expect(() => transitionAcpSessionStatus('paused', { type: 'run_completed' })).toThrow(AcpInvalidStateTransitionError);
  });

  // resume_requested only from paused, intervening
  it('throws on resume_requested from idle', () => {
    expect(() => transitionAcpSessionStatus('idle', { type: 'resume_requested' })).toThrow(AcpInvalidStateTransitionError);
  });

  it('throws on resume_requested from running', () => {
    expect(() => transitionAcpSessionStatus('running', { type: 'resume_requested' })).toThrow(AcpInvalidStateTransitionError);
  });
});

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

describe('AcpInvalidStateTransitionError', () => {
  it('has correct name', () => {
    const err = new AcpInvalidStateTransitionError('idle', 'agent_ready');
    expect(err.name).toBe('AcpInvalidStateTransitionError');
  });

  it('exposes currentStatus and eventType', () => {
    const err = new AcpInvalidStateTransitionError('paused', 'run_started');
    expect(err.currentStatus).toBe('paused');
    expect(err.eventType).toBe('run_started');
  });

  it('message includes both fields', () => {
    const err = new AcpInvalidStateTransitionError('closed', 'run_started');
    expect(err.message).toContain('closed');
    expect(err.message).toContain('run_started');
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle integration test
// ---------------------------------------------------------------------------

describe('transitionAcpSessionStatus — full lifecycle', () => {
  it('happy path: init → ready → run → complete → run → pause → intervene → resume → run → close', () => {
    let s: AcpSessionStatus = 'initializing';
    s = transitionAcpSessionStatus(s, { type: 'agent_ready' });
    expect(s).toBe('idle');

    s = transitionAcpSessionStatus(s, { type: 'run_started' });
    expect(s).toBe('running');

    s = transitionAcpSessionStatus(s, { type: 'run_completed' });
    expect(s).toBe('idle');

    s = transitionAcpSessionStatus(s, { type: 'run_started' });
    expect(s).toBe('running');

    s = transitionAcpSessionStatus(s, { type: 'pause_requested' });
    expect(s).toBe('paused');

    s = transitionAcpSessionStatus(s, { type: 'intervention_started' });
    expect(s).toBe('intervening');

    s = transitionAcpSessionStatus(s, { type: 'intervention_completed' });
    expect(s).toBe('paused');

    s = transitionAcpSessionStatus(s, { type: 'resume_requested' });
    expect(s).toBe('running');

    s = transitionAcpSessionStatus(s, { type: 'close_requested' });
    expect(s).toBe('closing');

    s = transitionAcpSessionStatus(s, { type: 'close_completed' });
    expect(s).toBe('closed');
  });

  it('failure path: init → ready → run → runtime_failed', () => {
    let s: AcpSessionStatus = 'initializing';
    s = transitionAcpSessionStatus(s, { type: 'agent_ready' });
    expect(s).toBe('idle');

    s = transitionAcpSessionStatus(s, { type: 'run_started' });
    expect(s).toBe('running');

    s = transitionAcpSessionStatus(s, { type: 'runtime_failed' });
    expect(s).toBe('failed');
  });

  it('failure during close: running → close_requested → runtime_failed', () => {
    let s: AcpSessionStatus = 'running';
    s = transitionAcpSessionStatus(s, { type: 'close_requested' });
    expect(s).toBe('closing');

    s = transitionAcpSessionStatus(s, { type: 'runtime_failed' });
    expect(s).toBe('failed');
  });

  it('intervention → run_started bypasses resume', () => {
    let s: AcpSessionStatus = 'paused';
    s = transitionAcpSessionStatus(s, { type: 'intervention_started' });
    expect(s).toBe('intervening');

    // run_started is valid from intervening
    s = transitionAcpSessionStatus(s, { type: 'run_started' });
    expect(s).toBe('running');
  });
});
