import { describe, expect, it } from 'vitest';

import {
  isKnownStopReason,
  KNOWN_STOP_REASONS,
  mapStopReasonToStatus,
} from '../services/acp/stop-reason-mapper.js';

describe('mapStopReasonToStatus', () => {
  it('maps end_turn to idle', () => {
    expect(mapStopReasonToStatus('end_turn')).toBe('idle');
  });

  it('maps max_tokens to idle', () => {
    expect(mapStopReasonToStatus('max_tokens')).toBe('idle');
  });

  it('maps max_turn_requests to idle', () => {
    expect(mapStopReasonToStatus('max_turn_requests')).toBe('idle');
  });

  it('maps refusal to failed', () => {
    expect(mapStopReasonToStatus('refusal')).toBe('failed');
  });

  it('maps cancelled to closed', () => {
    expect(mapStopReasonToStatus('cancelled')).toBe('closed');
  });

  it('defaults unknown values to idle', () => {
    expect(mapStopReasonToStatus('unknown_reason')).toBe('idle');
    expect(mapStopReasonToStatus('')).toBe('idle');
    expect(mapStopReasonToStatus('tool_use')).toBe('idle');
  });

  it('covers all 5 known stopReason values', () => {
    // Golden test: every known stopReason produces a valid AcpSessionStatus
    const validStatuses = [
      'initializing', 'idle', 'running', 'paused',
      'intervening', 'closing', 'closed', 'failed',
    ] as const;

    for (const reason of KNOWN_STOP_REASONS) {
      const status = mapStopReasonToStatus(reason);
      expect(validStatuses).toContain(status);
    }
  });

  it('maps exactly 3 reasons to idle', () => {
    const idleReasons = KNOWN_STOP_REASONS.filter(
      (r) => mapStopReasonToStatus(r) === 'idle'
    );
    expect(idleReasons).toHaveLength(3);
    expect(idleReasons).toEqual([
      'end_turn',
      'max_tokens',
      'max_turn_requests',
    ]);
  });
});

describe('KNOWN_STOP_REASONS', () => {
  it('contains exactly 5 values', () => {
    expect(KNOWN_STOP_REASONS).toHaveLength(5);
  });

  it('contains all required protocol values', () => {
    const expected = ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'];
    expect(KNOWN_STOP_REASONS).toEqual(expect.arrayContaining(expected));
  });
});

describe('isKnownStopReason', () => {
  it('returns true for all known reasons', () => {
    for (const reason of KNOWN_STOP_REASONS) {
      expect(isKnownStopReason(reason)).toBe(true);
    }
  });

  it('returns false for unknown reasons', () => {
    expect(isKnownStopReason('unknown')).toBe(false);
    expect(isKnownStopReason('')).toBe(false);
    expect(isKnownStopReason('end_turn_extra')).toBe(false);
  });
});
