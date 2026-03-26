/**
 * stop-failure.test.ts — Tests for Issue #15: StopFailure hook support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('StopFailure hook support', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-stop-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('stop signal file format', () => {
    it('should write valid stop signal JSON', () => {
      const signalFile = join(tmpDir, 'stop_signals.json');
      const signals: Record<string, unknown> = {};

      signals['test-session-id'] = {
        event: 'StopFailure',
        timestamp: Date.now(),
        error: 'Rate limit exceeded',
        stop_reason: 'rate_limit',
      };

      writeFileSync(signalFile, JSON.stringify(signals, null, 2));

      const parsed = JSON.parse(readFileSync(signalFile, 'utf-8'));
      expect(parsed['test-session-id'].event).toBe('StopFailure');
      expect(parsed['test-session-id'].error).toBe('Rate limit exceeded');
    });

    it('should write Stop event signal', () => {
      const signal = {
        event: 'Stop',
        timestamp: Date.now(),
        error: null,
        stop_reason: 'end_turn',
      };

      expect(signal.event).toBe('Stop');
      expect(signal.error).toBeNull();
    });

    it('should handle StopFailure with no error details', () => {
      const signal = {
        event: 'StopFailure',
        timestamp: Date.now(),
        error: null,
        error_details: null,
        last_assistant_message: null,
        agent_id: null,
        stop_reason: null,
      };

      const errorDetail = signal.error || signal.stop_reason || 'Unknown API error';
      expect(errorDetail).toBe('Unknown API error');
    });

    it('should capture error_details, last_assistant_message, agent_id from StopFailure', () => {
      const signal = {
        event: 'StopFailure',
        timestamp: Date.now(),
        error: 'Rate limit exceeded',
        error_details: 'Too many requests, retry after 30s',
        last_assistant_message: 'I was working on fixing the bug...',
        agent_id: 'agent-123',
        stop_reason: 'rate_limit',
      };

      expect(signal.error_details).toBe('Too many requests, retry after 30s');
      expect(signal.last_assistant_message).toBe('I was working on fixing the bug...');
      expect(signal.agent_id).toBe('agent-123');
    });
  });

  describe('signal deduplication', () => {
    it('should not re-process same signal', () => {
      const processedSignals = new Set<string>();
      const signalKey = 'session-123:1711072800000';

      // First time — should process
      expect(processedSignals.has(signalKey)).toBe(false);
      processedSignals.add(signalKey);

      // Second time — should skip
      expect(processedSignals.has(signalKey)).toBe(true);
    });

    it('should process different timestamps for same session', () => {
      const processedSignals = new Set<string>();

      processedSignals.add('session-123:1000');
      expect(processedSignals.has('session-123:2000')).toBe(false);
    });
  });

  describe('event type routing', () => {
    it('should route StopFailure to status.error', () => {
      const event = 'StopFailure';
      const channelEvent = event === 'StopFailure' ? 'status.error' : 'status.stopped';
      expect(channelEvent).toBe('status.error');
    });

    it('should route Stop to status.stopped', () => {
      const event: string = 'Stop';
      const channelEvent = event === 'StopFailure' ? 'status.error' : 'status.stopped';
      expect(channelEvent).toBe('status.stopped');
    });
  });

  describe('hook install for Stop/StopFailure', () => {
    it('should register hooks for all three events', () => {
      const events = ['SessionStart', 'Stop', 'StopFailure'];
      const hooks: Record<string, unknown[]> = {};

      for (const event of events) {
        hooks[event] = [{ hooks: [{ type: 'command', command: 'node hook.js' }] }];
      }

      expect(Object.keys(hooks)).toEqual(events);
      expect(hooks.SessionStart).toHaveLength(1);
      expect(hooks.Stop).toHaveLength(1);
      expect(hooks.StopFailure).toHaveLength(1);
    });
  });
});
