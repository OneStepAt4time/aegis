/**
 * stall-events-typed-4802.test.ts — Issue #4802 Cycle-1.6: bounded errorClass
 * enum + typed StallEventPayload contract.
 *
 * Without bounded enum + typed metadata, the renderer would render labels from
 * concatenated strings (e.g. '5xx_529'), which:
 *   - grows silently without schema review (530, 599, 401, ...)
 *   - is a prompt-injection surface (free-form text → label)
 *   - defeats auditability of the dashboard surface
 *
 * Daedalus Cycle-1.7 locked the renderer to render from `errorClass` enum only.
 * This test pins the contract that the server emits.
 */

import { describe, it, expect } from 'vitest';
import {
  ERROR_CLASS_VALUES,
  buildStallEventPayload,
  isErrorClass,
  toChannelFanoutPayload,
  type ErrorClass,
} from '../stall-events.js';

describe('Issue #4802 Cycle-1.6: ErrorClass bounded enum', () => {
  it('has exactly 6 known values (no schema drift)', () => {
    expect(ERROR_CLASS_VALUES).toEqual([
      'transient_5xx',
      'permission_timeout',
      'jsonl_stall',
      'thinking_stall',
      'unknown_stall',
      'extended_working',
    ]);
  });

  it('isErrorClass accepts every known value', () => {
    for (const v of ERROR_CLASS_VALUES) {
      expect(isErrorClass(v)).toBe(true);
    }
  });

  it('isErrorClass rejects unknown values', () => {
    expect(isErrorClass('5xx_529')).toBe(false);
    expect(isErrorClass('rate_limit')).toBe(false);
    expect(isErrorClass('overloaded')).toBe(false);
    expect(isErrorClass('transient_4xx')).toBe(false);
    expect(isErrorClass('')).toBe(false);
    expect(isErrorClass(null)).toBe(false);
    expect(isErrorClass(undefined)).toBe(false);
    expect(isErrorClass(529)).toBe(false);
    expect(isErrorClass({})).toBe(false);
  });

  it('isErrorClass rejects prompt-injection-style inputs', () => {
    // Common injection patterns that must NOT bypass the enum check
    expect(isErrorClass('transient_5xx; DROP TABLE')).toBe(false);
    expect(isErrorClass('transient_5xx\nfake')).toBe(false);
    expect(isErrorClass('  transient_5xx  ')).toBe(false);
  });
});

describe('Issue #4802 Cycle-1.6: buildStallEventPayload contract', () => {
  it('builds a valid payload with required fields', () => {
    const p = buildStallEventPayload({
      errorClass: 'transient_5xx',
      statusCode: 529,
      stallDurationMs: 14 * 60_000,
      recoveryAttemptCount: 3,
      recoveryMaxAttempts: 5,
      recoveryDisabled: false,
    });
    expect(p.errorClass).toBe('transient_5xx');
    expect(p.statusCode).toBe(529);
    expect(p.stallDurationMs).toBe(840_000);
    expect(p.recoveryAttemptCount).toBe(3);
    expect(p.recoveryMaxAttempts).toBe(5);
    expect(p.recoveryDisabled).toBe(false);
    expect(typeof p.lastErrorAt).toBe('string');
  });

  it('defaults recovery fields to 0/false when omitted', () => {
    const p = buildStallEventPayload({
      errorClass: 'jsonl_stall',
      stallDurationMs: 60_000,
    });
    expect(p.recoveryAttemptCount).toBe(0);
    expect(p.recoveryMaxAttempts).toBe(0);
    expect(p.recoveryDisabled).toBe(false);
    expect(p.statusCode).toBeUndefined();
  });

  it('rejects unknown errorClass at construction time (defense)', () => {
    expect(() => buildStallEventPayload({
      errorClass: 'rate_limit' as unknown as ErrorClass,
      stallDurationMs: 1000,
    })).toThrow(TypeError);
    expect(() => buildStallEventPayload({
      errorClass: '5xx_529' as unknown as ErrorClass,
      stallDurationMs: 1000,
    })).toThrow(TypeError);
  });

  it('rejects statusCode when errorClass is not transient_5xx', () => {
    expect(() => buildStallEventPayload({
      errorClass: 'jsonl_stall',
      statusCode: 529,
      stallDurationMs: 1000,
    })).toThrow(RangeError);
    expect(() => buildStallEventPayload({
      errorClass: 'permission_timeout',
      statusCode: 408,
      stallDurationMs: 1000,
    })).toThrow(RangeError);
  });

  it('accepts every errorClass without statusCode', () => {
    for (const ec of ERROR_CLASS_VALUES) {
      const p = buildStallEventPayload({ errorClass: ec, stallDurationMs: 0 });
      expect(p.errorClass).toBe(ec);
      expect(p.statusCode).toBeUndefined();
    }
  });
});

describe('Issue #4802 Cycle-1.6: channel-fanout safety split', () => {
  it('drops statusCode from channel fanout', () => {
    const p = buildStallEventPayload({
      errorClass: 'transient_5xx',
      statusCode: 529,
      stallDurationMs: 60_000,
      recoveryAttemptCount: 2,
      recoveryMaxAttempts: 5,
      recoveryDisabled: false,
    });
    const fanout = toChannelFanoutPayload(p);
    expect(fanout).not.toHaveProperty('statusCode');
    expect(fanout.errorClass).toBe('transient_5xx');
    expect(fanout.stallDurationMs).toBe(60_000);
    expect(fanout.recoveryAttemptCount).toBe(2);
  });

  it('preserves all non-fingerprint-y fields for the operator dashboard', () => {
    const p = buildStallEventPayload({
      errorClass: 'transient_5xx',
      statusCode: 529,
      stallDurationMs: 60_000,
      recoveryAttemptCount: 2,
      recoveryMaxAttempts: 5,
      recoveryDisabled: true,
    });
    const fanout = toChannelFanoutPayload(p);
    expect(fanout.errorClass).toBe('transient_5xx');
    expect(fanout.recoveryDisabled).toBe(true);
    expect(fanout.recoveryMaxAttempts).toBe(5);
  });
});
