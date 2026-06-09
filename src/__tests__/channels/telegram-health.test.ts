/**
 * channels/telegram-health.test.ts — Tests for health tracking (#4626).
 *
 * Extracted from telegram/index.ts god-module split.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHealthTracker,
  trackSuccess,
  trackFailure,
  getHealth,
} from '../../channels/telegram/health.js';

describe('health tracking', () => {
  const redactError = (err: unknown) => err;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with null state', () => {
    const tracker = createHealthTracker();
    expect(tracker.lastSuccessAt).toBeNull();
    expect(tracker.lastErrorAt).toBeNull();
    expect(tracker.lastErrorMessage).toBeNull();
    expect(tracker.deliveryFailCount).toBe(0);
  });

  it('trackSuccess sets lastSuccessAt and resets deliveryFailCount', () => {
    const tracker = createHealthTracker();
    tracker.deliveryFailCount = 3;
    trackSuccess(tracker);
    expect(tracker.lastSuccessAt).not.toBeNull();
    expect(tracker.deliveryFailCount).toBe(0);
  });

  it('trackFailure sets lastErrorAt and increments deliveryFailCount', () => {
    const tracker = createHealthTracker();
    trackFailure(tracker, new Error('boom'), redactError);
    expect(tracker.lastErrorAt).not.toBeNull();
    expect(tracker.lastErrorMessage).toBe('boom');
    expect(tracker.deliveryFailCount).toBe(1);
  });

  it('getHealth reports healthy when no errors', () => {
    const tracker = createHealthTracker();
    const health = getHealth(tracker, 'telegram', 0);
    expect(health.healthy).toBe(true);
    expect(health.lastError).toBeNull();
  });

  it('getHealth reports unhealthy after failure without success', () => {
    const tracker = createHealthTracker();
    trackFailure(tracker, new Error('boom'), redactError);
    const health = getHealth(tracker, 'telegram', 5);
    expect(health.healthy).toBe(false);
    expect(health.lastError).toBe('boom');
    expect(health.pendingCount).toBe(5);
  });

  it('getHealth reports healthy after success following failure', () => {
    const tracker = createHealthTracker();
    trackFailure(tracker, new Error('boom'), redactError);
    vi.advanceTimersByTime(1000);
    trackSuccess(tracker);
    const health = getHealth(tracker, 'telegram', 0);
    expect(health.healthy).toBe(true);
  });
});
