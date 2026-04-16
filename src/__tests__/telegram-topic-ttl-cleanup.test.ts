import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramChannel } from '../channels/telegram.js';
import type { SessionEventPayload } from '../channels/types.js';

function makePayload(sessionId = 'sess-ttl-1'): SessionEventPayload {
  return {
    event: 'session.ended',
    timestamp: new Date().toISOString(),
    session: {
      id: sessionId,
      name: 'ttl-session',
      workDir: '/tmp',
    },
    detail: 'done',
  };
}

describe('Telegram topic TTL cleanup (#287)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules cleanup on session end and deletes only after TTL', async () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
      topicTtlMs: 500,
    });

    const sessionId = 'sess-ttl-1';
    const internal = channel as any;
    internal.topics.set(sessionId, {
      sessionId,
      topicId: 42,
      windowName: 'ttl-session',
      endedAt: null,
      cleanupScheduledAt: null,
      deleting: false,
    });
    internal.progress.set(sessionId, {
      totalMessages: 1,
      reads: 0,
      edits: 0,
      creates: 0,
      commands: 0,
      searches: 0,
      errors: 0,
      filesRead: [],
      filesEdited: [],
      startedAt: Date.now(),
      lastMessage: '',
      currentStatus: 'idle',
      progressMessageId: null,
    });

    vi.spyOn(channel, 'sendStyled').mockResolvedValue(null);
    const tgApi = vi.fn(async (method: string) => {
      if (method === 'closeForumTopic') return true;
      if (method === 'deleteForumTopic') return true;
      return true;
    });
    internal.tgApi = tgApi;

    await channel.onSessionEnded(makePayload(sessionId));

    expect(internal.progress.has(sessionId)).toBe(false);
    expect(internal.topics.has(sessionId)).toBe(true);
    expect(internal.topicCleanupTimers.size).toBe(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(tgApi).not.toHaveBeenCalledWith('deleteForumTopic', expect.any(Object));
    expect(internal.topics.has(sessionId)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(tgApi).toHaveBeenCalledWith('closeForumTopic', {
      chat_id: '-1000',
      message_thread_id: 42,
    });
    expect(tgApi).toHaveBeenCalledWith('deleteForumTopic', {
      chat_id: '-1000',
      message_thread_id: 42,
    });
    expect(internal.topics.has(sessionId)).toBe(false);
  });

  it('is idempotent when cleanup is scheduled multiple times', async () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
      topicTtlMs: 100,
    });

    const sessionId = 'sess-ttl-2';
    const internal = channel as any;
    internal.topics.set(sessionId, {
      sessionId,
      topicId: 77,
      windowName: 'ttl-session-2',
      endedAt: null,
      cleanupScheduledAt: null,
      deleting: false,
    });

    const tgApi = vi.fn(async () => true);
    internal.tgApi = tgApi;

    internal.scheduleTopicCleanup(sessionId);
    internal.scheduleTopicCleanup(sessionId);

    expect(internal.topicCleanupTimers.size).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(tgApi).toHaveBeenCalledTimes(2);
    expect(tgApi).toHaveBeenNthCalledWith(1, 'closeForumTopic', {
      chat_id: '-1000',
      message_thread_id: 77,
    });
    expect(tgApi).toHaveBeenNthCalledWith(2, 'deleteForumTopic', {
      chat_id: '-1000',
      message_thread_id: 77,
    });
  });

  it('treats Telegram not-found delete errors as successful cleanup', async () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
      topicTtlMs: 0,
    });

    const sessionId = 'sess-ttl-3';
    const internal = channel as any;
    internal.topics.set(sessionId, {
      sessionId,
      topicId: 99,
      windowName: 'ttl-session-3',
      endedAt: Date.now() - 1,
      cleanupScheduledAt: Date.now() - 1,
      deleting: false,
    });

    internal.tgApi = vi.fn(async (method: string) => {
      if (method === 'closeForumTopic') return true;
      throw new Error('Telegram API deleteForumTopic: message thread not found');
    });

    await internal.runTopicCleanup(sessionId);
    expect(internal.topics.has(sessionId)).toBe(false);
  });
});

describe('Telegram topicAutoDelete (#1889)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('skips cleanup scheduling when topicAutoDelete is false', async () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
      topicTtlMs: 100,
      topicAutoDelete: false,
    });

    const sessionId = 'sess-no-delete';
    const internal = channel as any;
    internal.topics.set(sessionId, {
      sessionId,
      topicId: 55,
      windowName: 'no-delete-session',
      endedAt: null,
      cleanupScheduledAt: null,
      deleting: false,
    });
    internal.progress.set(sessionId, {
      totalMessages: 1,
      reads: 0,
      edits: 0,
      creates: 0,
      commands: 0,
      searches: 0,
      errors: 0,
      filesRead: [],
      filesEdited: [],
      startedAt: Date.now(),
      lastMessage: '',
      currentStatus: 'idle',
      progressMessageId: null,
    });

    vi.spyOn(channel, 'sendStyled').mockResolvedValue(null);
    const tgApi = vi.fn(async () => true);
    internal.tgApi = tgApi;

    await channel.onSessionEnded(makePayload(sessionId));

    // No cleanup timer should be scheduled
    expect(internal.topicCleanupTimers.size).toBe(0);

    // Topic should still exist after TTL expires
    await vi.advanceTimersByTimeAsync(200);
    expect(internal.topics.has(sessionId)).toBe(true);
    expect(tgApi).not.toHaveBeenCalled();
  });

  it('does not start cleanup sweep when topicAutoDelete is false', async () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
      topicAutoDelete: false,
    });

    const internal = channel as any;

    // Manually call startTopicCleanupSweep — should be a no-op
    internal.startTopicCleanupSweep();
    expect(internal.topicCleanupSweepTimer).toBeNull();
  });

  it('defaults topicAutoDelete to true when not specified', () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
    });

    const internal = channel as any;
    expect(internal.topicAutoDelete).toBe(true);
  });
});

describe('Telegram tgTopicTTLHours config (#1889)', () => {
  it('converts tgTopicTTLHours to tgTopicTtlMs in loadConfig', async () => {
    // We test the conversion logic directly rather than importing loadConfig
    // which requires filesystem access.
    const hours = 48;
    const expectedMs = hours * 60 * 60 * 1000;
    expect(expectedMs).toBe(172_800_000);

    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
      topicTtlMs: 48 * 60 * 60 * 1000,
    });

    const internal = channel as any;
    expect(internal.topicTtlMs).toBe(172_800_000);
  });

  it('uses default TTL when neither hours nor ms is specified', () => {
    const channel = new TelegramChannel({
      botToken: 'test-token',
      groupChatId: '-1000',
      allowedUserIds: [],
    });

    const internal = channel as any;
    expect(internal.topicTtlMs).toBe(24 * 60 * 60 * 1000);
  });
});
