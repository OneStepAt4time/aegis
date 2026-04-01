import { describe, it, expect, vi } from 'vitest';
import { ChannelManager, RetriableError } from '../../channels/manager.js';
import type { Channel, SessionEventPayload, InboundHandler } from '../../channels/types.js';

function createMockChannel(name: string): {
  channel: Channel;
  onSessionCreated: ReturnType<typeof vi.fn>;
  onSessionEnded: ReturnType<typeof vi.fn>;
  onMessage: ReturnType<typeof vi.fn>;
  onStatusChange: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  const onSessionCreated = vi.fn().mockResolvedValue(undefined);
  const onSessionEnded = vi.fn().mockResolvedValue(undefined);
  const onMessage = vi.fn().mockResolvedValue(undefined);
  const onStatusChange = vi.fn().mockResolvedValue(undefined);
  const init = vi.fn().mockResolvedValue(undefined);
  const destroy = vi.fn().mockResolvedValue(undefined);

  const channel: Channel = {
    name,
    init,
    destroy,
    onSessionCreated,
    onSessionEnded,
    onMessage,
    onStatusChange,
  };

  return { channel, onSessionCreated, onSessionEnded, onMessage, onStatusChange, init, destroy };
}

function createPayload(event: SessionEventPayload['event']): SessionEventPayload {
  return {
    event,
    timestamp: '2024-01-01T00:00:00Z',
    session: {
      id: 'session-1',
      name: 'Test Session',
      workDir: '/test',
    },
    detail: 'Test detail',
  };
}

describe('ChannelManager', () => {
  describe('register', () => {
    it('registers channels', () => {
      const manager = new ChannelManager();
      const { channel } = createMockChannel('test');

      manager.register(channel);

      expect(manager.count).toBe(1);
    });

    it('can register multiple channels', () => {
      const manager = new ChannelManager();
      const { channel: ch1 } = createMockChannel('channel1');
      const { channel: ch2 } = createMockChannel('channel2');

      manager.register(ch1);
      manager.register(ch2);

      expect(manager.count).toBe(2);
    });
  });

  describe('init', () => {
    it('initializes all channels', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, init: init1 } = createMockChannel('ch1');
      const { channel: ch2, init: init2 } = createMockChannel('ch2');

      manager.register(ch1);
      manager.register(ch2);

      const handler: InboundHandler = async () => {};
      await manager.init(handler);

      expect(init1).toHaveBeenCalledWith(handler);
      expect(init2).toHaveBeenCalledWith(handler);
    });

    it('continues init even if one channel fails', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, init: init1 } = createMockChannel('ch1');
      const { channel: ch2, init: init2 } = createMockChannel('ch2');

      // First channel throws
      init1.mockRejectedValue(new Error('Init failed'));

      manager.register(ch1);
      manager.register(ch2);

      const handler: InboundHandler = async () => {};
      await manager.init(handler);

      // Both were called, second succeeded despite first failing
      expect(init1).toHaveBeenCalled();
      expect(init2).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('destroys all channels', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, destroy: destroy1 } = createMockChannel('ch1');
      const { channel: ch2, destroy: destroy2 } = createMockChannel('ch2');

      manager.register(ch1);
      manager.register(ch2);

      await manager.destroy();

      expect(destroy1).toHaveBeenCalled();
      expect(destroy2).toHaveBeenCalled();
    });

    it('continues destroy even if one channel fails', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, destroy: destroy1 } = createMockChannel('ch1');
      const { channel: ch2, destroy: destroy2 } = createMockChannel('ch2');

      destroy1.mockRejectedValue(new Error('Destroy failed'));

      manager.register(ch1);
      manager.register(ch2);

      await manager.destroy();

      expect(destroy1).toHaveBeenCalled();
      expect(destroy2).toHaveBeenCalled();
    });
  });

  describe('event fan-out', () => {
    it('fans out sessionCreated to all channels', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onSessionCreated: created1 } = createMockChannel('ch1');
      const { channel: ch2, onSessionCreated: created2 } = createMockChannel('ch2');

      manager.register(ch1);
      manager.register(ch2);

      const payload = createPayload('session.created');
      await manager.sessionCreated(payload);

      expect(created1).toHaveBeenCalledWith(payload);
      expect(created2).toHaveBeenCalledWith(payload);
    });

    it('fans out sessionEnded to all channels', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onSessionEnded: ended1 } = createMockChannel('ch1');
      const { channel: ch2, onSessionEnded: ended2 } = createMockChannel('ch2');

      manager.register(ch1);
      manager.register(ch2);

      const payload = createPayload('session.ended');
      await manager.sessionEnded(payload);

      expect(ended1).toHaveBeenCalledWith(payload);
      expect(ended2).toHaveBeenCalledWith(payload);
    });

    it('fans out message to all channels', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onMessage: msg1 } = createMockChannel('ch1');
      const { channel: ch2, onMessage: msg2 } = createMockChannel('ch2');

      manager.register(ch1);
      manager.register(ch2);

      const payload = createPayload('message.user');
      await manager.message(payload);

      expect(msg1).toHaveBeenCalledWith(payload);
      expect(msg2).toHaveBeenCalledWith(payload);
    });

    it('fans out statusChange to all channels', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onStatusChange: status1 } = createMockChannel('ch1');
      const { channel: ch2, onStatusChange: status2 } = createMockChannel('ch2');

      manager.register(ch1);
      manager.register(ch2);

      const payload = createPayload('status.idle');
      await manager.statusChange(payload);

      expect(status1).toHaveBeenCalledWith(payload);
      expect(status2).toHaveBeenCalledWith(payload);
    });
  });

  describe('error isolation', () => {
    it('one broken channel does not kill others on sessionCreated', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onSessionCreated: created1 } = createMockChannel('ch1');
      const { channel: ch2, onSessionCreated: created2 } = createMockChannel('ch2');
      const { channel: ch3, onSessionCreated: created3 } = createMockChannel('ch3');

      // Middle channel throws
      created2.mockRejectedValue(new Error('Channel 2 is broken'));

      manager.register(ch1);
      manager.register(ch2);
      manager.register(ch3);

      const payload = createPayload('session.created');
      await manager.sessionCreated(payload);

      // All channels were called
      expect(created1).toHaveBeenCalledWith(payload);
      expect(created2).toHaveBeenCalledWith(payload);
      expect(created3).toHaveBeenCalledWith(payload);
    });

    it('one broken channel does not kill others on message', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onMessage: msg1 } = createMockChannel('ch1');
      const { channel: ch2, onMessage: msg2 } = createMockChannel('ch2');

      msg1.mockRejectedValue(new Error('Channel 1 broken'));

      manager.register(ch1);
      manager.register(ch2);

      const payload = createPayload('message.assistant');
      await manager.message(payload);

      expect(msg1).toHaveBeenCalledWith(payload);
      expect(msg2).toHaveBeenCalledWith(payload);
    });

    it('all channels broken still resolves', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onStatusChange: status1 } = createMockChannel('ch1');
      const { channel: ch2, onStatusChange: status2 } = createMockChannel('ch2');

      status1.mockRejectedValue(new Error('Broken 1'));
      status2.mockRejectedValue(new Error('Broken 2'));

      manager.register(ch1);
      manager.register(ch2);

      const payload = createPayload('status.working');

      // Should not throw
      await expect(manager.statusChange(payload)).resolves.toBeUndefined();
    });
  });

  describe('filtering', () => {
    it('respects channel filter that returns false', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onMessage: msg1 } = createMockChannel('ch1');

      // Channel only wants status events
      const channel: Channel = {
        ...ch1,
        filter: (event) => event.startsWith('status.'),
      };

      manager.register(channel);

      const payload = createPayload('message.user');
      await manager.message(payload);

      // Filter blocked it
      expect(msg1).not.toHaveBeenCalled();
    });

    it('respects channel filter that returns true', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onStatusChange: status1 } = createMockChannel('ch1');

      const channel: Channel = {
        ...ch1,
        filter: (event) => event.startsWith('status.'),
      };

      manager.register(channel);

      const payload = createPayload('status.idle');
      await manager.statusChange(payload);

      expect(status1).toHaveBeenCalledWith(payload);
    });

    it('mixed filters with broken channel', async () => {
      const manager = new ChannelManager();
      const { channel: ch1, onMessage: msg1 } = createMockChannel('ch1');
      const { channel: ch2, onMessage: msg2 } = createMockChannel('ch2');
      const { channel: ch3, onMessage: msg3 } = createMockChannel('ch3');

      // ch1: filtered out
      const filteredChannel: Channel = {
        ...ch1,
        filter: () => false,
      };

      // ch2: throws
      msg2.mockRejectedValue(new Error('Broken'));

      manager.register(filteredChannel);
      manager.register(ch2);
      manager.register(ch3);

      const payload = createPayload('message.assistant');
      await manager.message(payload);

      expect(msg1).not.toHaveBeenCalled(); // filtered
      expect(msg2).toHaveBeenCalledWith(payload); // called but threw
      expect(msg3).toHaveBeenCalledWith(payload); // called and succeeded
    });
  });

  describe('optional methods', () => {
    it('handles channel without optional methods', async () => {
      const manager = new ChannelManager();

      // Minimal channel with no optional methods
      const channel: Channel = {
        name: 'minimal',
      };

      manager.register(channel);

      // Should not throw
      const handler: InboundHandler = async () => {};
      await manager.init(handler);
      await manager.destroy();

      const payload = createPayload('session.created');
      await expect(manager.sessionCreated(payload)).resolves.toBeUndefined();
      await expect(manager.sessionEnded(payload)).resolves.toBeUndefined();
      await expect(manager.message(payload)).resolves.toBeUndefined();
      await expect(manager.statusChange(payload)).resolves.toBeUndefined();
    });
  });

  describe('circuit breaker — 4xx vs 5xx (#638)', () => {
    it('does not trip circuit breaker on 4xx errors (plain Error)', async () => {
      const manager = new ChannelManager();
      const { channel: ch, onSessionCreated } = createMockChannel('webhook');

      // Simulate 4xx client error — thrown as plain Error
      onSessionCreated.mockRejectedValue(new Error('HTTP 400'));

      manager.register(ch);

      // Fire more than FAILURE_THRESHOLD events
      for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD + 2; i++) {
        await manager.sessionCreated(createPayload('session.created'));
      }

      // Channel should NOT be disabled — 4xx errors don't count
      // Fire one more time, it should still be called
      await manager.sessionCreated(createPayload('session.created'));
      expect(onSessionCreated).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD + 3);
    });

    it('trips circuit breaker on 5xx errors (RetriableError)', async () => {
      const manager = new ChannelManager();
      const { channel: ch, onSessionCreated } = createMockChannel('webhook');

      // Simulate 5xx server error — thrown as RetriableError
      onSessionCreated.mockRejectedValue(new RetriableError('HTTP 500'));

      manager.register(ch);

      // Fire FAILURE_THRESHOLD events
      for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD; i++) {
        await manager.sessionCreated(createPayload('session.created'));
      }

      // Channel should be disabled now — next call should be skipped
      await manager.sessionCreated(createPayload('session.created'));
      // Called exactly FAILURE_THRESHOLD times, not once more
      expect(onSessionCreated).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD);
    });

    it('trips circuit breaker on network errors (RetriableError)', async () => {
      const manager = new ChannelManager();
      const { channel: ch, onMessage } = createMockChannel('webhook');

      // Network error — RetriableError
      onMessage.mockRejectedValue(new RetriableError('fetch failed'));

      manager.register(ch);

      for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD; i++) {
        await manager.message(createPayload('message.user'));
      }

      // Channel should be disabled — next call skipped
      await manager.message(createPayload('message.user'));
      expect(onMessage).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD);
    });

    it('resets failure count on success after 4xx errors', async () => {
      const manager = new ChannelManager();
      const { channel: ch, onSessionCreated } = createMockChannel('webhook');

      // Throw some 4xx errors — these don't increment failCount
      onSessionCreated.mockRejectedValueOnce(new Error('HTTP 403'));
      onSessionCreated.mockRejectedValueOnce(new Error('HTTP 404'));

      manager.register(ch);

      await manager.sessionCreated(createPayload('session.created'));
      await manager.sessionCreated(createPayload('session.created'));

      // Now succeed — resets failCount to 0
      onSessionCreated.mockResolvedValueOnce(undefined);
      await manager.sessionCreated(createPayload('session.created'));

      // Now throw RetriableErrors — need full FAILURE_THRESHOLD to trip
      onSessionCreated.mockRejectedValue(new RetriableError('HTTP 502'));

      // THRESHOLD-1 retriable failures: failCount = 4, not yet tripped
      for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD - 1; i++) {
        await manager.sessionCreated(createPayload('session.created'));
      }

      // 5th retriable failure: failCount = 5 = THRESHOLD → breaker trips
      await manager.sessionCreated(createPayload('session.created'));

      // Next call should be skipped (channel disabled)
      await manager.sessionCreated(createPayload('session.created'));
      // 3 initial (2x 4xx + 1 success) + 5 retriable failures = 8 total calls
      expect(onSessionCreated).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD + 3);
    });

    it('mixed 4xx and 5xx — only 5xx counts toward threshold', async () => {
      const manager = new ChannelManager();
      const { channel: ch, onStatusChange } = createMockChannel('webhook');

      manager.register(ch);

      // Alternate 4xx and 5xx errors
      for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD; i++) {
        onStatusChange.mockRejectedValueOnce(new Error('HTTP 429'));
        await manager.statusChange(createPayload('status.idle'));

        onStatusChange.mockRejectedValueOnce(new RetriableError('HTTP 500'));
        await manager.statusChange(createPayload('status.idle'));
      }

      // 5xx failCount = FAILURE_THRESHOLD, channel should be disabled
      await manager.statusChange(createPayload('status.idle'));
      // The last call should have been skipped
      expect(onStatusChange).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD * 2);
    });

    it('does not trip breaker for plain Error even after many failures', async () => {
      const manager = new ChannelManager();
      const { channel: ch, onMessage } = createMockChannel('webhook');

      onMessage.mockRejectedValue(new Error('HTTP 401'));

      manager.register(ch);

      // Fire way more than threshold
      for (let i = 0; i < ChannelManager.FAILURE_THRESHOLD * 3; i++) {
        await manager.message(createPayload('message.user'));
      }

      // Channel still not disabled — all calls went through
      expect(onMessage).toHaveBeenCalledTimes(ChannelManager.FAILURE_THRESHOLD * 3);
    });
  });
});
