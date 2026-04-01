/**
 * channels.test.ts — Tests for circuit breaker (M10) and jittered backoff (M11).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelManager, RetriableError } from '../channels/manager.js';
import { WebhookChannel } from '../channels/webhook.js';
import type { Channel, SessionEventPayload } from '../channels/types.js';

const noopInbound = async () => {};

function makePayload(event: SessionEventPayload['event'] = 'status.idle'): SessionEventPayload {
  return {
    event,
    timestamp: new Date().toISOString(),
    session: { id: 'test-1', name: 'test', workDir: '/tmp' },
    detail: 'test',
  };
}

// ── M10: Circuit breaker ────────────────────────────────────────────

describe('ChannelManager circuit breaker (M10)', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager();
  });

  it('should call channel normally when it succeeds', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ch: Channel = {
      name: 'ok-channel',
      onStatusChange: handler,
    };
    manager.register(ch);
    await manager.init(noopInbound);

    await manager.statusChange(makePayload());

    expect(handler).toHaveBeenCalledOnce();
  });

  it('should skip a disabled channel during cooldown', async () => {
    const handler = vi.fn().mockRejectedValue(new RetriableError('fail'));
    const ch: Channel = {
      name: 'flaky',
      onStatusChange: handler,
    };
    manager.register(ch);
    await manager.init(noopInbound);

    // Trigger enough failures to trip the breaker (threshold = 5)
    for (let i = 0; i < 5; i++) {
      await manager.statusChange(makePayload());
    }

    expect(handler).toHaveBeenCalledTimes(5);

    // 6th call — channel is disabled, handler should NOT be called
    await manager.statusChange(makePayload());
    expect(handler).toHaveBeenCalledTimes(5);
  });

  it('should re-enable channel after cooldown expires', async () => {
    const handler = vi.fn().mockRejectedValue(new RetriableError('fail'));
    const ch: Channel = {
      name: 'flaky',
      onStatusChange: handler,
    };
    manager.register(ch);
    await manager.init(noopInbound);

    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      await manager.statusChange(makePayload());
    }

    // Advance time past cooldown (5 min)
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + ChannelManager.COOLDOWN_MS + 1000);

    await manager.statusChange(makePayload());
    expect(handler).toHaveBeenCalledTimes(6); // called again

    vi.useRealTimers();
  });

  it('should reset fail count on success', async () => {
    let callCount = 0;
    const handler = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 3) throw new RetriableError('transient');
    });
    const ch: Channel = {
      name: 'recovering',
      onStatusChange: handler,
    };
    manager.register(ch);
    await manager.init(noopInbound);

    // 3 failures, then success
    for (let i = 0; i < 4; i++) {
      await manager.statusChange(makePayload());
    }

    // Should NOT be disabled — fail count was reset by the success
    await manager.statusChange(makePayload());
    expect(handler).toHaveBeenCalledTimes(5);
  });

  it('should not affect other channels when one is disabled', async () => {
    const failHandler = vi.fn().mockRejectedValue(new RetriableError('fail'));
    const okHandler = vi.fn().mockResolvedValue(undefined);

    const chFail: Channel = { name: 'bad', onStatusChange: failHandler };
    const chOk: Channel = { name: 'good', onStatusChange: okHandler };

    manager.register(chFail);
    manager.register(chOk);
    await manager.init(noopInbound);

    // Trip the breaker on bad channel
    for (let i = 0; i < 5; i++) {
      await manager.statusChange(makePayload());
    }

    // good channel should have been called on every event
    expect(okHandler).toHaveBeenCalledTimes(5);
  });
});

// ── M11: Jittered backoff ───────────────────────────────────────────

describe('WebhookChannel jittered backoff (M11)', () => {
  it('should produce delays in range [base*0.5, base*1.0]', () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const base = WebhookChannel.BASE_DELAY_MS * Math.pow(2, attempt - 1);
      for (let i = 0; i < 100; i++) {
        const delay = WebhookChannel.backoff(attempt);
        expect(delay).toBeGreaterThanOrEqual(base * 0.5);
        expect(delay).toBeLessThanOrEqual(base * 1.0);
      }
    }
  });

  it('should not produce identical delays repeatedly (jitter is random)', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(WebhookChannel.backoff(1));
    }
    // With 50 samples of continuous random values, we should get many unique delays
    expect(delays.size).toBeGreaterThan(1);
  });

  it('should return ~750ms base for attempt 1, ~1500ms for attempt 2, ~3000ms for attempt 3', () => {
    const avg = (attempt: number, n = 1000) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += WebhookChannel.backoff(attempt);
      return sum / n;
    };

    // Average should be ~75% of base (midpoint of 0.5-1.0 range)
    // Use range checks to avoid flakiness from jitter randomness
    const a1 = avg(1);
    expect(a1).toBeGreaterThan(600);
    expect(a1).toBeLessThan(900);    // base 1000, range [500,1000]
    const a2 = avg(2);
    expect(a2).toBeGreaterThan(1200);
    expect(a2).toBeLessThan(1800);   // base 2000, range [1000,2000]
    const a3 = avg(3);
    expect(a3).toBeGreaterThan(2500);
    expect(a3).toBeLessThan(3500);   // base 4000, range [2000,4000]
  });
});
