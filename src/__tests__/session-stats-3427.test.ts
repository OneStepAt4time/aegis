/**
 * Issue #3427: Session stats show 0% completion rate
 *
 * Root cause: metrics.sessionCompleted() was only called from monitor's
 * checkStopSignals, never from the hook event handler. If the monitor
 * didn't detect the stop signal (e.g., ACP mode), completed stayed 0.
 *
 * Fix: metrics.sessionCompleted/sessionFailed are now called from hooks
 * AND are idempotent (won't double-count if both paths fire).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../metrics.js';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Issue #3427: session stats completion tracking', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector(join(tmpdir(), `test-metrics-${Date.now()}.json`));
  });

  it('should count sessionCompleted when called', () => {
    metrics.sessionCreated('s1');
    metrics.sessionCompleted('s1');

    const result = metrics.getGlobalMetrics(1);
    expect(result.sessions.completed).toBe(1);
    expect(result.sessions.failed).toBe(0);
  });

  it('should count sessionFailed when called', () => {
    metrics.sessionCreated('s2');
    metrics.sessionFailed('s2');

    const result = metrics.getGlobalMetrics(1);
    expect(result.sessions.completed).toBe(0);
    expect(result.sessions.failed).toBe(1);
  });

  it('should be idempotent — sessionCompleted called twice counts once', () => {
    metrics.sessionCreated('s3');
    metrics.sessionCompleted('s3');
    metrics.sessionCompleted('s3'); // duplicate (e.g., hooks + monitor both fire)

    const result = metrics.getGlobalMetrics(1);
    expect(result.sessions.completed).toBe(1);
  });

  it('should be idempotent — sessionFailed called twice counts once', () => {
    metrics.sessionCreated('s4');
    metrics.sessionFailed('s4');
    metrics.sessionFailed('s4'); // duplicate

    const result = metrics.getGlobalMetrics(1);
    expect(result.sessions.failed).toBe(1);
  });

  it('should not count both completed and failed for same session', () => {
    metrics.sessionCreated('s5');
    metrics.sessionCompleted('s5');
    metrics.sessionFailed('s5'); // conflicting — first one wins

    const result = metrics.getGlobalMetrics(1);
    expect(result.sessions.completed).toBe(1);
    expect(result.sessions.failed).toBe(0);
  });

  it('should count multiple different sessions correctly', () => {
    metrics.sessionCreated('s6');
    metrics.sessionCreated('s7');
    metrics.sessionCreated('s8');
    metrics.sessionCompleted('s6');
    metrics.sessionCompleted('s7');
    metrics.sessionFailed('s8');

    const result = metrics.getGlobalMetrics(0);
    expect(result.sessions.completed).toBe(2);
    expect(result.sessions.failed).toBe(1);
  });
});
