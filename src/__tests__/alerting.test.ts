/**
 * alerting.test.ts — Tests for the AlertManager (Issue #1418).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { AlertManager, type AlertType } from '../alerting.js';

describe('AlertManager', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('recordFailure', () => {
    it('does not fire alert when below threshold', () => {
      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 5,
        cooldownMs: 60_000,
      });

      for (let i = 0; i < 4; i++) {
        manager.recordFailure('session_failure', `failure ${i}`);
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('fires alert when threshold is reached', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 5,
        cooldownMs: 60_000,
      });

      for (let i = 0; i < 5; i++) {
        manager.recordFailure('session_failure', `failure ${i}`);
      }

      // recordFailure fires async — advance timers and flush microtasks
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9999/alerts');
      expect(options.method).toBe('POST');
      expect(options.headers['X-Aegis-Alert-Type']).toBe('session_failure');

      const body = JSON.parse(options.body);
      expect(body.event).toBe('alert');
      expect(body.type).toBe('session_failure');
      expect(body.failureCount).toBe(5);
      expect(body.threshold).toBe(5);
    });

    it('does not fire alert during cooldown period', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 3,
        cooldownMs: 10_000,
      });

      // Trigger first alert
      for (let i = 0; i < 3; i++) {
        manager.recordFailure('session_failure', `failure ${i}`);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Try to trigger again immediately — should be suppressed by cooldown
      for (let i = 0; i < 3; i++) {
        manager.recordFailure('session_failure', `failure ${i + 3}`);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1); // still 1

      // Advance past cooldown window (resets failure count)
      await vi.advanceTimersByTimeAsync(10_001);

      // Need to re-accumulate failures past threshold after window reset
      for (let i = 0; i < 3; i++) {
        manager.recordFailure('session_failure', `failure ${i + 6}`);
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('resets failure count after cooldown window expires', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 5,
        cooldownMs: 10_000,
      });

      // Record 3 failures
      for (let i = 0; i < 3; i++) {
        manager.recordFailure('session_failure', `failure ${i}`);
      }

      // Advance past the cooldown window — count should reset
      await vi.advanceTimersByTimeAsync(10_001);

      // Record 5 more failures — should trigger alert
      for (let i = 0; i < 5; i++) {
        manager.recordFailure('session_failure', `failure ${i + 3}`);
      }
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no webhooks are configured', () => {
      const manager = new AlertManager({
        webhooks: [],
        failureThreshold: 1,
        cooldownMs: 1000,
      });

      manager.recordFailure('session_failure', 'should not fire');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('tracks different alert types independently', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 2,
        cooldownMs: 60_000,
      });

      manager.recordFailure('session_failure', 's1');
      manager.recordFailure('session_failure', 's2');
      manager.recordFailure('tmux_crash', 't1');
      manager.recordFailure('tmux_crash', 't2');
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const calls = mockFetch.mock.calls.map(([_, opts]) => JSON.parse(opts.body));
      const types = calls.map(c => c.type);
      expect(types).toContain('session_failure');
      expect(types).toContain('tmux_crash');
    });

    it('fires to multiple webhooks', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: [
          'http://localhost:9999/alerts1',
          'http://localhost:9999/alerts2',
        ],
        failureThreshold: 1,
        cooldownMs: 60_000,
      });

      manager.recordFailure('api_error_rate', 'error spike');
      await vi.advanceTimersByTimeAsync(0);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('counts failed webhook deliveries', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 502 });

      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 1,
        cooldownMs: 60_000,
      });

      manager.recordFailure('session_failure', 'fail');
      await vi.advanceTimersByTimeAsync(0);

      const stats = manager.getStats();
      expect(stats.failed).toBe(1);
      expect(stats.delivered).toBe(0);
    });
  });

  describe('fireTestAlert', () => {
    it('returns sent=false when no webhooks configured', async () => {
      const manager = new AlertManager({ webhooks: [] });
      const result = await manager.fireTestAlert();
      expect(result.sent).toBe(false);
      expect(result.webhookCount).toBe(0);
    });

    it('fires a test alert webhook', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 5,
      });

      const result = await manager.fireTestAlert();
      expect(result.sent).toBe(true);
      expect(result.webhookCount).toBe(1);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.detail).toContain('Test alert');
    });
  });

  describe('getStats', () => {
    it('returns empty trackers initially', () => {
      const manager = new AlertManager();
      const stats = manager.getStats();
      expect(stats.delivered).toBe(0);
      expect(stats.failed).toBe(0);
      expect(Object.keys(stats.trackers)).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('clears all tracking state', () => {
      const manager = new AlertManager({
        webhooks: ['http://localhost:9999/alerts'],
        failureThreshold: 10,
      });

      manager.recordFailure('session_failure', 'f1');
      manager.recordFailure('session_failure', 'f2');

      manager.reset();

      const stats = manager.getStats();
      expect(stats.delivered).toBe(0);
      expect(stats.failed).toBe(0);
      expect(Object.keys(stats.trackers)).toHaveLength(0);
    });
  });

  describe('updateConfig', () => {
    it('allows updating webhooks at runtime', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const manager = new AlertManager({
        webhooks: [],
        failureThreshold: 1,
      });

      // No webhooks — should not fire
      manager.recordFailure('session_failure', 'f1');
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).not.toHaveBeenCalled();

      // Update config
      manager.updateConfig({
        webhooks: ['http://localhost:9999/alerts'],
      });

      // Now should fire
      manager.recordFailure('session_failure', 'f2');
      await vi.advanceTimersByTimeAsync(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
