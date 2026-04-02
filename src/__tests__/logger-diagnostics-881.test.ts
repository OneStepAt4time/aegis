/**
 * logger-diagnostics-881.test.ts — Tests for Issue #881 structured logging and diagnostics.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiagnosticsBus, sanitizeDiagnosticsAttributes } from '../diagnostics.js';
import { StructuredLogger } from '../logger.js';

describe('Issue #881: structured logger and diagnostics bus', () => {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  beforeEach(() => {
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it('emits structured JSON logs with core fields', () => {
    const bus = new DiagnosticsBus(10);
    const logger = new StructuredLogger(bus);

    logger.warn({
      component: 'monitor',
      operation: 'permission_timeout_auto_reject',
      sessionId: 'session-123',
      errorCode: 'PERMISSION_TIMEOUT',
      attributes: { timeoutMinutes: 10, windowName: 'cc-test' },
    });

    expect(console.warn).toHaveBeenCalledTimes(1);
    const payload = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const record = JSON.parse(payload) as Record<string, unknown>;

    expect(record.level).toBe('warn');
    expect(record.component).toBe('monitor');
    expect(record.operation).toBe('permission_timeout_auto_reject');
    expect(record.sessionId).toBe('session-123');
    expect(record.errorCode).toBe('PERMISSION_TIMEOUT');
    expect(record.attributes).toEqual({ timeoutMinutes: 10, windowName: 'cc-test' });

    const events = bus.getRecent();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('monitor.permission_timeout_auto_reject');
  });

  it('drops sensitive fields from diagnostics attributes', () => {
    const sanitized = sanitizeDiagnosticsAttributes({
      timeoutMinutes: 10,
      workDir: '/secret/project',
      token: 'abc123',
      prompt: 'do something',
      windowPath: '/tmp/visible',
      eventDetail: 'still useful',
      textContent: 'keep this diagnostic text',
      safeKey: 'safe-value',
    });

    expect(sanitized).toEqual({
      timeoutMinutes: 10,
      windowPath: '/tmp/visible',
      eventDetail: 'still useful',
      textContent: 'keep this diagnostic text',
      safeKey: 'safe-value',
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
});
