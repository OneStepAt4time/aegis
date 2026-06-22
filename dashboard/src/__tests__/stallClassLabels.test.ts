/**
 * __tests__/stallClassLabels.test.ts — Issue #4802: stall label + state helpers.
 *
 * Path 2 defensive: tests cover both typed payload (post-F-9) and missing
 * fields (pre-F-9) scenarios. The renderer must degrade gracefully when the
 * typed payload isn't yet wired to the SSE bus.
 */

import { describe, it, expect } from 'vitest';
import {
  STALL_CLASS_LABELS,
  STALL_GENERIC_LABEL,
  formatStallClassLabel,
  formatStallSubLabel,
  isRecoveryExhausted,
  isRecoveryDisabled,
  formatStallTooltip,
} from '../utils/stallClassLabels';

describe('Issue #4802: stall label utilities', () => {
  describe('formatStallClassLabel', () => {
    it('maps each ErrorClass to a display label', () => {
      for (const [key, expected] of Object.entries(STALL_CLASS_LABELS)) {
        expect(formatStallClassLabel(key as never)).toBe(expected);
      }
    });

    it('returns generic label for missing errorClass (Path 2 default)', () => {
      expect(formatStallClassLabel(undefined)).toBe(STALL_GENERIC_LABEL);
      expect(formatStallClassLabel(null)).toBe(STALL_GENERIC_LABEL);
    });

    it('returns generic label for unknown string', () => {
      // Runtime guard at server side rejects these; renderer is defensive.
      expect(formatStallClassLabel('5xx_529' as never)).toBe(STALL_GENERIC_LABEL);
    });
  });

  describe('isRecoveryExhausted', () => {
    it('returns true when attempt >= max (both > 0)', () => {
      expect(isRecoveryExhausted({ recoveryAttemptCount: 5, recoveryMaxAttempts: 5 })).toBe(true);
      expect(isRecoveryExhausted({ recoveryAttemptCount: 6, recoveryMaxAttempts: 5 })).toBe(true);
    });

    it('returns false when attempt < max', () => {
      expect(isRecoveryExhausted({ recoveryAttemptCount: 3, recoveryMaxAttempts: 5 })).toBe(false);
    });

    it('returns false when attempt < max', () => {
      expect(isRecoveryExhausted({ recoveryAttemptCount: 1, recoveryMaxAttempts: 5 })).toBe(false);
    });

    it('returns false when max is 0 (Path 2 default — unknown)', () => {
      expect(isRecoveryExhausted({ recoveryAttemptCount: 0, recoveryMaxAttempts: 0 })).toBe(false);
      expect(isRecoveryExhausted({})).toBe(false);
    });

    it('returns false when only max is set, attempt is missing', () => {
      expect(isRecoveryExhausted({ recoveryMaxAttempts: 5 })).toBe(false);
    });
  });

  describe('formatStallSubLabel', () => {
    it('returns "X/Y (auto-recovering…)" when not exhausted', () => {
      expect(formatStallSubLabel({ recoveryAttemptCount: 3, recoveryMaxAttempts: 5 })).toBe(
        '3/5 (auto-recovering…)',
      );
    });

    it('returns "X/Y — intervention required" when exhausted', () => {
      expect(formatStallSubLabel({ recoveryAttemptCount: 5, recoveryMaxAttempts: 5 })).toBe(
        '5/5 — intervention required',
      );
    });

    it('returns null when max is 0 (Path 2 default — sub-label hidden)', () => {
      expect(formatStallSubLabel({ recoveryAttemptCount: 0, recoveryMaxAttempts: 0 })).toBeNull();
      expect(formatStallSubLabel({})).toBeNull();
    });
  });

  describe('isRecoveryDisabled', () => {
    it('returns true when recoveryDisabled === true', () => {
      expect(isRecoveryDisabled({ recoveryDisabled: true })).toBe(true);
    });

    it('returns false when recoveryDisabled is false or missing (Path 2 default)', () => {
      expect(isRecoveryDisabled({ recoveryDisabled: false })).toBe(false);
      expect(isRecoveryDisabled({})).toBe(false);
    });
  });

  describe('formatStallTooltip', () => {
    it('composes metadata-only tooltip (no transcript text)', () => {
      const tooltip = formatStallTooltip({
        errorClass: 'transient_5xx',
        statusCode: 529,
        lastErrorAt: '2026-06-22T12:00:00.000Z',
        stallDurationMs: 600000, // 10 minutes
        recoveryAttemptCount: 3,
        recoveryMaxAttempts: 5,
      });
      expect(tooltip).toContain('Transient 5xx');
      expect(tooltip).toContain('529');
      expect(tooltip).toContain('2026-06-22T12:00:00.000Z');
      expect(tooltip).toContain('10m');
      expect(tooltip).toContain('3/5');
      expect(tooltip).not.toContain('detail'); // F-6 redaction discipline
    });

    it('omits statusCode for non-transient_5xx classes', () => {
      const tooltip = formatStallTooltip({
        errorClass: 'jsonl_stall',
        statusCode: 529, // would be invalid in real payload, but defensive
        recoveryAttemptCount: 1,
        recoveryMaxAttempts: 5,
      });
      expect(tooltip).toContain('JSONL Stall');
      expect(tooltip).not.toContain('529');
    });

    it('handles missing fields gracefully (Path 2 default)', () => {
      const tooltip = formatStallTooltip({});
      expect(tooltip).toBe('Stalled'); // just the generic label
    });
  });
});
