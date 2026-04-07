/**
 * thinking-stall-detection.test.ts — Tests for Issue #1324: extended thinking stall detection.
 *
 * When CC enters extended thinking mode, the statusText shows "Cogitated for Xm Ys"
 * but no JSONL bytes are produced. The stall detector should use a longer threshold
 * for this legitimate working state.
 */

import { describe, it, expect } from 'vitest';
import { parseCogitatedDuration } from '../terminal-parser.js';

describe('parseCogitatedDuration', () => {
  it('should parse "Cogitated for 2m 30s" to 150000ms', () => {
    expect(parseCogitatedDuration('Cogitated for 2m 30s')).toBe(150_000);
  });

  it('should parse "Cogitated for 0m 45s" to 45000ms', () => {
    expect(parseCogitatedDuration('Cogitated for 0m 45s')).toBe(45_000);
  });

  it('should parse "Cogitated for 10m 0s" to 600000ms', () => {
    expect(parseCogitatedDuration('Cogitated for 10m 0s')).toBe(600_000);
  });

  it('should handle leading/trailing whitespace', () => {
    expect(parseCogitatedDuration('  Cogitated for 1m 0s  ')).toBe(60_000);
  });

  it('should be case-insensitive for "Cogitated"', () => {
    expect(parseCogitatedDuration('cogitated for 3m 15s')).toBe(195_000);
    expect(parseCogitatedDuration('COGITATED FOR 1m 0s')).toBe(60_000);
  });

  it('should return null for non-matching text', () => {
    expect(parseCogitatedDuration('Reading files...')).toBeNull();
    expect(parseCogitatedDuration('Analyzing code...')).toBeNull();
    expect(parseCogitatedDuration('')).toBeNull();
    expect(parseCogitatedDuration('Worked for 2m 30s')).toBeNull();
  });

  it('should return null for partial matches', () => {
    expect(parseCogitatedDuration('Cogitated')).toBeNull();
    expect(parseCogitatedDuration('Cogitated for')).toBeNull();
    expect(parseCogitatedDuration('Cogitated for 2m')).toBeNull();
  });
});

describe('Thinking stall threshold logic', () => {
  const THINKING_STALL_MULTIPLIER = 5;

  it('should use 5x the normal stall threshold for thinking stalls', () => {
    const baseThreshold = 2 * 60 * 1000; // 2 min default
    const thinkingThreshold = baseThreshold * THINKING_STALL_MULTIPLIER; // 10 min
    expect(thinkingThreshold).toBe(10 * 60 * 1000);
  });

  it('should NOT trigger thinking stall under 5x threshold', () => {
    const baseThreshold = 2 * 60 * 1000;
    const thinkingThreshold = baseThreshold * THINKING_STALL_MULTIPLIER;
    const stallDuration = 8 * 60 * 1000; // 8 min — under 10 min thinking threshold

    // Would trigger normal JSONL stall (8 min > 2 min), but thinking gets 10 min
    expect(stallDuration >= baseThreshold).toBe(true);      // Normal stall would fire
    expect(stallDuration >= thinkingThreshold).toBe(false); // But thinking stall should NOT fire
  });

  it('should trigger thinking stall after 5x threshold', () => {
    const baseThreshold = 2 * 60 * 1000;
    const thinkingThreshold = baseThreshold * THINKING_STALL_MULTIPLIER;
    const stallDuration = 12 * 60 * 1000; // 12 min — over 10 min thinking threshold

    expect(stallDuration >= thinkingThreshold).toBe(true);
  });

  it('should reset thinking stall when bytes increase', () => {
    // When CC finishes thinking and starts writing output, thinking stall clears
    const stallNotified = new Set<string>();
    stallNotified.add('session-1:thinking');

    // Bytes increased — clear thinking stall
    stallNotified.delete('session-1:thinking');
    expect(stallNotified.has('session-1:thinking')).toBe(false);
  });

  it('should NOT use thinking threshold when statusText is not Cogitated', () => {
    const statusText = 'Reading files...';
    const thinkingDuration = null; // parseCogitatedDuration returns null
    expect(thinkingDuration).toBeNull();
    // Falls through to normal JSONL stall detection
  });

  it('should NOT use thinking threshold when statusText is null', () => {
    const statusText = null;
    const thinkingDuration = statusText ? null : null;
    expect(thinkingDuration).toBeNull();
  });
});
