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

// ── Issue #2144: Fixed retry delays ───────────────────────────────────

describe('WebhookChannel fixed retry delays (Issue #2144)', () => {
  it('should produce deterministic delays from RETRY_DELAYS_MS', () => {
    expect(WebhookChannel.backoff(1)).toBe(1000);
    expect(WebhookChannel.backoff(2)).toBe(5000);
    expect(WebhookChannel.backoff(3)).toBe(30000);
  });

  it('should produce identical delays repeatedly (deterministic, no jitter)', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(WebhookChannel.backoff(1));
    }
    // Deterministic — all calls return the same value
    expect(delays.size).toBe(1);
  });

  it('should return fixed delays: 1000ms for attempt 1, 5000ms for attempt 2, 30000ms for attempt 3', () => {
    expect(WebhookChannel.backoff(1)).toBe(1000);
    expect(WebhookChannel.backoff(2)).toBe(5000);
    expect(WebhookChannel.backoff(3)).toBe(30000);
  });
});
