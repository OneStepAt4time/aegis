import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatUptime, formatTimeAgo, formatDuration } from './format.js';

describe('formatUptime', () => {
  it('returns "0s" for negative values', () => {
    expect(formatUptime(-1)).toBe('0s');
    expect(formatUptime(-999)).toBe('0s');
  });

  it('returns seconds for values under 60', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(30)).toBe('30s');
    expect(formatUptime(59)).toBe('59s');
  });

  it('returns minutes for values between 60 and 3599', () => {
    expect(formatUptime(60)).toBe('1m');
    expect(formatUptime(300)).toBe('5m');
    expect(formatUptime(3599)).toBe('59m');
  });

  it('returns "Xh Ym" when both hours and minutes are non-zero', () => {
    expect(formatUptime(3661)).toBe('1h 1m');
    expect(formatUptime(7325)).toBe('2h 2m');
  });

  it('returns "Xh" when minutes are zero after hour truncation', () => {
    expect(formatUptime(7200)).toBe('2h');
  });

  it('floors fractional seconds', () => {
    expect(formatUptime(30.9)).toBe('30s');
    expect(formatUptime(90.5)).toBe('1m');
  });
});

describe('formatTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for future timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    expect(formatTimeAgo(Date.now() + 5000)).toBe('just now');
  });

  it('returns seconds ago for < 60s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    expect(formatTimeAgo(Date.now() - 30_000)).toBe('30s ago');
    expect(formatTimeAgo(Date.now() - 1_000)).toBe('1s ago');
  });

  it('returns minutes ago for < 60min', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    expect(formatTimeAgo(Date.now() - 120_000)).toBe('2m ago');
    expect(formatTimeAgo(Date.now() - 3_540_000)).toBe('59m ago');
  });

  it('returns hours ago for < 24h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    expect(formatTimeAgo(Date.now() - 3_600_000)).toBe('1h ago');
    expect(formatTimeAgo(Date.now() - 86_400_000 + 1000)).toBe('23h ago');
  });

  it('returns days ago for >= 24h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    expect(formatTimeAgo(Date.now() - 86_400_000)).toBe('1d ago');
    expect(formatTimeAgo(Date.now() - 172_800_000)).toBe('2d ago');
    expect(formatTimeAgo(Date.now() - 604_800_000)).toBe('7d ago');
  });
});

describe('formatDuration', () => {
  it('returns "0s" for negative values', () => {
    expect(formatDuration(-1)).toBe('0s');
  });

  it('returns seconds for < 60s', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(30_000)).toBe('30s');
    expect(formatDuration(59_999)).toBe('59s');
  });

  it('returns minutes and padded seconds for < 60min', () => {
    expect(formatDuration(60_000)).toBe('1m 00s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3599_999)).toBe('59m 59s');
  });

  it('returns hours and padded minutes for >= 60min', () => {
    expect(formatDuration(3_600_000)).toBe('1h 00m');
    expect(formatDuration(3_660_000)).toBe('1h 01m');
    expect(formatDuration(7_320_000)).toBe('2h 02m');
    expect(formatDuration(36_000_000)).toBe('10h 00m');
  });

  it('pads single-digit seconds/minutes with leading zero', () => {
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(3_660_000)).toBe('1h 01m');
  });
});
