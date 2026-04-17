import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { formatUptime, formatTimeAgo, formatDuration } from '../utils/format';

// ── formatUptime ─────────────────────────────────────────────────

describe('formatUptime', () => {
  it('returns "0s" for negative values', () => {
    expect(formatUptime(-1)).toBe('0s');
    expect(formatUptime(-100)).toBe('0s');
  });

  it('formats seconds-only values', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(30)).toBe('30s');
    expect(formatUptime(59)).toBe('59s');
  });

  it('formats minutes-only values', () => {
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(600)).toBe('10m');
  });

  it('formats hours-only values (exact hours)', () => {
    expect(formatUptime(3600)).toBe('1h');
    expect(formatUptime(7200)).toBe('2h');
  });

  it('formats hours and minutes together', () => {
    expect(formatUptime(3660)).toBe('1h 1m');
    expect(formatUptime(5400)).toBe('1h 30m');
    expect(formatUptime(9000)).toBe('2h 30m');
  });

  it('truncates seconds when minutes are present', () => {
    // 90 seconds = 1m, remainder seconds dropped
    expect(formatUptime(90)).toBe('1m');
  });
});

// ── formatTimeAgo ────────────────────────────────────────────────

describe('formatTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for future timestamps', () => {
    expect(formatTimeAgo(Date.now() + 5000)).toBe('just now');
  });

  it('returns "0s ago" for the current instant', () => {
    expect(formatTimeAgo(Date.now())).toBe('0s ago');
  });

  it('formats seconds ago', () => {
    expect(formatTimeAgo(Date.now() - 30_000)).toBe('30s ago');
  });

  it('formats minutes ago', () => {
    expect(formatTimeAgo(Date.now() - 5 * 60 * 1000)).toBe('5m ago');
  });

  it('formats hours ago', () => {
    expect(formatTimeAgo(Date.now() - 3 * 3600 * 1000)).toBe('3h ago');
  });

  it('formats days ago', () => {
    expect(formatTimeAgo(Date.now() - 2 * 24 * 3600 * 1000)).toBe('2d ago');
  });

  it('handles boundary at 59s → 0m', () => {
    expect(formatTimeAgo(Date.now() - 59_000)).toBe('59s ago');
    expect(formatTimeAgo(Date.now() - 60_000)).toBe('1m ago');
  });

  it('handles boundary at 59m → 0h', () => {
    expect(formatTimeAgo(Date.now() - 59 * 60_000)).toBe('59m ago');
    expect(formatTimeAgo(Date.now() - 60 * 60_000)).toBe('1h ago');
  });

  it('handles boundary at 23h → 0d', () => {
    expect(formatTimeAgo(Date.now() - 23 * 3600_000)).toBe('23h ago');
    expect(formatTimeAgo(Date.now() - 24 * 3600_000)).toBe('1d ago');
  });
});

// ── formatDuration ───────────────────────────────────────────────

describe('formatDuration', () => {
  it('returns "0s" for negative values', () => {
    expect(formatDuration(-1)).toBe('0s');
  });

  it('returns "0s" for zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats seconds-only durations', () => {
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(59_999)).toBe('59s');
  });

  it('formats minutes and seconds with zero-padding', () => {
    expect(formatDuration(60_000)).toBe('1m 00s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(599_000)).toBe('9m 59s');
  });

  it('formats hours and minutes with zero-padding', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m');
    expect(formatDuration(3_660_000)).toBe('1h 01m');
    expect(formatDuration(3_900_000)).toBe('1h 05m');
    expect(formatDuration(7_200_000)).toBe('2h 00m');
  });
});
