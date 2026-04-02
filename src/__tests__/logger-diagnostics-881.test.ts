/**
 * logger-diagnostics-881.test.ts - Tests for Issue #881 structured logging and diagnostics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_DIAGNOSTICS_BUFFER_SIZE,
  DiagnosticsBus,
  sanitizeDiagnosticsAttributes,
} from '../diagnostics.js';
import { StructuredLogger, setStructuredLogSink } from '../logger.js';

describe('Issue #881: structured logger and diagnostics bus', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    setStructuredLogSink({});
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    setStructuredLogSink({});
  });

  it('emits structured JSON logs with schema fields and diagnostics event', () => {
    const bus = new DiagnosticsBus(10);
    const structuredLogger = new StructuredLogger(bus);

    structuredLogger.warn({
      component: 'monitor',
      operation: 'permission_timeout_auto_reject',
      sessionId: 'session-123',
      errorCode: 'PERMISSION_TIMEOUT',
      attributes: { timeoutMinutes: 10, windowName: 'cc-test' },
    });

    expect(console.warn).toHaveBeenCalledTimes(1);
    const payload = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const record = JSON.parse(payload) as Record<string, unknown>;

    expect(record).toEqual(expect.objectContaining({
      level: 'warn',
      component: 'monitor',
      operation: 'permission_timeout_auto_reject',
      sessionId: 'session-123',
      errorCode: 'PERMISSION_TIMEOUT',
      attributes: { timeoutMinutes: 10, windowName: 'cc-test' },
    }));
    expect(typeof record.timestamp).toBe('string');

    const [event] = bus.getRecent();
    expect(event).toEqual(expect.objectContaining({
      event: 'monitor.permission_timeout_auto_reject',
      level: 'warn',
      component: 'monitor',
      operation: 'permission_timeout_auto_reject',
      sessionId: 'session-123',
      errorCode: 'PERMISSION_TIMEOUT',
      attributes: { timeoutMinutes: 10, windowName: 'cc-test' },
    }));
    expect(typeof event.timestamp).toBe('string');
  });

  it('redacts sensitive fields recursively for no-PII diagnostics attributes', () => {
    const sanitized = sanitizeDiagnosticsAttributes({
      timeoutMinutes: 10,
      workDir: '/secret/project',
      nested: {
        authToken: 'abc123',
        detail: 'still useful',
      },
      prompt: 'do something',
      metadata: [
        { password: 'never' },
        { safeKey: 'safe-value' },
      ],
      eventDetail: 'still useful',
    });

    expect(sanitized).toEqual({
      timeoutMinutes: 10,
      nested: { detail: 'still useful' },
      metadata: [{}, { safeKey: 'safe-value' }],
      eventDetail: 'still useful',
    });
  });

  it('evicts oldest diagnostics events when buffer is full', () => {
    const bus = new DiagnosticsBus(3);

    for (let i = 1; i <= 5; i += 1) {
      bus.emit({
        event: `monitor.event_${i}`,
        level: 'info',
        component: 'monitor',
        operation: `event_${i}`,
        timestamp: new Date().toISOString(),
        attributes: { sequence: i },
      });
    }

    const events = bus.getRecent();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.operation)).toEqual(['event_3', 'event_4', 'event_5']);
  });

  it('uses default bounded diagnostics buffer size and enforces getRecent limit', () => {
    const bus = new DiagnosticsBus();

    for (let i = 1; i <= DEFAULT_DIAGNOSTICS_BUFFER_SIZE + 25; i += 1) {
      bus.emit({
        event: `monitor.event_${i}`,
        level: 'info',
        component: 'monitor',
        operation: `event_${i}`,
        timestamp: new Date().toISOString(),
        attributes: { sequence: i },
      });
    }

    const recentFive = bus.getRecent(5);
    expect(bus.getRecent()).toHaveLength(DEFAULT_DIAGNOSTICS_BUFFER_SIZE);
    expect(recentFive).toHaveLength(5);
    expect(recentFive.map((e) => e.operation)).toEqual([
      `event_${DEFAULT_DIAGNOSTICS_BUFFER_SIZE + 21}`,
      `event_${DEFAULT_DIAGNOSTICS_BUFFER_SIZE + 22}`,
      `event_${DEFAULT_DIAGNOSTICS_BUFFER_SIZE + 23}`,
      `event_${DEFAULT_DIAGNOSTICS_BUFFER_SIZE + 24}`,
      `event_${DEFAULT_DIAGNOSTICS_BUFFER_SIZE + 25}`,
    ]);
  });
});
